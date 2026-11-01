'use strict';

const config = require('./config');
const { encodeId, parseLength, textOf, titleFromFilename, clean, dedupeKey } = require('./util');

/**
 * Files that the Internet Archive itself labels FLAC. The label is the first
 * gate only — the bytes are verified later, before any stream is served.
 */
function flacFiles(files) {
  return (files || []).filter(
    (f) =>
      f &&
      typeof f.name === 'string' &&
      /\.flac$/i.test(f.name) &&
      /flac/i.test(String(f.format || '')) &&
      !f.hidden,
  );
}

/**
 * One search row per FLAC file, in the exact shapes BitChord reads
 * (AddonTrack). `base` (absolute, no trailing slash) enables `streamURL`,
 * which lets BitChord skip the /stream round trip entirely.
 */
function trackFromItem(itemMeta, doc, file, base) {
  const meta = (itemMeta && itemMeta.metadata) || {};
  const identifier = (itemMeta && itemMeta.metadata && itemMeta.metadata.identifier) || doc.identifier;
  const id = encodeId(identifier, file.name);
  const title = clean(file.title) || titleFromFilename(file.name);
  const artist = clean(textOf(file.artist)) || clean(textOf(meta.creator)) || clean(textOf(doc.creator));
  const album = clean(textOf(file.album)) || clean(textOf(meta.title)) || clean(textOf(doc.title));
  const duration = parseLength(file.length);
  const hiRes = /24\s*bit/i.test(String(file.format || ''));

  const track = {
    id,
    title: title || identifier,
    artist,
    album,
    ...(duration ? { duration } : {}),
    artworkURL: `${base}/art/${encodeURIComponent(id)}`,
    format: 'flac',
    audioQuality: hiRes ? 'HI_RES_LOSSLESS' : 'LOSSLESS',
    streamURL: `${base}/audio/${encodeURIComponent(id)}`,
  };
  return track;
}

/** Build rows for an item, mapped against its search doc for fallback text. */
function rowsForItem(itemMeta, doc, base) {
  const files = flacFiles(itemMeta.files);
  const rows = files.map((f) => trackFromItem(itemMeta, doc, f, base));
  return rows;
}

/** De-duplicate rows by (title, artist, album), keeping the first seen. */
function dedupe(tracks) {
  const seen = new Set();
  const out = [];
  for (const t of tracks) {
    const k = dedupeKey(t);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

/**
 * Stable relevance ranking. archive.org matches queries against whole-item
 * text, so a "mozart" search can return a compilation that merely mentions
 * him; rows whose own title/artist actually carry the query belong on top.
 */
function rank(tracks, query) {
  const tokens = String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1);
  if (!tokens.length) return tracks;
  const has = (hay, ws) => ws.every((w) => hay.includes(w));
  const score = (t) => {
    const title = `${t.title}`.toLowerCase();
    const who = `${t.artist} ${t.album}`.toLowerCase();
    if (has(title, tokens)) return 0;
    if (has(who, tokens)) return 1;
    if (tokens.some((w) => title.includes(w))) return 2;
    return 3;
  };
  return tracks
    .map((t, i) => ({ t, i, s: score(t) }))
    .sort((a, b) => (a.s - b.s) || (a.i - b.i))
    .map((x) => x.t);
}

module.exports = { flacFiles, trackFromItem, rowsForItem, dedupe, rank };
