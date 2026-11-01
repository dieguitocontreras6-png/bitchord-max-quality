# Resultados de pruebas — openlossless-bitchord-addon

**Fecha:** 2026-11-01 · **Entorno:** Node v24.22.1 (Linux) · **Red:** real hacia archive.org
**Cómo reproducir:** `npm test` (levanta el servidor en un puerto de prueba y ejecuta la suite)

> Todas las pruebas de abajo fueron EJECUTADAS contra el código actual del
> repositorio y contra archive.org en vivo. Nada está simulado.

## Suite e2e (`tests/e2e.mjs`) — 30/30 PASS

```
  PASS  server /health answers
  PASS  health 200 + ok
  PASS  manifest 200
  PASS  manifest declares search
  PASS  manifest allowDownloads=false (licensing principle)
  PASS  search 200
  PASS  search returns tracks array
  PASS  search found FLAC rows
  PASS  every row declares format=flac
  PASS  every row has id/title
  PASS  every row carries streamURL + artworkURL
  info  first row: Tuning '77 — Grateful Dead
  PASS  stream 200
  PASS  stream format exactly "flac"
  PASS  stream encrypted=false
  PASS  stream has url
  PASS  stream quality LOSSLESS
  PASS  stream sampleRate plausible when present
  info  stream: 44100 Hz / 24 bit / 1260 kbps
  PASS  audio Range 0-3 -> 206
  PASS  audio first 4 bytes are fLaC magic
  PASS  audio Content-Range present
  PASS  audio mid Range -> 206
  PASS  audio Content-Range starts at 1000
  PASS  audio mid Range length 1000
  PASS  audio HEAD -> 200/206
  PASS  audio HEAD advertises Accept-Ranges
  PASS  artwork 200 + image
  PASS  stream unknown id -> 404 JSON
  PASS  stream foreign id -> 404
  PASS  search empty q -> empty tracks
  PASS  search quality=HIGH works

30 passed, 0 failed
```

## Comprobaciones manuales adicionales (curl)

- `q=mozart` → primeras filas: *Wolfgang Amadeus Mozart — Magic Flute Overture
  (Czech National Symphony Orchestra)*, etc. (ranking local correcto).
- `q=radiohead` → 40 filas FLAC (Nine Inch Nails — Ghosts I-IV, ítem de IA
  que menciona la consulta); todas `format:"flac"`.
- Búsqueda estable en llamadas repetidas (caché de 10 min activa).

## Incidencias reales encontradas y corregidas durante la Fase 5

1. `archive.org/download/…` redirigió a un nodo caído (`dn720606.ca.archive.org`
   → HTTP 500) → **fix:** URL directa por réplica (`workable_servers`/`d1`/`d2`)
   con el redirector como último recurso.
2. La metadata entregó un nodo réplica caído (`ia800903` → connect timeout,
   confirmado también con curl) → **fix:** failover entre réplicas + memoria
   de hosts enfermos (10 min) + timeout de cabecera 12 s.
3. Un error de red dentro del verificador FLAC hacía 500 → **fix:** `probeFlac`
   nunca lanza; reporta `{flac:false, reason}` y se recorre al siguiente candidato.

## No ejecutado (honestidad)

- `docker build` (Docker no está disponible en este entorno). El Dockerfile
  solo hace `COPY` + `CMD node` sin pasos de compilación; validar en el deploy.
- Prueba en dispositivo físico BitChord (requiere la URL pública desplegada).
