'use strict';

/** Encode a track id: base64url of `identifier|filename`, prefixed `ia-`. */
function encodeId(identifier, filename) {
  return 'ia-' + Buffer.from(identifier + '|' + filename, 'utf8').toString('base64url');
}

/** Decode a track id produced by encodeId. Throws on foreign shapes. */
function decodeId(id) {
  if (typeof id !== 'string' || !id.startsWith('ia-')) {
    throw new Error('Unknown track id');
  }
  const raw = Buffer.from(id.slice(3), 'base64url').toString('utf8');
  const sep = raw.indexOf('|');
  if (sep <= 0 || sep === raw.length - 1) throw new Error('Malformed track id');
  const identifier = raw.slice(0, sep);
  const filename = raw.slice(sep + 1);
  if (!/^[A-Za-z0-9._-]+$/.test(identifier)) throw new Error('Malformed item identifier');
  return { identifier, filename };
}

/** Strict URI component encoding (also escapes !'()* which encodeURIComponent leaves). */
function strictEnc(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

/**
 * Parse archive.org `length` fields, which arrive either as seconds
 * ("245.12") or as "4:05" / "1:02:03".
 */
function parseLength(v) {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).trim();
  if (s.includes(':')) {
    const parts = s.split(':').map((p) => parseFloat(p));
    if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
    let sec = 0;
    for (const p of parts) sec = sec * 60 + p;
    return sec > 0 ? Math.round(sec) : null;
  }
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** archive.org creator/title fields can be string or array. */
function textOf(v, joiner = ', ') {
  if (v === undefined || v === null) return '';
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean).join(joiner);
  return String(v).trim();
}

/** A track title from a filename: strip extension and disc/track prefixes. */
function titleFromFilename(name) {
  let t = String(name).replace(/\.[a-z0-9]+$/i, '');
  t = t.replace(/[_]+/g, ' ');
  t = t.replace(/^(cd|disc|d)\s*\d+[\s._-]+(t\d+[\s._-]+)?/i, '');
  t = t.replace(/^(t|track)\s*\d+[\s._-]+/i, '');
  return t.trim();
}

/** Collapse whitespace; strip control chars. */
function clean(s) {
  return String(s || '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Stable key for de-duplication of rows. */
function dedupeKey(t) {
  return clean(`${t.title}|${t.artist}|${t.album}`).toLowerCase();
}

module.exports = { encodeId, decodeId, strictEnc, parseLength, textOf, titleFromFilename, clean, dedupeKey };
