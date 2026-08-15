# `@deepseek-ai/dsh-host-frontend-static`

English | [中文](README.zh.md)

SPA dist server for the Web shell: a function plugin (config `{distIndex}`) that claims the [webserver](../webserver/README.md)'s single fallback seat and serves the built frontend directory with the shell's locked semantics — traversal outside the dist root is 403, any miss falls back to `index.html` with HTTP 200 (SPA routing), unknown extensions ship as `application/octet-stream`, and non-GET/HEAD without a matching named route is 405. Every index response runs through the webserver's registered index taps (`applyIndexTaps`), which is how the boot manifest reaches the page. `distIndex` is an assembly fact of the composing application: [`dsh-web-app`](../../bundle/web-app/README.md) resolves it through the frontend package's exports and mounts this plugin; a deployment never hardcodes it.

Cache-control follows the asset class: vite content-hashed files (`name-<hash>.<ext>`, identified by the dash-hash name plus a known extension) are served `public, max-age=31536000, immutable`, because a rebuild renames the file and the pinned URL is never requested again; index responses, `public/` copies (the PWA manifest, favicon), and unknown extensions are served `no-cache`. Text bodies (HTML, JS, CSS, SVG, JSON, source maps, the manifest) are gzip-compressed through the [webserver](../webserver/README.md)'s `gzipIfAccepted` when the client's `Accept-Encoding` permits it; fonts and unknown binaries ship raw; every response declares `Vary: accept-encoding`.

The fallback seat is single-owner (a second claim throws) and effect-scoped: disposing the plugin's fiber releases the seat, after which the unclaimed webserver answers 404.

## Model Experience

None, as the package serves browser assets; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **The starter MIME table is minimal** — it covers the Vite-emitted asset set plus the shipped PWA manifest; other extensions fall back to `application/octet-stream` until an asset class actually ships.
- **Immutable pinning keys on the filename pattern** — a `public/` copy whose name happens to look content-hashed (`-<hash>.<ext>`) would be pinned forever; the shipped dist emits no such name.
