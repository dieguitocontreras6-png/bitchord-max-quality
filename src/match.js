import { tokens, sig, cleanTitle, versionTags, coverage, primaryArtist, norm } from './text.js';

const PENALTY = 0.2;

// Devuelve { score, accepted }. Nunca "inventa": si algún término de la consulta no aparece
// en título+artista+álbum, o el artista exigido no coincide, el candidato se rechaza.
export function scoreCandidate(q, c, threshold = 0.7) {
  const full = sig(tokens(`${c.title} ${c.artist || ''} ${c.album || ''}`));
  const titleFull = sig(tokens(c.title));
  const titleClean = sig(tokens(cleanTitle(c.title)));
  if (!q.tokens.length || !titleClean.length) return { score: 0, accepted: false };

  const cov = coverage(q.tokens, full);
  const tin = coverage(titleClean, q.tokens);
  const titleCov = coverage(q.tokens, titleFull);
  const needCov = q.tokens.length >= 5 ? 0.8 : 0.99;
  let ok = cov >= needCov && (tin >= 0.5 || titleCov >= 0.99);

  if (q.artistTokens && coverage(q.artistTokens, sig(tokens(c.artist || ''))) < 0.99) ok = false;
  if (q.titleTokens && coverage(q.titleTokens, titleFull) < 0.99) ok = false;

  let score = 0.6 * cov + 0.4 * tin;
  // Versiones no pedidas (live, remix, karaoke...) bajan la puntuación.
  const tags = versionTags(`${c.title} ${c.album || ''}`);
  for (const t of tags) if (!q.versions.has(t)) score -= PENALTY;
  // Duración opcional: una grabación de duración muy distinta es otra versión.
  if (q.duration && c.duration && Math.abs(q.duration - c.duration) > 12) score -= PENALTY;
  return { score: Math.max(0, score), accepted: ok && score >= threshold };
}

// Agrupa grabaciones equivalentes (mismo título limpio + artista principal + etiquetas de versión + duración similar).
export function groupCandidates(scored) {
  const buckets = new Map();
  for (const s of scored) {
    const c = s.c;
    const key = [cleanTitle(c.title), primaryArtist(c.artist || ''), [...versionTags(`${c.title} ${c.album || ''}`)].sort().join(',')].join('|');
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(s);
  }
  const groups = [];
  for (const members of buckets.values()) {
    const withDur = members.filter((m) => m.c.duration).sort((a, b) => a.c.duration - b.c.duration);
    const noDur = members.filter((m) => !m.c.duration);
    const clusters = [];
    for (const m of withDur) {
      const last = clusters[clusters.length - 1];
      if (last && m.c.duration - last[last.length - 1].c.duration <= 15) last.push(m); else clusters.push([m]);
    }
    if (!clusters.length) clusters.push([]);
    clusters[0].push(...noDur);
    for (const cl of clusters) if (cl.length) groups.push(cl);
  }
  return groups;
}

export { norm };
