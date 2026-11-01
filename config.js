'use strict';

function bool(v, dflt) {
  if (v === undefined || v === null || v === '') return dflt;
  return /^(1|true|yes|on)$/i.test(String(v));
}

function clampInt(v, min, max, dflt) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}

function ms(v, dflt) {
  if (!v) return dflt;
  const m = /^(\d+)\s*(ms|s|m|h)?$/i.exec(String(v).trim());
  if (!m) return dflt;
  const n = parseInt(m[1], 10);
  switch ((m[2] || 'ms').toLowerCase()) {
    case 'ms': return n;
    case 's': return n * 1000;
    case 'm': return n * 60000;
    case 'h': return n * 3600000;
    default: return dflt;
  }
}

const config = {
  PORT: clampInt(process.env.PORT, 1, 65535, 8787),
  HOST: process.env.HOST || '0.0.0.0',

  // Public base URL used to build absolute streamURL/audio URLs when the
  // request itself is not enough (e.g. behind proxies that rewrite Host).
  // When empty, the addon derives it from the incoming request
  // (x-forwarded-proto + Host).
  PUBLIC_BASE_URL: (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''),

  // Descriptive UA — archive.org asks clients to identify themselves.
  USER_AGENT:
    process.env.USER_AGENT ||
    'OpenLossless-BitChord-Addon/1.0 (BitChord addon; source: github.com/kushagrasinghx/BitChord; contact: via BitChord app)',

  // Principle: downloads are only offered when the provider's licensing
  // allows it. Default OFF — playback only.
  ALLOW_DOWNLOADS: bool(process.env.ALLOW_DOWNLOADS, false),
  // When downloads are enabled, additionally require an explicit open license
  // (Creative Commons / public domain) on the item.
  STRICT_LICENSES: bool(process.env.STRICT_LICENSES, true),

  // Verify every stream is really FLAC (magic bytes + STREAMINFO) before
  // serving its descriptor. Never disable in production.
  VALIDATE_FLAC: !bool(process.env.NO_VALIDATE_FLAC, false),

  IA_SEARCH_ROWS: clampInt(process.env.IA_SEARCH_ROWS, 1, 100, 40),
  IA_MAX_ITEMS: clampInt(process.env.IA_MAX_ITEMS, 1, 25, 10),
  MAX_TRACKS: clampInt(process.env.MAX_TRACKS, 1, 200, 40),

  SEARCH_CACHE_TTL: ms(process.env.SEARCH_CACHE_TTL, 10 * 60000),
  SEARCH_CACHE_SIZE: clampInt(process.env.SEARCH_CACHE_SIZE, 1, 5000, 200),
  METADATA_CACHE_TTL: ms(process.env.METADATA_CACHE_TTL, 60 * 60000),
  METADATA_CACHE_SIZE: clampInt(process.env.METADATA_CACHE_SIZE, 1, 5000, 1000),
  FLAC_VALIDATION_CACHE_SIZE: clampInt(process.env.FLAC_VALIDATION_CACHE_SIZE, 10, 100000, 1000),

  UPSTREAM_TIMEOUT: ms(process.env.UPSTREAM_TIMEOUT, 20000),
  // Time to wait for upstream response HEADERS on the byte proxy. The body
  // itself streams without an overall deadline (client can abort anytime).
  PROXY_HEADER_TIMEOUT: ms(process.env.PROXY_HEADER_TIMEOUT, 12000),
  ART_CACHE_CONTROL: 'public, max-age=86400',
};

module.exports = config;
