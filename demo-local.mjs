// Demostración local: addon real + fuentes SIMULADAS (no usa Internet). Útil para ver el formato de las respuestas.
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/server.js';
import { startMock } from '../test/helpers/mock.js';
import { makeFlac, makeMp3 } from '../test/helpers/fixtures.js';

const ART = 'Example Artist';
const state = {
  iaDocs: [{ identifier: 'night-drive', title: 'Night Drive', creator: ART, downloads: 1 }],
  iaMeta: { 'night-drive': { metadata: { identifier: 'night-drive', title: 'Night Drive', creator: ART }, files: [
    { name: '01 Midnight Signal.flac', source: 'original', format: 'Flac', title: 'Midnight Signal', artist: ART, length: '242.5' },
    { name: '01 Midnight Signal.mp3', source: 'derivative', format: 'VBR MP3', original: '01 Midnight Signal.flac' }] } },
  files: {
    '01 Midnight Signal.flac': { buf: makeFlac({ totalSamples: 44100 * 242, size: 150000 }) },
    '01 Midnight Signal.mp3': { buf: makeMp3({ vbr: true }), type: 'audio/mpeg' },
    'jm/555.flac': { buf: makeFlac({ bitDepth: 24, sampleRate: 96000, totalSamples: 96000 * 243, size: 400000 }) },
  },
  commonsPages: [], jmTracks: {},
  jmSearch: [{ id: '555', name: 'Midnight Signal', artist_name: ART, album_name: 'Night Drive', duration: 243, image: 'https://img.example/555.jpg' }],
};
const mock = await startMock(state);
state.jmTracks['555'] = { flac: `${mock.base}/jm/555.flac` };
const { server } = createApp({ cfg: loadConfig({}, { jamendoClientId: 'demo', bases: { ia: mock.base, commons: mock.base, jamendo: `${mock.base}/v3.0` }, minIntervalMs: { default: 0 }, logLevel: 'silent' }) });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const b = `http://127.0.0.1:${server.address().port}`;
const show = async (label, path) => { const r = await fetch(b + path); console.log(`\n$ GET ${label}  -> HTTP ${r.status}\n${JSON.stringify(await r.json(), null, 2)}`); return path; };
const s = await (await fetch(`${b}/search?q=${encodeURIComponent('Midnight Signal Example Artist')}&quality=lossless`)).json();
console.log(`$ GET /search?q=Midnight%20Signal%20Example%20Artist&quality=lossless\n${JSON.stringify(s, null, 2)}`);
await show('/stream/<id>?quality=lossless', `/stream/${s.tracks[0].id}?quality=lossless`);
await show('/stream/<id>?quality=high', `/stream/${s.tracks[0].id}?quality=high`);
await show('/search?q=zzzz+qqqq', '/search?q=zzzz+qqqq');
process.exit(0);
