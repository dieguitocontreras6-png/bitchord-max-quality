import { createInternetArchive } from './internetArchive.js';
import { createCommons } from './commons.js';
import { createJamendo } from './jamendo.js';

const FACTORIES = { internetarchive: createInternetArchive, commons: createCommons, jamendo: createJamendo };

export function buildSources(deps) {
  const out = [];
  for (const name of deps.cfg.sources) {
    const f = FACTORIES[name];
    if (!f) { deps.log.warn('source.unknown', { name }); continue; }
    const s = f(deps);
    if (!s) { deps.log.warn('source.disabled', { name, reason: 'falta configuración (p. ej. JAMENDO_CLIENT_ID)' }); continue; }
    out.push(s);
  }
  return out;
}
