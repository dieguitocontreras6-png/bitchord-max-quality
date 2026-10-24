# BitChord Max Quality (addon)

Addon para BitChord que busca en varias fuentes con licencia libre/acceso autorizado, elige la grabación correcta y
entrega **la mejor calidad que el archivo realmente tiene**, leyendo la cabecera real (FLAC `STREAMINFO`, WAV `fmt `, MP3/Ogg).
Sin dependencias de npm (solo Node ≥ 20).

## Estado: qué está hecho y qué no

| | Estado |
|---|---|
| Implementado | Manifest, `/search`, `/stream/{id}`, 3 adaptadores (Internet Archive, Wikimedia Commons, Jamendo), puntuación de coincidencias, agrupación de duplicados/versiones, verificación de archivos, selector de calidad, caché, límites, timeouts, logs JSON |
| Probado localmente | 35 pruebas automáticas (`npm test`): parsers contra archivos reales generados con ffmpeg (FLAC 16/24 bit, WAV 24 bit, MP3, Opus) y contra cabeceras sintéticas; búsqueda y selección; flujo HTTP completo contra **servidores simulados** (URL 404/410/503, HTML disfrazado de audio, `.flac` que en realidad es MP3, etiqueta "24bit" falsa, timeout, 429) |
| Probado contra servicios reales | **Nada.** El entorno donde se desarrolló no tenía acceso a Internet. `test/integration/live.test.js` existe pero no pudo ejecutarse contra las fuentes reales (en ese entorno sus pruebas se omiten porque no hay resultados). Ejecútalo tú (ver abajo) antes de fiarte de la cobertura |
| Pendiente | Subir a GitHub, desplegar en Render, correr las pruebas de integración con red, añadirlo en BitChord y probar con tu dispositivo |
| Sin acceso | No tuve acceso a tu repositorio, por eso entrego este proyecto completo como ZIP |

## Contrato de BitChord (leído en la documentación oficial)

Fuente: <https://bitchord.kushagrasingh.in/docs> (guía de addons). Se implementa exactamente eso:

- `GET /manifest.json` → `id` (obligatorio), `name`, `version`, `resources: ["search","stream"]`, `allowDownloads`, `checkValidLossless`.
- `GET /search?q=…&quality=…&atmos=…` → `{ "tracks": [ { id, title, artist, album, duration, artworkURL, format, audioQuality } ] }`.
- `GET /stream/{id}?quality=…` → `{ url, format, quality, codec, container, manifest:"none", encrypted:false, sampleRate, bitDepth, bitrate }`; `404` = "no está en este addon", `429` con `Retry-After`.
- BitChord envía `quality` = `LOSSLESS | HIGH | LOW`; el addon lo respeta y **no sobreestima**: BitChord solo da insignia lossless según el códec que decodifica.

Decisiones: `allowDownloads: 0` por defecto (las licencias varían por pista; p. ej. Jamendo permite desactivar descargas por artista), `checkValidLossless: 0` (para que el fallback lossy siga funcionando en altavoz/Bluetooth), Dolby Atmos no se ofrece (con `atmos=auto` siempre se devuelve estéreo, como pide la guía). Cambiables por variables de entorno.

Limitación del contrato: el addon devuelve **una** rendición por petición; la selección automática de la mejor calidad se hace dentro del addon (sondea hasta 6 archivos candidatos de hasta 3 fuentes y elige). BitChord no compara entre addons por calidad real, solo sigue el orden de fuentes que elija el usuario: pon este addon el primero en *Settings → Sources*.

## Cómo se elige la calidad

1. Cada candidato se descarga parcialmente (Range, 64 KB) y se lee la cabecera real. Si la URL falla, devuelve HTML o no es audio reconocible, **se descarta**.
2. `LOSSLESS`: sin pérdida verificado > mayor profundidad de bits > mayor frecuencia de muestreo > FLAC antes que WAV. Si solo hay lossy, se devuelve con etiqueta `(lossy)`.
3. `HIGH`: mejor lossy (bitrate, ponderado por códec); `LOW`: lossy más cercano a 128 kbps.
4. La etiqueta (`quality`, `bitDepth`, `sampleRate`) sale **solo de la cabecera**, nunca de la etiqueta de la fuente. Un `.flac` con MP3 dentro se informa como MP3. Una etiqueta "24bit Flac" con un archivo de 16 bit se informa como 16 bit.
5. Nunca se convierte ni se reescala nada.

**Limitación honesta:** la cabecera prueba el contenedor, no el origen. Un FLAC hecho a partir de un MP3 tiene cabecera FLAC válida (hay una prueba que lo documenta). Solo se detecta cuando la fuente lo declara (Internet Archive: archivo derivado cuyo `original` es lossy); en ese caso se baja de prioridad y se avisa en `quality`. No hay análisis espectral.

## Fuentes

| Fuente | Qué aporta | Límites conocidos |
|---|---|---|
| Internet Archive (`advancedsearch` + Metadata API + `/download/`) | Grabaciones reales, incl. FLAC; algunas con 24 bit (p. ej. etree) | La búsqueda es por ítem, no por pista: una canción dentro de un álbum solo se encuentra si el título/descr./artista del ítem contiene los términos. Filtro de colecciones por defecto (`IA_COLLECTIONS`) para quedarse con material curado/permitido; puede reducir cobertura. Calidad muy variable |
| Wikimedia Commons (MediaWiki API, `filetype:audio`) | Audio con licencia libre (CC/dominio público) | Catálogo pequeño y poco "comercial"; sin duración ni álbum |
| Jamendo (API v3.0 `/tracks`, `audioformat=flac`/`mp32`) | Música CC independiente; FLAC pedido primero y verificado | Requiere tu `client_id` gratuito; licencias CC (algunas NC); usa el campo `audio` (streaming), no `audiodownload` |

**No integrado, a propósito:** catálogos comerciales de alta resolución (Qobuz, Tidal, Apple Music, Amazon, etc.). No ofrecen una API pública de streaming hi-res sin acuerdo/suscripción y/o usan DRM, y el encargo prohíbe saltarse eso. Si tienes acceso autorizado a alguno, se añade como un adaptador más (`src/sources/*.js`, interfaz `{ key, name, search(q, ctx), renditions(ref, ctx) }`) sin tocar el resto. Los esquemas de respuesta de Jamendo se contrastaron con su documentación oficial; los de Internet Archive (Metadata API) con documentación parcial; los de Commons y el formato exacto de `advancedsearch` **no se contrastaron con la API real** — ahí está el mayor riesgo de ajustes tras la primera ejecución con red.

Eres responsable de que el uso de cada fuente cumpla sus términos y licencias en tu país.

## Variables de entorno

| Variable | Defecto | Uso |
|---|---|---|
| `PORT` | 3000 | Puerto (Render lo inyecta) |
| `SOURCES` | `internetarchive,commons,jamendo` | Fuentes activas |
| `JAMENDO_CLIENT_ID` | — | Necesaria para Jamendo (sin ella se desactiva con un aviso en el log) |
| `IA_COLLECTIONS` | `etree,netlabels,opensource_audio,freemusicarchive,78rpm,georgeblood` | Colecciones permitidas en IA (`*` = sin filtro) |
| `IA_MAX_ITEMS` | 4 | Ítems de IA cuyos archivos se examinan por búsqueda |
| `ALLOW_DOWNLOADS` / `CHECK_VALID_LOSSLESS` | 0 / 0 | Interruptores del manifest |
| `CONTACT_URL` | — | Se añade al User-Agent (pónlo con tu repo/contacto) |
| `RATE_LIMIT_PER_MIN` | 120 | Límite por IP |
| `SEARCH_DEADLINE_MS` / `STREAM_DEADLINE_MS` | 9000 / 25000 | Límites de tiempo |
| `MATCH_THRESHOLD` | 0.7 | Umbral de coincidencia |
| `LOG_LEVEL` | info | `debug|info|warn|error|silent` |

## Uso local

```bash
npm test                      # 35 pruebas, sin red
cp .env.example .env          # y exporta las variables, o: JAMENDO_CLIENT_ID=... npm start
npm start
curl "http://localhost:3000/manifest.json"
curl "http://localhost:3000/search?q=Gymnopedie%20Satie&quality=lossless"
# Pruebas de integración REALES (necesitan Internet):
RUN_INTEGRATION=1 JAMENDO_CLIENT_ID=xxxx npm run test:integration
node scripts/demo-local.mjs   # demo con fuentes simuladas
```

## Subir a GitHub y desplegar en Render

1. Descomprime el ZIP, entra en la carpeta y ejecuta:
   ```bash
   git init && git add . && git commit -m "BitChord Max Quality"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/bitchord-max-quality.git
   git push -u origin main
   ```
   (crea antes el repositorio vacío en github.com). Si ya tienes un repo, copia estos archivos dentro y haz commit.
2. En Render: **New → Blueprint** y elige el repo (usa `render.yaml`), o **New → Web Service** con *Build* `npm install`, *Start* `npm start`, *Health check path* `/healthz`.
3. En *Environment* añade `JAMENDO_CLIENT_ID` y `CONTACT_URL`.
4. Cuando termine, abre `https://TU-SERVICIO.onrender.com/manifest.json` y comprueba que devuelve el JSON.
5. En BitChord: **Settings → Sources → Add an addon**, pega `https://TU-SERVICIO.onrender.com`, pasa el *health check* y ordénalo el primero.

Notas: el plan gratuito de Render suspende el servicio tras un rato sin tráfico (la primera petición tarda; verifica los detalles actuales en su documentación). Los ids de pista no dependen de memoria del servidor, así que siguen siendo válidos tras un reinicio.

## Ejemplos

Salida real de `node scripts/demo-local.mjs` (addon real, **fuentes simuladas**; el `bitrate` de 24/96 es bajo porque el archivo de prueba es diminuto):

```text
GET /search?q=Midnight%20Signal%20Example%20Artist&quality=lossless
{ "tracks": [ { "id": "W1siaWEi…", "title": "Midnight Signal", "artist": "Example Artist",
    "album": "Night Drive", "duration": 243, "artworkURL": "…/services/img/night-drive", "audioQuality": "LOSSLESS" } ] }

GET /stream/<id>?quality=lossless      (IA ofrece FLAC 16/44.1; la otra fuente, FLAC 24/96 → gana el verificado de 24 bit)
{ "url": "…/jm/555.flac", "format": "flac", "quality": "Lossless · 24-bit / 96 kHz (FLAC)", "codec": "flac",
  "container": "flac", "manifest": "none", "encrypted": false, "sampleRate": 96000, "bitDepth": 24, "bitrate": 13169 }

GET /stream/<id>?quality=high
{ "url": "…/01%20Midnight%20Signal.mp3", "format": "mp3", "quality": "MP3 · VBR (lossy)", "codec": "mp3",
  "container": "mp3", "manifest": "none", "encrypted": false, "sampleRate": 44100 }

GET /search?q=zzzz+qqqq   →  { "tracks": [] }
```

## Estructura

```
src/server.js      HTTP + manifest + límites          src/service.js   búsqueda unificada y resolución de stream
src/sources/*.js   adaptadores por fuente             src/match.js     puntuación y agrupación de versiones
src/audio.js       lectura de cabeceras (FLAC/WAV/MP3/Ogg)   src/select.js   selector por nivel
src/http.js        timeouts/reintentos/Range          src/cache.js     caché TTL        src/ids.js   ids sin estado
test/              unitarias + e2e simuladas          test/integration/ pruebas con red real (manuales)
```

## Puntos que conviene revisar tras la primera ejecución real

- Que `advancedsearch` de Internet Archive devuelva `response.docs` con los campos pedidos y que el filtro `IA_COLLECTIONS` no deje la búsqueda vacía para tu repertorio.
- Que Commons devuelva `query.pages` con `imageinfo` y `extmetadata` como se espera.
- Cómo trata BitChord `codec: "pcm"` para WAV (la guía lista `flac, alac, mp3, aac, eac3-joc, and others`).
- Que `/stream` responda dentro del tiempo con los archivos grandes de IA (sondeo de 64 KB por candidato).
