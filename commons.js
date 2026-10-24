// Wikimedia Commons: MediaWiki Action API (generator=search en el espacio de nombres File:, prop=imageinfo).
// Todo el contenido tiene licencia libre (CC / dominio público); la licencia concreta va en extmetadata.
const strip = (h) => String(h || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();
const LOSSLESS_EXT = /\.(flac|wav)$/i;
const PLAYABLE = /\.(flac|wav|ogg|oga|opus|mp3)$/i;

export function createCommons({ cfg, http, cache, log }) {
  const api = `${cfg.bases.commons}/w/api.php`;
  const common = { action: 'query', format: 'json', formatversion: '2', prop: 'imageinfo', iiprop: 'url|size|mime|mediatype|extmetadata' };

  const pageToCandidate = (p) => {
    const ii = p.imageinfo?.[0];
    if (!ii || !PLAYABLE.test(p.title)) return null;
    const x = ii.extmetadata || {};
    const fileName = p.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' ');
    return {
      source: 'cm', ref: ['cm', p.title],
      title: strip(x.ObjectName?.value) || fileName, artist: strip(x.Artist?.value), album: '',
      duration: null, artworkURL: undefined, license: strip(x.LicenseShortName?.value) || null,
      claims: { lossless: LOSSLESS_EXT.test(p.title) }, _url: ii.url, _size: ii.size,
    };
  };

  return {
    key: 'cm', name: 'commons',
    async search(q, { signal }) {
      const params = new URLSearchParams({ ...common, generator: 'search', gsrsearch: `${q.raw} filetype:audio`, gsrnamespace: '6', gsrlimit: '12' });
      const res = await cache.getOrSet(`cm:s:${params}`, () => http.json(`${api}?${params}`, { signal }), 10 * 60 * 1000);
      return (res?.query?.pages || []).map(pageToCandidate).filter(Boolean);
    },
    async renditions(ref, { signal }) {
      const params = new URLSearchParams({ ...common, titles: ref[1] });
      const res = await http.json(`${api}?${params}`, { signal });
      const c = (res?.query?.pages || []).map(pageToCandidate).find(Boolean);
      if (!c) return [];
      return [{ url: c._url, name: ref[1], claimedLossless: c.claims.lossless, flags: {}, license: c.license }];
    },
  };
}
