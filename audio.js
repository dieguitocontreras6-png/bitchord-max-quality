// Lectura de cabeceras reales de audio. Todo lo que se declara como "calidad" sale de aquí,
// no de etiquetas de la fuente. Funciona sobre los primeros bytes del archivo.

const ascii = (b, s, e) => b.toString('latin1', s, e);

export function id3Length(buf) {
  if (buf.length >= 10 && ascii(buf, 0, 3) === 'ID3') {
    const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
    return 10 + size + (buf[5] & 0x10 ? 10 : 0);
  }
  return 0;
}

// FLAC: marcador "fLaC" + bloque STREAMINFO (34 bytes) obligatoriamente primero.
export function parseFlac(buf, base = 0) {
  if (buf.length < base + 42 || ascii(buf, base, base + 4) !== 'fLaC') return null;
  const type = buf[base + 4] & 0x7f;
  const len = (buf[base + 5] << 16) | (buf[base + 6] << 8) | buf[base + 7];
  if (type !== 0 || len !== 34) return null;
  const o = base + 8;
  const sampleRate = (buf[o + 10] << 12) | (buf[o + 11] << 4) | (buf[o + 12] >> 4);
  const channels = ((buf[o + 12] >> 1) & 7) + 1;
  const bitDepth = (((buf[o + 12] & 1) << 4) | (buf[o + 13] >> 4)) + 1;
  const total = (buf[o + 13] & 15) * 2 ** 32 + (buf[o + 14] * 2 ** 24 + (buf[o + 15] << 16) + (buf[o + 16] << 8) + buf[o + 17]);
  if (sampleRate < 1 || bitDepth < 4) return null;
  return { container: 'flac', codec: 'flac', lossless: true, sampleRate, bitDepth, channels, durationSec: total ? total / sampleRate : null };
}

export function parseWav(buf) {
  if (buf.length < 12 || ascii(buf, 0, 4) !== 'RIFF' || ascii(buf, 8, 12) !== 'WAVE') return null;
  let p = 12, fmt = null;
  while (p + 8 <= buf.length) {
    const id = ascii(buf, p, p + 4), size = buf.readUInt32LE(p + 4);
    if (id === 'fmt ') {
      if (p + 24 > buf.length) return null;
      let tag = buf.readUInt16LE(p + 8), bits = buf.readUInt16LE(p + 22);
      if (tag === 0xfffe && size >= 40 && p + 34 <= buf.length) { bits = buf.readUInt16LE(p + 26) || bits; tag = buf.readUInt16LE(p + 32); }
      fmt = { tag, channels: buf.readUInt16LE(p + 10), sampleRate: buf.readUInt32LE(p + 12), blockAlign: buf.readUInt16LE(p + 20), bits };
    } else if (id === 'data') {
      if (!fmt) return null;
      const known = size > 0 && size !== 0xffffffff && fmt.blockAlign > 0;
      const durationSec = known ? size / fmt.blockAlign / fmt.sampleRate : null;
      const pcm = fmt.tag === 1 || fmt.tag === 3;
      return {
        container: 'wav', codec: pcm ? 'pcm' : `wav-${fmt.tag}`, lossless: pcm, float: fmt.tag === 3,
        sampleRate: fmt.sampleRate, bitDepth: pcm ? fmt.bits : undefined, channels: fmt.channels, durationSec,
      };
    }
    p += 8 + size + (size & 1);
  }
  return null;
}

const MP3_BR = { 3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], 2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160], 0: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] };
const MP3_SR = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

export function parseMp3(buf, start = 0) {
  const end = Math.min(buf.length - 4, start + 8192);
  for (let i = start; i < end; i++) {
    if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) continue;
    const ver = (buf[i + 1] >> 3) & 3, layer = (buf[i + 1] >> 1) & 3, br = (buf[i + 2] >> 4) & 15, sr = (buf[i + 2] >> 2) & 3;
    if (ver === 1 || layer !== 1 || br === 0 || br === 15 || sr === 3) continue;
    const mono = ((buf[i + 3] >> 6) & 3) === 3;
    const side = ver === 3 ? (mono ? 17 : 32) : (mono ? 9 : 17);
    const tag = ascii(buf, i + 4 + side, i + 8 + side);
    const vbr = tag === 'Xing' || ascii(buf, i + 36, i + 40) === 'VBRI';
    return { container: 'mp3', codec: 'mp3', lossless: false, sampleRate: MP3_SR[ver][sr], channels: mono ? 1 : 2, bitrate: vbr ? null : MP3_BR[ver][br] * 1000, vbr, durationSec: null };
  }
  return null;
}

export function parseOgg(buf) {
  if (buf.length < 40 || ascii(buf, 0, 4) !== 'OggS') return null;
  const p = 27 + buf[26];
  const head = buf.subarray(p);
  if (ascii(head, 0, 8) === 'OpusHead') return { container: 'ogg', codec: 'opus', lossless: false, channels: head[9], sampleRate: 48000, bitrate: null };
  if (head[0] === 1 && ascii(head, 1, 7) === 'vorbis') {
    const nominal = head.readInt32LE(20);
    return { container: 'ogg', codec: 'vorbis', lossless: false, channels: head[11], sampleRate: head.readUInt32LE(12), bitrate: nominal > 0 ? nominal : null };
  }
  if (head[0] === 0x7f && ascii(head, 1, 5) === 'FLAC') {
    const f = parseFlac(buf, p + 9);
    return f ? { ...f, container: 'ogg' } : null;
  }
  return null;
}

// Devuelve info, null (no es audio reconocible) o { incomplete, nextOffset } si hace falta leer más.
export function sniffAudio(buf) {
  const off = id3Length(buf);
  if (off >= buf.length - 16) return { incomplete: true, nextOffset: off };
  const b = off ? buf.subarray(off) : buf;
  if (ascii(b, 0, 4) === 'fLaC') return parseFlac(b);
  if (ascii(b, 0, 4) === 'RIFF') return parseWav(b);
  if (ascii(b, 0, 4) === 'OggS') return parseOgg(b);
  if (b.length > 12 && ascii(b, 4, 8) === 'ftyp') return { container: 'mp4', codec: null, lossless: null };
  return parseMp3(b);
}

const KHZ = (hz) => `${+(hz / 1000).toFixed(1)} kHz`;
const NAMES = { flac: 'FLAC', pcm: 'PCM/WAV', mp3: 'MP3', opus: 'Opus', vorbis: 'Vorbis', aac: 'AAC' };

// Etiqueta honesta basada únicamente en lo verificado.
export function describe(info) {
  if (info.lossless) {
    const depth = info.bitDepth ? `${info.bitDepth}-bit` : '?-bit';
    return `Lossless · ${depth} / ${KHZ(info.sampleRate)} (${NAMES[info.codec] || info.codec})`;
  }
  if (info.codec === null) return `${(info.container || 'audio').toUpperCase()} · codec not verified`;
  const name = NAMES[info.codec] || info.container?.toUpperCase() || 'Audio';
  const br = info.bitrate ? `${Math.round(info.bitrate / 1000)} kbps` : 'VBR';
  return `${name} · ${br} (lossy)`;
}

// Nivel de calidad para el campo audioQuality del contrato de BitChord.
export function tierOf(info) {
  if (info.lossless) return 'LOSSLESS';
  return info.bitrate && info.bitrate < 160000 ? 'LOW' : 'HIGH';
}
