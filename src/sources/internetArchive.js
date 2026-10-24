// Internet Archive: advancedsearch (nivel ítem) + Metadata API (/metadata/{id}, files[] con name/source/format/original/length).
// Las URLs de descarga son https://archive.org/download/{id}/{archivo}. La calidad real se verifica sondeando el archivo.
import { cleanTitle, tokens, sig, coverage } from '../text.js';

const PLAYABLE = /\.(flac|wav|mp3|ogg|oga|opus|m4a|aac)$/i; // formatos que ExoPlayer/BitChord reproduce
const LOSSLESS_EXT = /\.(flac|wav)$/i;
const LOSSY_EXT = /\.(mp3|ogg|oga|opus|m4a|aac|wma)$/i;
const stem = (n) => n.replace(/\.[a-z0-9]+$/i, '').toLowerCase();
const one = (v) => (Array.isArray(v) ? v.join(', ') : v ? String(v) : '');

function parseLength(v) {
  if (v == null || v === '') return null;
  const s = String(v);
  if (s.includes(':')) return s.split(':').reduce((a, p) => a * 60 + Number(p), 0) || null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function fileTitle(name) {
  return stem(name.split('/').pop())
    .replace(/^(?:d\d+)?t?(?:rack)?[\s._-]*\d{1,3}[\s._-]+/i, '')
    .replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function createInternetArchive({ cfg, http, cache, log }) {
  const base = cfg.bases.ia;
  const meta = (id, signal) => cache.getOrSet(`ia:meta:${id}`, () => http.json(`${base}/metadata/${encodeURIComponent(id)}`, { signal }), 30 * 60 * 1000);

  function groupFiles(m) {
    const files = (m.files || []).filter((f) => f.source !== 'metadata' && PLAYABLE.test(f.name) && !/(^|\/)(sample|preview)/i.test(f.name));
    const groups = new Map();
    for (const f of files) {
      const key = stem(f.original || f.name);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(f);
    }
    return groups;
  }

  const rendition = (id, m, f) => {
    const label = String(f.format || '');
    const lossless = LOSSLESS_EXT.test(f.name);
    return {
      url: `${base}/download/${encodeURIComponent(id)}/${f.name.split('/').map(encodeURIComponent).join('/')}`,
      name: f.name, formatLabel: label, claimedLossless: lossless,
      claimedBitDepth: /24\s*bit/i.test(label) ? 24 : undefined,
      claimedBitrate: Number(f.bitrate) > 0 ? Number(f.bitrate) * 1000 : undefined,
      flags: { suspectTranscode: lossless && f.source === 'derivative' && !!f.original && LOSSY_EXT.test(f.original) },
      license: m.metadata?.licenseurl || null,
    };
  };

  return {
    key: 'ia', name: 'internetarchive',
    async search(q, { signal }) {
      const terms = q.tokens.slice(0, 8);
      if (!terms.length) return [];
      const coll = cfg.iaCollections.length ? ` AND collection:(${cfg.iaCollections.join(' OR ')})` : '';
      const lucene = `mediatype:audio${coll} AND (${terms.map((t) => `"${t}"`).join(' AND ')})`;
      const params = new URLSearchParams({ q: lucene, rows: '10', page: '1', output: 'json' });
      for (const f of ['identifier', 'title', 'creator', 'downloads']) params.append('fl[]', f);
      params.append('sort[]', 'downloads desc');
      const res = await cache.getOrSet(`ia:s:${lucene}`, () => http.json(`${base}/advancedsearch.php?${params}`, { signal }), 10 * 60 * 1000);
      const docs = res?.response?.docs || [];
      const ranked = docs
        .map((d) => ({ d, s: coverage(terms, sig(tokens(`${d.title || ''} ${one(d.creator)}`))) }))
        .sort((a, b) => b.s - a.s || (b.d.downloads || 0) - (a.d.downloads || 0))
        .slice(0, cfg.iaMaxItems);
      const out = [];
      await Promise.all(ranked.map(async ({ d }) => {
        let m;
        try { m = await meta(d.identifier, signal); } catch (e) { log.warn('ia.meta_failed', { id: d.identifier, err: e.message }); return; }
        const creator = one(m.metadata?.creator);
        for (const [key, files] of groupFiles(m)) {
          const orig = files.find((f) => f.source === 'original') || files[0];
          const withTitle = files.find((f) => f.title) || orig;
          const dur = files.map((f) => parseLength(f.length)).find(Boolean) || null;
          const lossless = files.some((f) => LOSSLESS_EXT.test(f.name));
          out.push({
            source: 'ia', ref: ['ia', d.identifier, key],
            title: withTitle.title || fileTitle(orig.name), artist: orig.artist || orig.creator || creator,
            album: orig.album || one(m.metadata?.title), duration: dur,
            artworkURL: `${base}/services/img/${encodeURIComponent(d.identifier)}`,
            claims: { lossless, bitDepth: files.some((f) => /24\s*bit/i.test(f.format || '')) ? 24 : undefined },
          });
        }
      }));
      return out;
    },
    async renditions(ref, { signal }) {
      const [, id, key] = ref;
      const m = await meta(id, signal);
      const files = groupFiles(m).get(key) || [];
      return files.map((f) => rendition(id, m, f));
    },
  };
}
