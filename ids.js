// El id de pista es opaco y sin estado: codifica hasta 3 referencias [fuente, ...campos].
// Así /stream/{id} sigue funcionando aunque el servicio gratuito de Render se reinicie.
const MAX_REFS = 3;

export function encodeRefs(refs) {
  return Buffer.from(JSON.stringify(refs.slice(0, MAX_REFS)), 'utf8').toString('base64url');
}

export function decodeRefs(id, knownSources) {
  try {
    if (typeof id !== 'string' || id.length > 2000) return null;
    const refs = JSON.parse(Buffer.from(id, 'base64url').toString('utf8'));
    if (!Array.isArray(refs) || !refs.length || refs.length > MAX_REFS) return null;
    for (const r of refs) {
      if (!Array.isArray(r) || r.length < 2 || r.length > 4) return null;
      if (!knownSources.includes(r[0])) return null;
      if (r.some((x) => typeof x !== 'string' || x.length > 400)) return null;
    }
    return refs;
  } catch { return null; }
}
