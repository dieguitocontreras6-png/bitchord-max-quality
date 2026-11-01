#!/usr/bin/env node
/**
 * End-to-end tests against the running addon + real archive.org.
 * Boots the server on a test port, exercises every endpoint, and verifies
 * FLAC truth with Range requests. Exits non-zero on any failure.
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = process.env.TEST_PORT || 8791;
const BASE = `http://127.0.0.1:${PORT}`;

let failures = 0;
let passes = 0;

function check(name, cond, detail = '') {
  if (cond) {
    passes++;
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
  }
}

async function j(url, opts) {
  const res = await fetch(url, opts);
  let body = null;
  try { body = await res.json(); } catch {}
  return { status: res.status, body, headers: res.headers };
}

async function waitForHealth() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return true;
    } catch {}
    await sleep(500);
  }
  return false;
}

async function main() {
  console.log('Booting addon on', BASE);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', (d) => process.stderr.write('[server] ' + d));

  try {
    check('server /health answers', await waitForHealth());

    // ── Health ──
    {
      const { status, body } = await j(`${BASE}/health`);
      check('health 200 + ok', status === 200 && body.ok === true);
    }

    // ── Manifest ──
    let manifest;
    {
      const { status, body } = await j(`${BASE}/manifest.json`);
      manifest = body;
      check('manifest 200', status === 200);
      check('manifest declares search', Array.isArray(body.resources) && body.resources.some((r) => String(r).toLowerCase() === 'search'));
      check('manifest allowDownloads=false (licensing principle)', body.allowDownloads === false);
    }

    // ── Search (real archive.org) ──
    let tracks = [];
    {
      const { status, body } = await j(`${BASE}/search?q=grateful%20dead&quality=LOSSLESS`);
      check('search 200', status === 200);
      check('search returns tracks array', Array.isArray(body.tracks));
      tracks = body.tracks || [];
      check('search found FLAC rows', tracks.length > 0, `got ${tracks.length}`);
      check('every row declares format=flac', tracks.every((t) => t.format === 'flac'));
      check('every row has id/title', tracks.every((t) => t.id && t.title));
      check('every row carries streamURL + artworkURL', tracks.every((t) => typeof t.streamURL === 'string' && t.streamURL.startsWith('http') && typeof t.artworkURL === 'string'));
      if (tracks[0]) console.log(`  info  first row: ${tracks[0].title} — ${tracks[0].artist}`);
    }

    if (tracks.length === 0) {
      console.error('No tracks — cannot continue stream tests.');
      process.exit(1);
    }

    // ── Stream descriptor ──
    const track = tracks.find((t) => t.duration) || tracks[0];
    let streamUrl;
    {
      const { status, body } = await j(`${BASE}/stream/${encodeURIComponent(track.id)}`);
      check('stream 200', status === 200);
      check('stream format exactly "flac"', body.format === 'flac');
      check('stream encrypted=false', body.encrypted === false);
      check('stream has url', typeof body.url === 'string' && body.url.startsWith('http'));
      check('stream quality LOSSLESS', String(body.quality).toUpperCase().includes('LOSSLESS'));
      check('stream sampleRate plausible when present', body.sampleRate === undefined || (body.sampleRate >= 8000 && body.sampleRate <= 192000));
      console.log(`  info  stream: ${body.sampleRate || '?'} Hz / ${body.bitDepth || '?'} bit / ${body.bitrate || '?'} kbps`);
      streamUrl = body.url;
    }

    // ── Byte proxy + FLAC truth via Range ──
    {
      const res = await fetch(streamUrl, { headers: { Range: 'bytes=0-3' } });
      check('audio Range 0-3 -> 206', res.status === 206, `status ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      check('audio first 4 bytes are fLaC magic', buf.length === 4 && buf.toString('latin1') === 'fLaC', buf.toString('latin1'));
      check('audio Content-Range present', !!res.headers.get('content-range'));
    }
    {
      const res = await fetch(streamUrl, { headers: { Range: 'bytes=1000-1999' } });
      check('audio mid Range -> 206', res.status === 206);
      const cr = res.headers.get('content-range') || '';
      check('audio Content-Range starts at 1000', cr.startsWith('bytes 1000-'), cr);
      const buf = Buffer.from(await res.arrayBuffer());
      check('audio mid Range length 1000', buf.length === 1000, `len ${buf.length}`);
    }
    {
      const res = await fetch(streamUrl, { method: 'HEAD' });
      check('audio HEAD -> 200/206', res.status === 200 || res.status === 206);
      check('audio HEAD advertises Accept-Ranges', (res.headers.get('accept-ranges') || '') === 'bytes');
    }

    // ── Artwork ──
    {
      const res = await fetch(track.artworkURL);
      check('artwork 200 + image', res.status === 200 && String(res.headers.get('content-type') || '').startsWith('image/'), `status ${res.status}`);
    }

    // ── Error paths ──
    {
      const { status, body } = await j(`${BASE}/stream/ia-bogusbogusbogus`);
      check('stream unknown id -> 404 JSON', status === 404 && typeof body.error === 'string');
      const { status: s2 } = await j(`${BASE}/stream/not-a-valid-id`);
      check('stream foreign id -> 404', s2 === 404);
      const { status: s3, body: b3 } = await j(`${BASE}/search?q=`);
      check('search empty q -> empty tracks', s3 === 200 && Array.isArray(b3.tracks) && b3.tracks.length === 0);
    }

    // ── Quality param variants don't break anything ──
    {
      const { status, body } = await j(`${BASE}/search?q=ella%20fitzgerald&quality=HIGH`);
      check('search quality=HIGH works', status === 200 && Array.isArray(body.tracks));
    }
  } finally {
    child.kill('SIGTERM');
  }

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
