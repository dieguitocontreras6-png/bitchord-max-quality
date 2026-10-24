// Jamendo: API v3.0 /tracks (requiere client_id propio). Campos usados: id, name, duration, artist_name,
// album_name, license_ccurl, image, audio. audioformat acepta mp31 | mp32 | ogg | flac.
// "audio" es la URL de streaming; no se usa "audiodownload" (la descarga depende de audiodownload_allowed por pista).
export function createJamendo({ cfg, http, cache }) {
  if (!cfg.jamendoClientId) return null;
  const base = cfg.bases.jamendo;
  const call = async (extra, signal) => {
    const params = new URLSearchParams({ client_id: cfg.jamendoClientId, format: 'json', ...extra });
    const res = await http.json(`${base}/tracks/?${params}`, { signal });
    if (res?.headers?.status && res.headers.status !== 'success') throw new Error(`jamendo: ${res.headers.error_message || res.headers.status}`);
    return res?.results || [];
  };

  return {
    key: 'jm', name: 'jamendo',
    async search(q, { signal }) {
      const rows = await cache.getOrSet(`jm:s:${q.raw}`, () => call({ search: q.raw, limit: '10', type: 'single albumtrack', imagesize: '300' }, signal), 10 * 60 * 1000);
      return rows.map((r) => ({
        source: 'jm', ref: ['jm', String(r.id)], title: r.name, artist: r.artist_name, album: r.album_name || '',
        duration: Number(r.duration) || null, artworkURL: r.image || r.album_image || undefined,
        license: r.license_ccurl || null, claims: {},
      }));
    },
    async renditions(ref, { signal }) {
      const [flac, mp3] = await Promise.allSettled([
        call({ id: ref[1], audioformat: 'flac', limit: '1' }, signal),
        call({ id: ref[1], audioformat: 'mp32', limit: '1' }, signal),
      ]);
      const out = [];
      const f = flac.status === 'fulfilled' && flac.value[0]?.audio;
      const m = mp3.status === 'fulfilled' && mp3.value[0]?.audio;
      if (f) out.push({ url: f, name: `jamendo:${ref[1]}:flac`, claimedLossless: true, flags: {}, license: flac.value[0].license_ccurl || null });
      if (m) out.push({ url: m, name: `jamendo:${ref[1]}:mp32`, claimedLossless: false, flags: {}, license: mp3.value[0].license_ccurl || null });
      if (!out.length && flac.status === 'rejected' && mp3.status === 'rejected') throw flac.reason;
      return out;
    },
  };
}
