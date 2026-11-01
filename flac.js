'use strict';

/**
 * FLAC truth check. A file is only ever labelled `flac` after its own bytes
 * say so: the `fLaC` magic plus a parsed STREAMINFO block. Nothing about the
 * provider's labels is trusted on its own.
 */

const config = require('./config');
const { TTLCache } = require('./cache');

const cache = new TTLCache(config.FLAC_VALIDATION_CACHE_SIZE, 0);

/**
 * Fetch the first 80 bytes of `url` and parse the stream header.
 *
 * Layout: "fLaC" (4 bytes) | metadata block header (4: type byte, 3-byte
 * length) | STREAMINFO (34 bytes). Inside STREAMINFO the packed 8-byte field
 * at data offset 10 holds: sample rate (20 bits), channels (3 bits, +1),
 * bit depth (5 bits, +1) and total samples (36 bits).
 */
async function probeFlac(url, extraHeaders = {}) {
  let res;
  try {
    res = await fetch(url, {
      headers: {
        'user-agent': config.USER_AGENT,
        accept: '*/*',
        range: 'bytes=0-79',
        ...extraHeaders,
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(config.UPSTREAM_TIMEOUT),
    });
  } catch (err) {
    return { flac: false, status: 0, reason: `network error: ${String(err && (err.message || err))}` };
  }

  if (res.status !== 206 && res.status !== 200) {
    return { flac: false, status: res.status, reason: `upstream HTTP ${res.status}` };
  }

  let buf;
  try {
    buf = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    return { flac: false, status: res.status, reason: `body read error: ${String(err && (err.message || err))}` };
  }
  if (buf.length < 4 || buf.toString('latin1', 0, 4) !== 'fLaC') {
    return { flac: false, status: res.status, reason: 'no fLaC magic' };
  }

  const out = { flac: true, status: res.status, sampleRate: null, channels: null, bitDepth: null, totalSamples: null };

  // Parse STREAMINFO only when it is the first metadata block and fully present.
  const blockType = buf.length > 4 ? buf[4] & 0x7f : -1;
  const blockLen = buf.length > 7 ? (buf[5] << 16) | (buf[6] << 8) | buf[7] : 0;
  if (blockType === 0 && blockLen === 34 && buf.length >= 8 + 34) {
    const d = 8 + 10; // packed field start
    out.sampleRate = (buf[d] << 12) | (buf[d + 1] << 4) | (buf[d + 2] >> 4);
    out.channels = ((buf[d + 2] >> 1) & 0x07) + 1;
    out.bitDepth = (((buf[d + 2] & 0x01) << 4) | (buf[d + 3] >> 4)) + 1;
    out.totalSamples =
      (buf[d + 3] & 0x0f) * 4294967296 +
      buf[d + 4] * 16777216 +
      buf[d + 5] * 65536 +
      buf[d + 6] * 256 +
      buf[d + 7];
  }
  return out;
}

/**
 * Cached probe. Returns `{ flac: boolean, sampleRate?, channels?, bitDepth? }`.
 * Results are cached forever (magic bytes of a file do not change); failures
 * are not cached so transient upstream errors retry on the next request.
 */
async function validateFlac(url) {
  const hit = cache.get(url);
  if (hit) return hit;
  const result = await probeFlac(url);
  if (result.flac) {
    cache.set(url, result);
  }
  return result;
}

module.exports = { probeFlac, validateFlac, cache };
