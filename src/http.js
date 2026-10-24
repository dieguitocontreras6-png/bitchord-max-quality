// Cliente HTTP: timeouts, reintentos acotados (429/5xx/red), pausa por host y lectura parcial (Range).
export class HttpError extends Error {
  constructor(status, url, retryAfterMs = null, detail = '') {
    super(`HTTP ${status || 'ERR'} ${detail}`.trim());
    this.status = status; this.url = url; this.retryAfterMs = retryAfterMs; this.detail = detail;
  }
  get transient() { return this.status === 0 || this.status === 429 || this.status >= 500; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function retryAfter(res) {
  const v = res.headers.get('retry-after');
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n * 1000 : null;
}

export function createHttp({ fetchImpl = fetch, userAgent, timeoutMs = 7000, retries = 1, minIntervalMs = {} } = {}) {
  const nextSlot = new Map();

  async function throttle(host) {
    const gap = minIntervalMs[host] ?? minIntervalMs.default ?? 0;
    if (!gap) return;
    const t = Math.max(Date.now(), nextSlot.get(host) || 0);
    nextSlot.set(host, t + gap);
    const wait = t - Date.now();
    if (wait > 0) await sleep(wait);
  }

  async function run(url, opts, consume) {
    const max = opts.retries ?? retries;
    let n = 0;
    for (;;) {
      await throttle(new URL(url).host);
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(new Error('timeout')), opts.timeoutMs ?? timeoutMs);
      const onAbort = () => ac.abort(opts.signal.reason);
      opts.signal?.addEventListener('abort', onAbort, { once: true });
      try {
        const res = await fetchImpl(url, {
          headers: { 'user-agent': userAgent, ...opts.headers }, signal: ac.signal, redirect: 'follow',
        });
        if (res.status === 429 || res.status >= 500) {
          const err = new HttpError(res.status, url, retryAfter(res));
          try { await res.body?.cancel(); } catch { /* nada */ }
          throw err;
        }
        return await consume(res);
      } catch (e) {
        const err = e instanceof HttpError ? e
          : new HttpError(0, url, null, /timeout|abort/i.test(`${e.name} ${e.message}`) ? 'timeout' : (e.cause?.code || e.message));
        if (opts.signal?.aborted || !err.transient || n >= max) throw err;
        n += 1;
        await sleep(Math.min(err.retryAfterMs ?? 250 * 2 ** n, 2500));
      } finally {
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
      }
    }
  }

  return {
    json: (url, o = {}) => run(url, { ...o, headers: { accept: 'application/json', ...o.headers } }, async (res) => {
      if (!res.ok) throw new HttpError(res.status, url);
      try { return await res.json(); } catch { throw new HttpError(-1, url, null, 'invalid-json'); }
    }),
    // Lee como máximo `bytes` bytes empezando en `start`. Devuelve { status, contentType, total, bytes }.
    range: (url, bytes, o = {}) => {
      const start = o.start ?? 0;
      return run(url, { ...o, headers: { range: `bytes=${start}-${start + bytes - 1}`, ...o.headers } }, async (res) => {
        if (res.status !== 200 && res.status !== 206) throw new HttpError(res.status, url);
        const contentType = res.headers.get('content-type') || '';
        let total = null;
        const cr = /\/(\d+)$/.exec(res.headers.get('content-range') || '');
        if (cr) total = Number(cr[1]);
        else if (res.status === 200 && res.headers.get('content-length')) total = Number(res.headers.get('content-length'));
        const chunks = []; let got = 0;
        const reader = res.body.getReader();
        // Si el servidor ignora Range (200), descartamos hasta `start`.
        let skip = res.status === 200 ? start : 0;
        while (got < bytes) {
          const { done, value } = await reader.read();
          if (done) break;
          let v = value;
          if (skip > 0) { if (v.length <= skip) { skip -= v.length; continue; } v = v.subarray(skip); skip = 0; }
          chunks.push(v); got += v.length;
        }
        try { await reader.cancel(); } catch { /* nada */ }
        return { status: res.status, contentType, total, bytes: Buffer.concat(chunks).subarray(0, bytes) };
      });
    },
  };
}
