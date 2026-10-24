const int = (env, k, d) => {
  const v = Number.parseInt(env[k] ?? '', 10);
  return Number.isFinite(v) ? v : d;
};
const list = (v, d) => (v ?? d).split(',').map((s) => s.trim()).filter(Boolean);

export function loadConfig(env = process.env, overrides = {}) {
  const cfg = {
    port: int(env, 'PORT', 3000),
    publicUrl: env.PUBLIC_URL || '',
    contact: env.CONTACT_URL || 'https://github.com/tu-usuario/bitchord-max-quality',
    sources: list(env.SOURCES, 'internetarchive,commons,jamendo').map((s) => s.toLowerCase()),
    jamendoClientId: env.JAMENDO_CLIENT_ID || '',
    iaCollections: list(env.IA_COLLECTIONS, 'etree,netlabels,opensource_audio,freemusicarchive,78rpm,georgeblood').filter((c) => c !== '*'),
    iaMaxItems: int(env, 'IA_MAX_ITEMS', 4),
    bases: {
      ia: env.IA_BASE || 'https://archive.org',
      commons: env.COMMONS_BASE || 'https://commons.wikimedia.org',
      jamendo: env.JAMENDO_BASE || 'https://api.jamendo.com/v3.0',
    },
    allowDownloads: int(env, 'ALLOW_DOWNLOADS', 0) ? 1 : 0,
    checkValidLossless: int(env, 'CHECK_VALID_LOSSLESS', 0) ? 1 : 0,
    rateLimitPerMin: int(env, 'RATE_LIMIT_PER_MIN', 120),
    searchDeadlineMs: int(env, 'SEARCH_DEADLINE_MS', 9000),
    streamDeadlineMs: int(env, 'STREAM_DEADLINE_MS', 25000),
    httpTimeoutMs: int(env, 'HTTP_TIMEOUT_MS', 7000),
    probeTimeoutMs: int(env, 'PROBE_TIMEOUT_MS', 8000),
    httpRetries: int(env, 'HTTP_RETRIES', 1),
    maxResults: int(env, 'MAX_RESULTS', 15),
    matchThreshold: Number(env.MATCH_THRESHOLD ?? 0.7),
    // pausa mínima entre peticiones al mismo host (cortesía con las APIs)
    minIntervalMs: { default: 0, 'archive.org': 250, 'commons.wikimedia.org': 150 },
    logLevel: env.LOG_LEVEL || 'info',
  };
  return { ...cfg, ...overrides, bases: { ...cfg.bases, ...(overrides.bases || {}) } };
}
