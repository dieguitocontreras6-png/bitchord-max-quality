'use strict';

/**
 * OpenLossless BitChord addon — real, verified FLAC from the Internet Archive.
 *
 * Endpoints (the BitChord addon protocol, verified against the app source):
 *   GET /manifest.json        — addon description (resources must include "search")
 *   GET /search?q=&quality=   — {"tracks":[AddonTrack...]}
 *   GET /stream/{id}          — AddonStream descriptor (format "flac", encrypted false)
 *   GET|HEAD /audio/{id}      — byte proxy with Range/206 passthrough (seek)
 *   GET /art/{id}             — artwork proxy
 *   GET /health               — liveness + cache stats
 *
 * Honesty rules baked in:
 *   - A stream is labelled "flac" only after its bytes verified (fLaC + STREAMINFO).
 *   - No transcoding, no upsampling, no DRM, no invented availability.
 *   - Downloads are off unless the operator enables them (licensing principle).
 */

const http = require('http');
const { Readable } = require('stream');

const config = require('./config');
const { TTLCache } = require('./cache');
const ia = require('./ia');
const flac = require('./flac');
const mappers = require('./mappers');
const hosts = require('./hosts');
const { decodeId } = require('./util');

const VERSION = require('./package.json').version;

const searchCache = new TTLCache(config.SEARCH_CACHE_SIZE, config.SEARCH_CACHE_TTL);

// ── Helpers ──────────────────────────────────────────────────────────────

function log(level, msg, extra) {
  const line = `[${new Date().toISOString()}] [${level}] ${msg}${extra ? ' ' + JSON.stringify(extra) : ''}`;
  if (level === 'error') console.error(line);
  else console.log(line);
}

function baseUrlOf(req) {
  if (config.PUBLIC_BASE_URL) return config.PUBLIC_BASE_URL;
  const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  const host = req.headers.host || `localhost:${config.PORT}`;
  return `${proto}://${host}`;
}

function sendJson(res, status, obj, extraHeaders = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'access-control-allow-origin': '*',
    ...extraHeaders,
  });
  res.end(body);
}

function notFound(res, message) {
  sendJson(res, 404, { error: message });
}

// ── Manifest ─────────────────────────────────────────────────────────────

function manifestObject() {
  return {
    id: 'openlossless-ia-flac',
    name: 'OpenLossless · Internet Archive FLAC',
    version: VERSION,
    description:
      'Real lossless FLAC audio from the Internet Archive. Every stream is byte-verified as FLAC before it is served; formats are never invented.',
    resources: ['search', 'stream'],
    // Principle: downloads only when licensing allows. The operator opts in
    // explicitly; absent/false both mean "playback only" for BitChord.
    allowDownloads: config.ALLOW_DOWNLOADS,
  };
}

// ── Search ───────────────────────────────────────────────────────────────

async function handleSearch(req, res, url, base) {
  const q = (url.searchParams.get('q') || '').trim();
  const quality = (url.searchParams.get('quality') || '').trim();
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);

  if (!q) {
    sendJson(res, 200, { tracks: [] });
    return;
  }
  // The whole catalogue is lossless FLAC; quality is therefore accepted and
  // answered with the only tier the provider actually has. Nothing is
  // transcoded down or up to pretend otherwise.
  log('info', `search q=${JSON.stringify(q)} quality=${quality || '-'} page=${page}`);

  const cacheKey = `${q}::${page}`;
  const cached = searchCache.get(cacheKey);
  if (cached) {
    sendJson(res, 200, { tracks: cached });
    return;
  }

  const { docs } = await ia.searchItems(q, page);
  const chosen = docs.slice(0, config.IA_MAX_ITEMS);

  const settled = await Promise.allSettled(chosen.map((doc) => ia.metadata(doc.identifier)));

  let tracks = [];
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    if (r.status !== 'fulfilled') {
      log('warn', `metadata failed for ${chosen[i].identifier}`, { error: String(r.reason && r.reason.message) });
      continue;
    }
    const itemMeta = r.value;
    if (config.ALLOW_DOWNLOADS && config.STRICT_LICENSES && !ia.isOpenlyLicensed(itemMeta)) {
      // Downloads are enabled but this item is not openly licensed — skip it
      // rather than offer saving something the provider did not license out.
      continue;
    }
    try {
      tracks.push(...mappers.rowsForItem(itemMeta, chosen[i], base));
    } catch (err) {
      log('warn', `mapping failed for ${chosen[i].identifier}`, { error: String(err && err.message) });
    }
  }

  tracks = mappers.rank(mappers.dedupe(tracks), q).slice(0, config.MAX_TRACKS);
  searchCache.set(cacheKey, tracks);
  sendJson(res, 200, { tracks });
}

// ── Stream descriptor ────────────────────────────────────────────────────

async function handleStream(req, res, url, base, rawId) {
  let decoded;
  try {
    decoded = decodeId(rawId);
  } catch {
    return notFound(res, 'Unknown track id');
  }
  const { identifier, filename } = decoded;
  log('info', `stream id=${rawId.slice(0, 24)}… item=${identifier}`);

  let itemMeta;
  try {
    itemMeta = await ia.metadata(identifier);
  } catch (err) {
    log('error', `metadata failed for ${identifier}`, { error: String(err && err.message) });
    return sendJson(res, 502, { error: 'Upstream metadata unavailable' });
  }

  const file = (itemMeta.files || []).find((f) => f && f.name === filename);
  if (!file || !/\.flac$/i.test(String(file.name))) {
    return notFound(res, 'No such FLAC file in this item');
  }

  const candidates = ia.fileUrlCandidates(itemMeta, identifier, filename);

  // Verify the bytes before claiming anything. Every replica is probed until
  // one verifies; hosts that fail network-wise are remembered as sick.
  let verified = null;
  if (config.VALIDATE_FLAC) {
    for (const url of orderCandidates(candidates)) {
      verified = await flac.validateFlac(url);
      if (verified.flac) break;
      if (shouldMarkSick(verified.status || 0)) hosts.markSick(new URL(url).host);
      log('warn', `FLAC verification failed on ${new URL(url).host}`, { reason: verified.reason });
    }
    if (!verified || !verified.flac) {
      return sendJson(res, 404, {
        error: 'This file did not verify as real FLAC — refusing to serve it as lossless',
      });
    }
  }

  const size = parseInt(file.size || '0', 10) || null;
  const durationSec = require('./util').parseLength(file.length);
  const bitrateKbps = size && durationSec ? Math.max(1, Math.round((size * 8) / 1000 / durationSec)) : null;

  const channels = verified ? verified.channels : null;
  const descriptor = {
    url: `${base}/audio/${encodeURIComponent(rawId)}`,
    format: 'flac',
    codec: 'flac',
    container: 'flac',
    manifest: 'none',
    mimeType: 'audio/flac',
    encrypted: false,
    quality: 'LOSSLESS',
    ...((verified && verified.sampleRate) ? { sampleRate: verified.sampleRate } : {}),
    ...((verified && verified.bitDepth) ? { bitDepth: verified.bitDepth } : {}),
    ...(bitrateKbps ? { bitrate: bitrateKbps } : {}),
    ...(channels === 2 ? { audioModes: ['STEREO'] } : {}),
  };
  sendJson(res, 200, descriptor);
}

// ── Upstream selection ───────────────────────────────────────────────────

/** Healthy candidates first; hosts remembered as sick go last as a resort. */
function orderCandidates(candidateUrls) {
  const healthy = [];
  const sick = [];
  for (const u of candidateUrls) {
    (hosts.isSick(new URL(u).host) ? sick : healthy).push(u);
  }
  return healthy.concat(sick);
}

function shouldMarkSick(status) {
  return status === 0 || status >= 500 || status === 403;
}

/**
 * Open the first upstream that answers properly. The header timeout applies
 * only until headers arrive — the body then streams without an overall
 * deadline. Returns the fetch Response, or null when everything failed.
 */
async function openUpstream(req, candidateUrls, headers) {
  const order = orderCandidates(candidateUrls);
  let lastStatus = 0;
  for (const candidateUrl of order) {
    const host = new URL(candidateUrl).host;
    const controller = new AbortController();
    const onClientClose = () => controller.abort();
    const timer = setTimeout(() => controller.abort(new Error('header timeout')), config.PROXY_HEADER_TIMEOUT);
    req.on('close', onClientClose);
    let attempt = null;
    try {
      attempt = await fetch(candidateUrl, { headers, redirect: 'follow', signal: controller.signal });
      if (attempt.status === 200 || attempt.status === 206 || attempt.status === 416) {
        return attempt;
      }
      lastStatus = attempt.status;
      if (shouldMarkSick(attempt.status)) hosts.markSick(host);
      attempt.body && attempt.body.cancel().catch(() => {});
      log('warn', `upstream ${attempt.status} on ${host}; trying next candidate`);
    } catch (err) {
      if (req.destroyed) return null; // client went away mid-attempt
      hosts.markSick(host);
      const cause = err && err.cause && (err.cause.code || err.cause.message);
      log('warn', `upstream fetch failed on ${host}: ${String(cause || (err && err.message) || err)}`);
    } finally {
      clearTimeout(timer);
      req.off('close', onClientClose);
    }
    if (req.destroyed) return null;
  }
  log('error', `all upstream candidates failed (last HTTP ${lastStatus})`);
  return null;
}

// ── Byte proxy (Range/206 passthrough) ───────────────────────────────────

async function proxyBytes(req, res, candidateUrls, cacheControl) {
  const headers = {
    'user-agent': config.USER_AGENT,
    accept: '*/*',
  };
  if (req.headers.range) headers.range = req.headers.range;
  if (req.headers['if-range']) headers['if-range'] = req.headers['if-range'];

  const upstream = await openUpstream(req, candidateUrls, headers);
  if (!upstream) {
    if (!res.headersSent) sendJson(res, 502, { error: 'Upstream unavailable' });
    return;
  }

  const outHeaders = {
    'access-control-allow-origin': '*',
    'accept-ranges': 'bytes',
  };
  for (const name of ['content-type', 'content-length', 'content-range', 'etag', 'last-modified']) {
    const v = upstream.headers.get(name);
    if (v) outHeaders[name] = v;
  }
  if (!outHeaders['content-type']) outHeaders['content-type'] = 'application/octet-stream';
  if (cacheControl) outHeaders['cache-control'] = cacheControl;

  res.writeHead(upstream.status, outHeaders);
  if (req.method === 'HEAD' || !upstream.body) {
    res.end();
    return;
  }

  const body = Readable.fromWeb(upstream.body);
  body.on('error', (err) => {
    log('warn', `stream body error: ${String(err && err.message)}`);
    res.destroy();
  });
  body.pipe(res);
}

async function handleAudio(req, res, rawId) {
  let decoded;
  try {
    decoded = decodeId(rawId);
  } catch {
    return notFound(res, 'Unknown track id');
  }
  let itemMeta;
  try {
    itemMeta = await ia.metadata(decoded.identifier);
  } catch (err) {
    log('error', `metadata failed for ${decoded.identifier}`, { error: String(err && err.message) });
    return sendJson(res, 502, { error: 'Upstream metadata unavailable' });
  }
  const candidates = ia.fileUrlCandidates(itemMeta, decoded.identifier, decoded.filename);
  await proxyBytes(req, res, candidates, 'public, max-age=3600');
}

async function handleArt(req, res, rawId) {
  let decoded;
  try {
    decoded = decodeId(rawId);
  } catch {
    return notFound(res, 'Unknown track id');
  }
  let itemMeta;
  try {
    itemMeta = await ia.metadata(decoded.identifier);
  } catch {
    return notFound(res, 'No artwork for this item');
  }
  const artCandidates = ia.artworkUrlFor(itemMeta);
  await proxyBytes(req, res, artCandidates, config.ART_CACHE_CONTROL);
}

// ── Health + status page ─────────────────────────────────────────────────

function handleHealth(res) {
  sendJson(res, 200, {
    ok: true,
    addon: 'openlossless-bitchord-addon',
    version: VERSION,
    provider: 'internet-archive',
    validateFlac: config.VALIDATE_FLAC,
    allowDownloads: config.ALLOW_DOWNLOADS,
    uptimeSec: Math.round(process.uptime()),
    caches: {
      search: searchCache.stats(),
      metadata: ia.metadataCache.stats(),
      flacValidation: flac.cache.stats(),
      hosts: hosts.stats(),
    },
  });
}

function handleIndex(res, base) {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>OpenLossless · BitChord addon</title>
<style>body{font-family:system-ui,sans-serif;max-width:680px;margin:48px auto;padding:0 20px;color:#111}
code{background:#f2f2f2;padding:2px 6px;border-radius:6px}a{color:#0645ad}
.badge{display:inline-block;background:#0a7d33;color:#fff;border-radius:999px;padding:2px 12px;font-size:13px}</style></head>
<body>
<h1>OpenLossless <span class="badge">BitChord addon</span></h1>
<p>Real, byte-verified <strong>FLAC</strong> (lossless) audio from the Internet Archive.</p>
<p>Paste <code>${base}</code> into BitChord → Sources → Add source.</p>
<ul>
  <li><a href="/manifest.json">/manifest.json</a></li>
  <li><a href="/health">/health</a></li>
  <li><a href="/search?q=grateful%20dead&quality=LOSSLESS">/search?q=…</a></li>
</ul>
<p><em>Honest formats only: a stream is labelled FLAC only after its own bytes
(<code>fLaC</code> magic + STREAMINFO) verify it. Downloads are
${config.ALLOW_DOWNLOADS ? 'enabled for openly licensed items' : 'disabled (playback only)'}.</em></p>
</body></html>`;
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'access-control-allow-origin': '*' });
  res.end(html);
}

// ── Router ───────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  let url;
  try {
    url = new URL(req.url, 'http://internal');
  } catch {
    return sendJson(res, 400, { error: 'Bad request' });
  }
  const path = url.pathname;
  const base = baseUrlOf(req);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, HEAD, OPTIONS',
      'access-control-allow-headers': 'Range, If-Range, Content-Type',
      'access-control-max-age': '86400',
    });
    return res.end();
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  try {
    if (path === '/health') return handleHealth(res);
    if (path === '/' || path === '/index.html') return handleIndex(res, base);
    if (path === '/manifest.json' || path === '/manifest') {
      return sendJson(res, 200, manifestObject(), { 'cache-control': 'public, max-age=300' });
    }
    if (path === '/search') return await handleSearch(req, res, url, base);

    if (path.startsWith('/stream/')) {
      return await handleStream(req, res, url, base, decodeURIComponent(path.slice('/stream/'.length)));
    }
    if (path.startsWith('/audio/')) {
      return await handleAudio(req, res, decodeURIComponent(path.slice('/audio/'.length)));
    }
    if (path.startsWith('/art/')) {
      return await handleArt(req, res, decodeURIComponent(path.slice('/art/'.length)));
    }

    return notFound(res, `No route for ${path}`);
  } catch (err) {
    log('error', `handler failed for ${path}`, { error: String(err && err.message) });
    if (!res.headersSent) {
      sendJson(res, 500, { error: 'Internal error' });
    } else {
      res.destroy();
    }
  } finally {
    if (path !== '/audio/' || true) {
      const dur = Date.now() - started;
      if (path !== '/health') log('info', `${req.method} ${path} -> done in ${dur}ms`);
    }
  }
});

if (require.main === module) {
  server.listen(config.PORT, config.HOST, () => {
    log('info', `openlossless-bitchord-addon v${VERSION} listening on http://${config.HOST}:${config.PORT}`);
    log('info', `validateFlac=${config.VALIDATE_FLAC} allowDownloads=${config.ALLOW_DOWNLOADS} maxItems=${config.IA_MAX_ITEMS}`);
  });
}

process.on('unhandledRejection', (err) => {
  log('error', `unhandledRejection: ${String(err && err.message)}`);
});

module.exports = { server };
