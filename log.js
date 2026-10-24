const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

export function createLogger(level = 'info', sink = (line) => process.stdout.write(line + '\n')) {
  const min = LEVELS[level] ?? 20;
  const emit = (lvl, evt, data) => {
    if (LEVELS[lvl] < min) return;
    sink(JSON.stringify({ ts: new Date().toISOString(), level: lvl, evt, ...data }));
  };
  return {
    debug: (e, d = {}) => emit('debug', e, d),
    info: (e, d = {}) => emit('info', e, d),
    warn: (e, d = {}) => emit('warn', e, d),
    error: (e, d = {}) => emit('error', e, d),
  };
}
