import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import { createLogger } from './log.js';
import { TtlCache } from './cache.js';
import { createHttp } from './http.js';
import { buildSources } from './sources/index.js';
 
const VERSION = '1.0.0';

export function createApp({ cfg = loadConfig(), fetchImpl, log = createLogger(cfg.logLevel) } = {}) {
  const ua = `BitChordMaxQuality/${VERSION} (+${cfg.contact})`;
  const client = createHttp({ fetchImpl, userAgent: ua, timeoutMs: cfg.httpTimeoutMs, retries: cfg.httpRetries, minIntervalMs: cfg.minIntervalMs });
  const cache = new TtlCache({ max: 1000 });
  const sources = buildSources({ cfg, http: client, cache, log });  

  const manifest = {
    id: 'dev.bitchord.max-quality', name: 'Max Quality', version: VERSION, resources: ['search', 'stream'],
    allowDownloads: cfg.allowDownloads, checkValidLossless: cfg.checkValidLossless,
  };

  const hits = new Map();
  const limited = (ip) => {
    const now = Date.now(); let h = hits.get(ip);
    if (!h || h.reset < now) { h = { n: 0, reset: now + 60000 }; hits.set(ip, h); }
    h.n += 1;
    return h.n > cfg.rateLimitPerMin ? Math.ceil((h.reset - now) / 1000) : 0;
  };
  const sweep = setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, 60000);
  sweep.unref();

  const send = (res, status, body, headers = {}) => {
    const data = body == null ? '' : JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*', ...headers });
    res.end(data);
  };

  const server = http.createServer(async (req, res) => {
    const t0 = Date.now();
    const url = new URL(req.url, 'http://x');
    let status = 500;
    const ac = new AbortController();
    res.on('close', () => { if (!res.writableFinished) ac.abort(new Error('client-closed')); });
    try {
      if (req.method === 'OPTIONS') { status = 204; return send(res, 204, null, { 'access-control-allow-methods': 'GET' }); }
      if (req.method !== 'GET') { status = 405; return send(res, 405, { error: 'GET only' }); }
      const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
      if (url.pathname !== '/healthz') {
        const wait = limited(ip);
        if (wait) { status = 429; return send(res, 429, { error: 'Too many requests' }, { 'retry-after': String(wait) }); }
      }
      if (url.pathname === '/manifest.json') { status = 200; return send(res, 200, manifest); }
      if (url.pathname === '/healthz') { status = 200; return send(res, 200, { ok: true, sources: sources.map((s) => s.name) }); }
      if (url.pathname === '/') { status = 200; return send(res, 200, { name: manifest.name, manifest: '/manifest.json', sources: sources.map((s) => s.name) }); }
      if (url.pathname === '/search') {
        const timer = setTimeout(() => ac.abort(new Error('deadline')), cfg.searchDeadlineMs + 1500);
        try {
          const p = Object.fromEntries(url.searchParams);
          const out = await service.search(p, { signal: ac.signal });
          status = 200; return send(res, 200, out);
        } finally { clearTimeout(timer); }
      }
      if (url.pathname.startsWith('/stream/')) {
        const timer = setTimeout(() => ac.abort(new Error('deadline')), cfg.streamDeadlineMs);
        try {
          let id;
          try { id = decodeURIComponent(url.pathname.slice(8)); } catch { status = 404; return send(res, 404, { error: 'Unknown track id' }); }
          const out = await service.resolveStream(id, url.searchParams.get('quality'), { signal: ac.signal });
          status = out.status;
          return send(res, out.status, out.body, out.headers);
        } finally { clearTimeout(timer); }
      }
      status = 404; return send(res, 404, { error: 'Not found' });
    } catch (e) {
      log.error('http.error', { path: url.pathname.slice(0, 20), err: e.message });
      if (!res.headersSent) { status = 500; send(res, 500, { error: 'Internal error' }); }
    } finally {
      log.info('http', { method: req.method, path: url.pathname.startsWith('/stream/') ? '/stream/:id' : url.pathname, status, ms: Date.now() - t0 });
    }
  });
  server.on('close', () => clearInterval(sweep));
  return { server, sources, service, cfg };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { server, cfg, sources } = createApp();
  server.listen(cfg.port, () => {
    createLogger(cfg.logLevel).info('listening', { port: cfg.port, sources: sources.map((s) => s.name), publicUrl: cfg.publicUrl || undefined });
  });
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}
