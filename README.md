# OpenLossless — addon BitChord (FLAC real del Internet Archive)

Addon para [BitChord](https://github.com/kushagrasinghx/BitChord) que sirve
**FLAC auténtico (lossless)** desde **Internet Archive**. Cero dependencias
npm: Node ≥ 18 y punto.

## Principios (incumplibles por diseño)

1. **Formato honesto**: un stream se etiqueta `flac` solo después de verificar
   sus propios bytes (`fLaC` magic + STREAMINFO: sample rate, canales, bit
   depth). Las etiquetas del proveedor no se confían por sí solas.
2. **Sin transcodificar**: lo que hay en el servidor es lo que llega al
   reproductor. Nada de MP3 disfrazado, nada de upsampling.
3. **Sin DRM ni trucos**: si algo no se puede servir legalmente, no se sirve.
4. **Descargas apagadas por defecto** (`allowDownloads: false`): la licencia
   del proveedor manda. Solo el operador puede activarlas, y con
   `STRICT_LICENSES=true` únicamente para ítems con licencia CC/dominio
   público explícita.

## Endpoints (protocolo addon de BitChord)

| Endpoint | Qué hace |
|---|---|
| `GET /manifest.json` | Manifiesto (`resources: ["search","stream"]`) |
| `GET /search?q=&quality=` | `{"tracks":[…]}` — filas FLAC deduplicadas y ordenadas por relevancia |
| `GET /stream/{id}` | Descriptor con `format:"flac"`, `encrypted:false`, sample rate/bit depth verificados |
| `GET /audio/{id}` | Proxy de bytes con **Range/206** (seek real) y failover entre réplicas |
| `GET /art/{id}` | Portada proxy con caché |
| `GET /health` | Estado + estadísticas de cachés |

Los `id` son `ia-` + base64url(`identifier|filename`), así que ningún carácter
de un nombre de archivo puede romper la URL.

## Cómo desplegarlo y conseguir LA URL

### Opción A — Render (gratis, ~3 minutos)

1. Sube esta carpeta a un **repositorio GitHub** nuevo (los 12 archivos).
2. En [render.com](https://render.com) → **New + → Blueprint** → elige el
   repositorio (detecta `render.yaml` con health-check `/health`).
3. Cuando termine el deploy, Render te da la URL:
   `https://openlossless-bitchord-addon-xxxx.onrender.com`
4. **Pégala en BitChord → Fuentes → Añadir fuente.** Listo.

> El plan gratis de Render duerme tras 15 min sin tráfico: la primera
> búsqueda puede tardar ~40 s en despertar el servicio; luego vuela.

### Opción B — Docker (tu VPS / PC)

```bash
docker compose up --build -d   # sirve en :8787
```

Para el móvil necesitas HTTPS público (Render resuelve eso por ti).

### Opción C — local, para probar

```bash
npm start        # http://localhost:8787
npm test         # suite e2e real contra archive.org (30 checks)
```

## Arquitectura

```
server.js            HTTP + routing + manifiesto + /search + /stream
src/ia.js            Internet Archive: advancedsearch, metadata, réplicas
src/flac.js          Verificación FLAC: fLaC magic + parseo STREAMINFO
src/mappers.js       IA → AddonTrack (títulos, duración, dedupe, ranking)
src/hosts.js         Memoria de nodos caídos (10 min) para failover rápido
src/cache.js         TTL+LRU genérico (búsqueda 10 m, metadata 1 h, FLAC ∞)
src/config.js        Env vars con defaults sanos
tests/e2e.mjs        Suite real end-to-end (30 checks contra archive.org)
```

Detalles que importan:

- **Seek que funciona**: el proxy reenvía `Range`/`If-Range` y devuelve
  `206` + `Content-Range` + `Accept-Ranges` tal cual el nodo de IA.
- **Failover de réplicas**: IA expone `workable_servers`/`d1`/`d2`; el addon
  prueba réplicas directas y cae al redirector `/download`, marcando enfermos
  para no pagar el timeout dos veces.
- **Búsqueda honesta en dos niveles**: ítems con `format:"Flac"`, luego
  expansión archivo-a-archivo contra `/metadata`; si no hay resultados se
  ensancha la consulta pero las filas siguen siendo solo FLAC.
- **`streamURL` por fila**: BitChord salta la llamada `/stream` y empieza a
  reproducir antes (protocolo: una fila con `streamURL` no consulta `/stream`).

## Limitaciones conocidas (escritas, no escondidas)

- El catálogo es **Internet Archive**: música en su mayoría de conciertos
  autorizados (Colección etree), Archivo de Música de Musopen/Community
  Audio. No hay discografía comercial moderna — eso vive en servicios con
  DRM y no se toca.
- IA busca a nivel de ítem, no de pista: los mejores resultados son
  artista/álbum/concierto. El ranking local compensa parte del ruido.
- Nada de Atmos/hi-res inventado: los canales y la profundidad de bits salen
  del STREAMINFO real del archivo; lo que no se sabe, no se afirma.
