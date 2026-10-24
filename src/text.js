// Normalización de texto, detección de versiones y similitud.
const STOP = new Set(['the', 'a', 'an', 'and', 'of', 'feat', 'ft', 'featuring', 'with', 'by', 'official', 'audio', 'video', 'lyrics', 'hd']);

export const fold = (s) => String(s ?? '').normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase();
export const norm = (s) => fold(s).replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
export const tokens = (s) => norm(s).split(' ').filter(Boolean);
// Tokens significativos (sin palabras vacías); si todo es vacío se conservan.
export const sig = (toks) => { const t = toks.filter((x) => !STOP.has(x)); return t.length ? t : toks; };

const VERSION_RULES = [
  ['live', /\b(live|en vivo|concert|unplugged)\b/],
  ['remix', /\b(remix|rmx|re edit|bootleg|mashup)\b/],
  ['acoustic', /\b(acoustic|acustico)\b/],
  ['instrumental', /\binstrumental\b/],
  ['karaoke', /\b(karaoke|backing track|minus one)\b/],
  ['demo', /\b(demo|rough mix|outtake|alternate take|alt take)\b/],
  ['cover', /\b(cover|tribute|in the style of|made famous)\b/],
  ['edit', /\b(radio edit|single edit)\b/],
  ['extended', /\b(extended|club mix|dub mix)\b/],
  ['sped', /\b(sped up|slowed|reverb|nightcore|8d)\b/],
];
export function versionTags(s) {
  const n = ` ${norm(s)} `;
  return new Set(VERSION_RULES.filter(([, re]) => re.test(n)).map(([k]) => k));
}

// Título "limpio": sin corchetes/paréntesis ni sufijos de versión (" - 2011 Remaster").
export function cleanTitle(t) {
  let s = String(t ?? '').replace(/[([][^)\]]*[)\]]/g, ' ');
  s = s.replace(/\s[-–—]\s.*\b(remaster\w*|mono|stereo|live|remix|version|edit|mix|acoustic|instrumental|demo)\b.*$/i, ' ');
  return norm(s);
}

const eqTok = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && Math.abs(a.length - b.length) <= 1 && (a.startsWith(b) || b.startsWith(a)));
// Fracción de tokens de `needles` presentes en `hay`.
export function coverage(needles, hay) {
  if (!needles.length) return 0;
  return needles.filter((n) => hay.some((h) => eqTok(n, h))).length / needles.length;
}

export function dice(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const grams = (s) => { const t = ` ${s} `; const m = new Map(); for (let i = 0; i < t.length - 1; i++) { const g = t.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
  const ga = grams(a), gb = grams(b); let inter = 0;
  for (const [g, n] of ga) inter += Math.min(n, gb.get(g) || 0);
  return (2 * inter) / (a.length + b.length);
}

export const primaryArtist = (a) => norm(a).replace(/^the /, '').split(/ (?:feat|ft|featuring|and|x|with) /)[0];

// Consulta: texto libre (lo que envía BitChord) + restricciones opcionales title/artist/album/duration.
export function parseQuery(q, p = {}) {
  const raw = String(q ?? '').trim().slice(0, 200);
  const text = [p.title, p.artist, p.album, raw].filter(Boolean).join(' ');
  return {
    raw: raw || text,
    tokens: sig(tokens(text)),
    artistTokens: p.artist ? sig(tokens(p.artist)) : null,
    titleTokens: p.title ? sig(tokens(p.title)) : null,
    versions: versionTags(text),
    duration: Number(p.duration) > 0 ? Number(p.duration) : null,
  };
}
