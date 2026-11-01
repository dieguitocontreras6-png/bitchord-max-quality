# Fase 0 — Diagnóstico técnico de compatibilidad (verificado en código fuente)

Inspección de `/research/BitChord` (app Android) y `/research/bitchord-selfhosted-addon`
(referencia Go, MIT) realizada antes de escribir una línea del addon.

## 1. Protocolo addon de BitChord — lo que el código dice exactamente

**Descubierto en** `app/src/main/java/com/music/bitchord/data/sources/addon/`
(`SourceFormats.kt`, `AddonModels.kt`, `AddonClient.kt`):

- **Identificación de URL** (`SourceFormats.identify`): recorta `/` final →
  prueba `{base}/manifest.json` → si el body es JSON con `resources` (o trio
  id/name/version) es un addon → **`resources` no vacío sin `search` se
  rechaza** → fallback final: `GET {base}/search?q=music` (constante
  `PROBE_QUERY = "music"`). Conclusión: el manifest es casi opcional, pero
  declararlo bien evita el síntoma de addon sintetizado.
- **Búsqueda** (`AddonClient.search`): `GET /search?q=<query>&<settings>&quality=<tier>`
  con tier ∈ `LOSSLESS|HIGH|LOW`; **sin parámetro limit**. Respuesta leída:
  `{"tracks":[…]}` con `id,title,artist,album,duration(double),artworkURL,
  albumArtworkURL,format,audioQuality,audioMode(s),atmos,streamURL`.
  Si la fila trae **`streamURL`, la app NO llama a `/stream`** (una vuelta
  menos antes del audio).
- **Stream** (`AddonClient.stream`): `GET /stream/{id}` con id como *path
  segment*. Descriptor `AddonStream`: `url` (imprescindible para sonar),
  `format` texto libre (`flac`), `codec/container`, `manifest:"none"` para
  archivo plano, `encrypted` — **cualquier valor distinto de false/absente/
  "none" se rechaza**; `sampleRate` <1000 se multiplica ×1000; `bitrate`
  >3000 se lee como bits/s; un `{"error":…}` con HTTP 200 cuenta como miss
  y BitChord pasa a la siguiente fuente.
- **Manifest**: `allowDownloads` — *ausente significa permitido*, `false`/"0"
  hace que la app omita la descarga (leído en `AddonSource` → `updatePolicy`).
  `settings`: los defaults declarados viajan en cada request y el tier sobreescribe
  `quality` (matcheado contra `options` si se declara un setting con esa key).
- **Cliente HTTP**: OkHttp, UA `BitChord/v<version>`, Accept `application/json`,
  reintentos ×2 con backoff 500 ms→8 s, read-timeout 60 s / call-timeout 45 s.
- **Sin exigencia de HTTPS** en `normalizeBase` (aunque en un móvil real la
  URL útil acaba siendo https pública).

## 2. Compatibilidad — decisiones tomadas

| Hallazgo | Decisión en el addon |
|---|---|
| `resources` exige `search` | Declarado `["search","stream"]` |
| `streamURL` en fila salta `/stream` | Se envía (absoluta, derivada de `x-forwarded-proto`/`Host` o `PUBLIC_BASE_URL`) |
| `encrypted != false` se rechaza | Siempre `false` — no hay DRM en el catálogo IA |
| `sampleRate`/`bitDepth`/`bitrate` con unidades ambiguas | Se envían en unidades canónicas (Hz, bits, kbps) tal cual parsea la app; bitrate calculado size×8/duración |
| IA `/download/` sin CORS y con redirect a nodos que fallan | **Proxy de bytes propio** con Range/206 passthrough (patrón del addon Go: reenviar `Range`/`If-Range`; devolver `Content-Type/Length/Range/Accept-Ranges/ETag/Last-Modified`) |
| Nodos IA caídos (ia800903 respondió timeout, dn720606 HTTP 500 durante las pruebas) | Candidatos por réplica (`workable_servers`,`d1`,`d2`,`server`) + redirector, con memoria de hosts enfermos 10 min |
| Etiquetas de formato del proveedor no fiables | Verificación por bytes antes de servir (`fLaC` + STREAMINFO); sin verificación no hay descriptor |
| Descargas y licencias | `allowDownloads:false` por defecto; opt-in explícito del operador + filtro CC/PD |

## 3. Riesgos

1. **Disponibilidad de nodos IA** (mitigado con réplicas + failover + bloqueo).
2. **Búsqueda a nivel de ítem** — IA no busca dentro de las pistas (mitigado
   con ranking local de relevancia; documentado como limitación).
3. **Latencia de arranque en free tiers** (Render duerme; primera petición lenta).
4. **`advancedsearch.php`** devuelve HTML si falta `output=json` (enviado siempre).

## 4. Incógnitas cerradas durante la implementación (medidas, no supuestas)

- Comportamiento real de `/download` con `Range` → 500 en nodo caído,
  206 con `fLaC` en nodo sano (comprobado con curl y con fetch).
- Metadata expone `server/dir/d1/d2/workable_servers` (usados).
- `files[].format` = `Flac` | `24bit Flac`; `files[].length` = segundos o `m:ss`
  (ambos parseados).
- Suite e2e real: **30/30 checks pasando** contra archive.org (ver Fase 5).
