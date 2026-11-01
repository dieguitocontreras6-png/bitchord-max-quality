'use strict';

/**
 * A TTL + LRU cache: entries expire after `ttlMs` and the least recently used
 * entry is evicted when `max` is reached. `ttlMs = 0` means "never expires".
 */
class TTLCache {
  constructor(max, ttlMs) {
    this.max = max;
    this.ttl = ttlMs;
    this.map = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (this.ttl > 0 && Date.now() > entry.exp) {
      this.map.delete(key);
      this.misses++;
      return undefined;
    }
    // Refresh LRU order.
    this.map.delete(key);
    this.map.set(key, entry);
    this.hits++;
    return entry.val;
  }

  set(key, val) {
    if (this.map.has(key)) this.map.delete(key);
    else if (this.map.size >= this.max) {
      // Evict least-recently-used (first key of the Map).
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
    }
    this.map.set(key, {
      val,
      exp: this.ttl > 0 ? Date.now() + this.ttl : Infinity,
    });
    return val;
  }

  get size() {
    return this.map.size;
  }

  stats() {
    return { size: this.map.size, max: this.max, hits: this.hits, misses: this.misses };
  }
}

module.exports = { TTLCache };
