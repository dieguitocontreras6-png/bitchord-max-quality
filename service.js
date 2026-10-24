import { parseQuery } from './text.js';
import { scoreCandidate, groupCandidates } from './match.js';
import { encodeRefs, decodeRefs } from './ids.js';
import { sniffAudio, describe } from './audio.js';
import { normalizeTier, pickBest, byPrior } from './select.js';

const PROBE_BYTES = 65536;
const PROBE_PER_REF = 3;

const withDeadline = (p, ms, label) => {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(label)), ms); })]).finally(() => clearTimeout(t));
};

async function mapLimit(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    for (;;) { const k = i++; if (k >= items.length) return; out[k] = await fn(items[k]); }
  }));
  return out;
}

// Calidad declarada (no verificada) para ordenar candidatos antes de sondear.
const claimRank = (c) => (c.claims?.lossless ? (c.claims.bitDepth === 24 ? 3 : 2) : c.claims?.lossless === false ? 1 : 1.5);

export function createService({ cfg, http, cache, log, sources }) {
  const byKey = Object.fromEntries(sources.map((s) => [s.key, s]));
  const knownKeys = sources.map((s) => s.key);

  async function search(params, { signal } = {}) {
    const q = parseQuery(params.q, params);
    if (!q.tokens.length) return { tracks: [] };
    const lists = await Promise.all(sources.map(async (s) => {
      const t = Date.now();
      try {
        const c = await withDeadline(s.search(q, { signal }), cfg.searchDeadlineMs, `${s.name}: timeout`);
        log.info('search.source', { source: s.name, q: q.raw, candidates: c.length, ms: Date.now() - t });
        return c;
      } catch (e) {
        log.warn('search.source_failed', { source: s.name, q: q.raw, err: e.message, ms: Date.now() - t });
        return [];
      }
    }));
    const scored = lists.flat().map((c) => ({ c, ...scoreCandidate(q, c, cfg.matchThreshold) }));
    const accepted = scored.filter((s) => s.accepted);
    log.info('search.done', { q: q.raw, candidates: scored.length, accepted: accepted.length });

    const rows = groupCandidates(accepted).map((members) => {
      const byScore = [...members].sort((a, b) => b.score - a.score);
      const byClaim = [...members].sort((a, b) => claimRank(b.c) - claimRank(a.c) || b.score - a.score);
      return { top: byScore[0], score: byScore[0].score, refs: byClaim.map((m) => m.c.ref), lossless: members.some((m) => m.c.claims?.lossless) };
    }).sort((a, b) => b.score - a.score || Number(b.lossless) - Number(a.lossless));

    const tracks = rows.slice(0, cfg.maxResults).map((r) => ({
      id: encodeRefs(r.refs), title: r.top.c.title, artist: r.top.c.artist || undefined, album: r.top.c.album || undefined,
      duration: r.top.c.duration ? Math.round(r.top.c.duration) : undefined, artworkURL: r.top.c.artworkURL,
      // Solo se anuncia LOSSLESS si hay un archivo con extensión sin pérdida listado; /stream lo verifica de verdad.
      audioQuality: r.lossless ? 'LOSSLESS' : undefined,
    }));
    return { tracks };
  }

  async function verify({ r, src }, signal) {
    const t = Date.now();
    const reject = (reason, extra = {}) => { log.warn('stream.reject', { source: src.name, file: r.name, reason, ...extra }); return { reject: reason }; };
    try {
      let start = 0, res, info;
      for (let hop = 0; hop < 3; hop++) {
        res = await http.range(r.url, PROBE_BYTES, { signal, timeoutMs: cfg.probeTimeoutMs, start });
        if (/text\/html|application\/json|text\/plain/i.test(res.contentType)) return reject('content-type', { contentType: res.contentType });
        info = sniffAudio(res.bytes);
        if (info?.incomplete) { start += info.nextOffset; continue; }
        break;
      }
      if (!info || info.incomplete) return reject('unrecognized-audio');
      const out = { ...info };
      if (info.lossless && info.durationSec && res.total) out.bitrate = Math.round((res.total * 8) / info.durationSec);
      const mislabeled = (r.claimedLossless === true && info.lossless === false) || (r.claimedLossless === false && info.lossless === true);
      if (mislabeled) log.warn('quality.mismatch', { source: src.name, file: r.name, claimedLossless: r.claimedLossless, actual: info.codec });
      return { r, src, info: out, total: res.total, ms: Date.now() - t, flags: { ...r.flags, mislabeled } };
    } catch (e) {
      if (e.transient) return { reject: `transient:${e.detail || e.status}`, transient: true };
      return reject(`http-${e.status}`, { err: e.message });
    }
  }

  async function resolveStream(id, quality, { signal } = {}) {
    const refs = decodeRefs(id, knownKeys);
    if (!refs) return { status: 404, body: { error: 'Unknown track id' } };
    const tier = normalizeTier(quality);
    const ck = `v:${id}:${tier}`;
    const hit = cache.get(ck);
    if (hit) return hit;

    let transient = false;
    const toProbe = [];
    await Promise.all(refs.map(async (ref) => {
      const src = byKey[ref[0]];
      try {
        const rs = await src.renditions(ref, { signal });
        rs.sort(byPrior(tier)).slice(0, PROBE_PER_REF).forEach((r) => toProbe.push({ r, src }));
      } catch (e) {
        if (e.transient !== false) transient = true;
        log.warn('stream.renditions_failed', { source: src.name, err: e.message });
      }
    }));

    const results = await mapLimit(toProbe, 3, (x) => verify(x, signal));
    const verified = results.filter((x) => x && !x.reject);
    if (results.some((x) => x?.transient)) transient = true;
    const best = pickBest(verified, tier);
    if (!best) {
      if (transient) return { status: 503, headers: { 'retry-after': '30' }, body: { error: 'Sources temporarily unavailable' } };
      return { status: 404, body: { error: 'No accessible rendition for this track' } };
    }

    const { info, r, src } = best;
    const body = {
      url: r.url,
      format: info.codec === 'pcm' ? 'wav' : info.codec === 'vorbis' ? 'ogg' : (info.codec === 'opus' ? 'opus' : info.container),
      quality: describe(info) + (best.flags.suspectTranscode ? ' · possible lossy source' : ''),
      codec: info.codec === 'pcm' ? 'pcm' : info.codec,
      container: info.container, manifest: 'none', encrypted: false,
      sampleRate: info.sampleRate, bitDepth: info.lossless ? info.bitDepth : undefined, bitrate: info.bitrate || undefined,
    };
    log.info('stream.selected', {
      source: src.name, file: r.name, tier, label: body.quality, codec: info.codec, bitDepth: info.bitDepth,
      sampleRate: info.sampleRate, probed: toProbe.length, verified: verified.length, license: r.license,
      mislabeled: best.flags.mislabeled || undefined, suspectTranscode: best.flags.suspectTranscode || undefined,
    });
    const result = { status: 200, body };
    if (!transient) cache.set(ck, result, 5 * 60 * 1000);
    return result;
  }

  return { search, resolveStream };
}
