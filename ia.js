'use strict';

const config = require('./config');
const { TTLCache } = require('./cache');
const { strictEnc } = require('./util');

const ARCHIVE = 'https://archive.org';

async function fetchJson(url, timeoutMs = config.UPSTREAM_TIMEOUT) {
  const res = await fetch(url, {
    headers: {
      'user-agent': config.USER_AGENT,
      accept: 'application/json,text/json;q=0.9,*/*;q=0.5',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`archive.org answered HTTP ${res.status} for ${url.split('?')[0]}`);
  }
  const body = await res.text();
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`archive.org returned non-JSON for ${url.split('?')[0]}`);
  }
}

// ── Search ───────────────────────────────────────────────────────────────

function buildQuery(q, withFormatClause) {
  const safe = String(q).replace(/["\\]/g, ' ').trim();
  const clauses = [`(${safe})`, 'mediatype:audio'];
  if (withFormatClause) clauses.push('format:"Flac"');
  return clauses.join(' AND ');
}

function searchUrl(q, page, withFormatClause) {
  const fields = ['identifier', 'title', 'creator', 'date', 'year', 'downloads', 'licenseurl', 'collection'];
  const params = new URLSearchParams();
  params.set('q', buildQuery(q, withFormatClause));
  for (const f of fields) params.append('fl[]', f);
  params.set('rows', String(config.IA_SEARCH_ROWS));
  params.set('page', String(page));
  params.set('output', 'json');
  params.append('sort[]', 'downloads desc');
  return `${ARCHIVE}/advancedsearch.php?${params.toString()}`;
}

/**
 * Item-level search restricted to audio items that carry FLAC files. On zero
 * results the format clause is dropped to widen recall — rows are still
 * filtered to FLAC-only files at mapping time, so rows stay honest.
 */
async function searchItems(q, page = 1) {
  let json;
  try {
    json = await fetchJson(searchUrl(q, page, true));
  } catch (err) {
    // A malformed boolean or transient 5xx should not kill the search; retry
    // once with the broader query, which is also the zero-result fallback.
    json = { responseError: err };
  }
  let response = json && json.response;
  if (!response || !Array.isArray(response.docs) || response.docs.length === 0) {
    const broad = await fetchJson(searchUrl(q, page, false));
    response = broad && broad.response;
  }
  return {
    numFound: (response && response.numFound) || 0,
    docs: (response && response.docs) || [],
  };
}

// ── Metadata ─────────────────────────────────────────────────────────────

const metadataCache = new TTLCache(config.METADATA_CACHE_SIZE, config.METADATA_CACHE_TTL);

async function metadata(identifier) {
  const cached = metadataCache.get(identifier);
  if (cached) return cached;
  const data = await fetchJson(`${ARCHIVE}/metadata/${encodeURIComponent(identifier)}`);
  if (!data || !Array.isArray(data.files)) {
    throw new Error(`No metadata for item ${identifier}`);
  }
  metadataCache.set(identifier, data);
  return data;
}

// ── URLs ─────────────────────────────────────────────────────────────────

/** Direct storage-node URL for one file inside an item (from metadata server/dir). */
function fileDirectUrl(itemMeta, filename) {
  const server = itemMeta && itemMeta.server;
  const dir = itemMeta && itemMeta.dir;
  if (!server || !dir) return null;
  return `https://${server}${dir}/${strictEnc(filename)}`;
}

/** Legacy /download URL (redirects to a storage node). Used as fallback. */
function fileDownloadUrl(identifier, filename) {
  return `${ARCHIVE}/download/${encodeURIComponent(identifier)}/${strictEnc(filename)}`;
}

/**
 * Candidate URLs for one file, best first. archive.org keeps replicas
 * (`workable_servers`, `d1`, `d2`) and its /download redirector can land on a
 * sick node, so every replica is tried directly before falling back to the
 * redirect URL.
 */
function fileUrlCandidates(itemMeta, identifier, filename) {
  const servers = [];
  const push = (s) => {
    if (s && typeof s === 'string' && !servers.includes(s)) servers.push(s);
  };
  for (const s of (itemMeta && itemMeta.workable_servers) || []) push(s);
  push(itemMeta && itemMeta.d1);
  push(itemMeta && itemMeta.d2);
  push(itemMeta && itemMeta.server);
  const urls = servers.map((s) => `https://${s}${itemMeta.dir}/${strictEnc(filename)}`);
  urls.push(fileDownloadUrl(identifier, filename));
  return urls;
}

/** Item artwork: the largest usable image file, else the stable services thumbnail. */
function artworkUrlFor(itemMeta) {
  const identifier = itemMeta && itemMeta.metadata && itemMeta.metadata.identifier;
  const files = itemMeta && itemMeta.files;
  const images = (files || [])
    .filter((f) => /\.(jpe?g|png)$/i.test(String(f.name || '')))
    .filter((f) => !/__ia_thumb/i.test(String(f.name)))
    .map((f) => ({ name: f.name, size: parseInt(f.size || '0', 10) || 0 }))
    .sort((a, b) => b.size - a.size);
  if (identifier && images.length && images[0].size > 20000) {
    return fileUrlCandidates(itemMeta, identifier, images[0].name);
  }
  return [`${ARCHIVE}/services/img/${encodeURIComponent(identifier || '')}`];
}

/**
 * Whether the item carries an explicitly open license. Used only to decide
 * download availability — never to label audio as something it is not.
 */
function isOpenlyLicensed(itemMeta) {
  const url = String((itemMeta && itemMeta.metadata && itemMeta.metadata.licenseurl) || '').toLowerCase();
  return url.includes('/creativecommons/') || url.includes('/publicdomain/');
}

module.exports = {
  ARCHIVE,
  searchItems,
  metadata,
  fileDirectUrl,
  fileDownloadUrl,
  fileUrlCandidates,
  artworkUrlFor,
  isOpenlyLicensed,
  metadataCache,
};
