// Selección de la mejor versión según el nivel pedido por BitChord (LOSSLESS | HIGH | LOW).
const EFF = { opus: 1.5, aac: 1.3, vorbis: 1.2, mp3: 1 }; // eficiencia aproximada por códec (solo para desempatar lossy)

export function normalizeTier(q) {
  const s = String(q || '').toLowerCase();
  if (s.includes('high')) return 'HIGH';
  if (s.includes('low')) return 'LOW';
  return 'LOSSLESS';
}

const lossyScore = (i) => (i.bitrate || 160000) * (EFF[i.codec] || 1);
const pcmSize = (i) => (i.bitDepth || 16) * (i.sampleRate || 44100);

// Clave de ordenación (se compara lexicográficamente; mayor = mejor).
export function rankKey(item, tier) {
  const { info, flags = {} } = item;
  const clean = 1;
  if (info.codec === null) return [0]; // códec no verificable (p. ej. m4a): último recurso
  // Un contenedor sin pérdida cuyo origen declarado es con pérdida (FLAC derivado de MP3) NO cuenta como lossless:
  // queda por debajo de cualquier archivo honesto, incluido el MP3 original.
  const trueLossless = info.lossless && !flags.suspectTranscode;
  if (tier === 'LOSSLESS') {
    if (trueLossless) return [3, clean, info.bitDepth || 0, info.sampleRate || 0, info.codec === 'flac' ? 1 : 0];
    return info.lossless ? [0.5] : [1, lossyScore(info)];
  }
  if (info.lossless) return [trueLossless ? 1 : 0.5, -pcmSize(info)];
  return tier === 'HIGH' ? [3, lossyScore(info)] : [3, -Math.abs((info.bitrate || 160000) - 128000)];
}

const cmp = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] ?? 0) - (b[i] ?? 0); if (d) return d; } return 0; };

export function pickBest(verified, tier) {
  if (!verified.length) return null;
  return [...verified].sort((x, y) => cmp(rankKey(y, tier), rankKey(x, tier)))[0];
}

// Orden previo (solo por lo declarado) para decidir qué archivos merece la pena sondear.
export function priorKey(r, tier) {
  const ext = /\.([a-z0-9]+)(?:$|\?)/i.exec(r.url)?.[1]?.toLowerCase();
  const lossless = r.claimedLossless === true;
  const depth = r.claimedBitDepth || (lossless ? 16 : 0);
  if (tier === 'LOSSLESS') return [lossless ? 2 : 1, depth, r.claimedSampleRate || 0, ext === 'flac' ? 1 : 0];
  return [lossless ? 1 : 2, r.claimedBitrate || 0];
}
export const byPrior = (tier) => (a, b) => cmp(priorKey(b, tier), priorKey(a, tier));
