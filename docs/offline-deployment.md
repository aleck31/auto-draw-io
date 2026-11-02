# draw.io Hosting and Offline Deployment

The app ships its own copy of draw.io and serves it from its own origin (`/drawio/<version>/`). The editor, the `/render/<id>` viewer and every AI edit work without reaching diagrams.net, so intranet and offline deployments need no extra setup.

## The bundled copy

- The version is pinned in `scripts/drawio-version.json` (release, SHA-256 of `draw.war`, download URL). `scripts/fetch-drawio.mjs` downloads `draw.war` from GitHub, checks the SHA-256 and unpacks it into `public/drawio/<version>`. It runs before `npm run dev` and `npm run build`, and in its own Docker build stage.
- Building needs github.com once per version. For air-gapped builds, put `draw.war` in the build context and pass its path: `docker build --build-arg DRAWIO_WAR_PATH=draw.war .` (or `DRAWIO_WAR_PATH=/path/to/draw.war npm run build`). The checksum is still checked.
- `/drawio/*` is served with `Content-Security-Policy: frame-ancestors 'self'`, `X-Frame-Options: SAMEORIGIN` and a one-year immutable cache.
- draw.io's server endpoints (`/proxy`, `/export`, image import by URL) are not available: only the static web app is shipped.

The app drives this editor directly (AI changes are applied in place and undo in one step, and the canvas is locked while the AI draws), which needs it on the same origin.

## Upgrading draw.io

The integration uses draw.io internals, so the version is pinned and upgraded deliberately:

1. Update `version`, `sha256` and `downloadUrl` in `scripts/drawio-version.json` (the SHA-256 is listed on the GitHub release).
2. `npm run build && npm run test:e2e`. The "upgrade canary" test fails first if an internal the app uses was renamed or removed.

A draw.io release that fixes a security issue (XSS in particular) should be adopted regardless of the pin: the editor runs on the app's origin, next to settings kept in the browser's localStorage.

## Using an external draw.io instead

Set `EMBED_DRAWIO_BASE_URL` at build time to a draw.io the user's browser can reach, for example a `jgraph/drawio` container. The bundled copy is then not downloaded, the editor and `/render/<id>` load from that URL, and diagrams are loaded through draw.io's postMessage protocol: the app works, but AI changes reload the whole diagram, aren't a single undo step, and the canvas isn't locked while the AI draws.

```yaml
services:
  drawio:
    image: jgraph/drawio:latest
    ports: ["8080:8080"]
  auto-draw-io:
    build:
      context: .
      args:
        - EMBED_DRAWIO_BASE_URL=http://localhost:8080
    ports: ["3000:3000"]
    env_file: .env
    depends_on: [drawio]
```

`EMBED_DRAWIO_BASE_URL` is a build-time variable: changing it requires rebuilding the image. It must be reachable from the user's browser (`http://localhost:8080`, `http://YOUR_SERVER_IP:8080` or `https://drawio.your-domain.com`), not a Docker alias like `http://drawio:8080`.
