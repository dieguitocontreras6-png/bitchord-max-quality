// Caché TTL con tope de entradas y deduplicación de peticiones en vuelo.
export class TtlCache {
  constructor({ max = 500, ttlMs = 600000, now = Date.now } = {}) {
    this.max = max; this.ttlMs = ttlMs; this.now = now;
    this.map = new Map(); this.inflight = new Map();
  }
  get(key) {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.exp < this.now()) { this.map.delete(key); return undefined; }
    return e.val;
  }
  set(key, val, ttlMs = this.ttlMs) {
    if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value);
    this.map.set(key, { val, exp: this.now() + ttlMs });
  }
  // Si fn falla no se cachea nada.
  async getOrSet(key, fn, ttlMs) {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    if (this.inflight.has(key)) return this.inflight.get(key);
    const p = (async () => {
      try { const v = await fn(); this.set(key, v, ttlMs); return v; }
      finally { this.inflight.delete(key); }
    })();
    this.inflight.set(key, p);
    return p;
  }
}
