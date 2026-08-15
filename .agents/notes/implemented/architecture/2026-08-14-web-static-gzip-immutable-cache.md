# Agent Note: Web response delivery compresses with gzip and pins content-addressed responses

Status: implemented

English | [中文](2026-08-14-web-static-gzip-immutable-cache.zh.md)

## Problem

Public (reverse-proxied) access to the Web GUI boots slowly because every page load re-downloads the whole client. The bundle route served `/plugins/*/client.js` with `no-cache` and no validators, the dist server sent no cache headers at all, and nothing was compressed: ~38 plugin bundles totaling 3 MB plus the shell dist (~4.3 MB, 40+ requests) had to cross the public network on every boot, in an HTTP/1.1 burst that trips deployment rate limiters. Local access masks this because loopback transfer is free.

## Decision

Two owners serve files, and the webserver stays a pure carrier, so it gains only the shared negotiation helper. `dsh-host-webserver` exports `gzipIfAccepted(acceptEncoding, body)`: it gzip-compresses a fully-buffered body when the client permits it (an explicit `gzip` token with `q` other than 0, or a bare `*` wildcard; parsing is lenient and skips full q-value precedence) and returns the identity body otherwise. The two file-serving consumers and the `/api` JSON-RPC bridge all call it and declare `Vary: accept-encoding`; streaming responses such as SSE and binary downloads are outside its contract.

The `dsh-client-connection` HTTP bridge gzip-compresses fully-buffered JSON-RPC responses — unary payloads such as `session.history` pages, which reach several megabytes on large sessions (measured ~5.9 MB for a 50-message tail of an 11.4 MB log, ~4x shrink under gzip). SSE streams (`text/event-stream`) and binary downloads (session-log zips) pass through unchanged.

The `dsh-client-modules` bundle route serves `/plugins/<id>/client.js?rev=<hash>` as `public, max-age=31536000, immutable`: the rev query content-addresses the body, so a rebuild changes the URL and the pinned response is never requested again. Source maps (`/plugins/<id>/client.js.map`) carry no rev and stay `no-cache` so a rebuild reaches DevTools.

`dsh-host-frontend-static` keys cache-control on the filename: vite content-hashed names (`name-<hash>.<ext>` over a known extension set) are immutable; index responses (which carry the boot manifest with the current revs), `public/` copies (the PWA manifest, favicon), and unknown extensions are `no-cache`. Text bodies (HTML, JS, CSS, SVG, JSON, source maps, the manifest) compress with gzip; fonts and unknown binaries ship raw.

## Alternatives considered

- **Brotli instead of gzip**: deferred — better ratio at higher CPU cost; gzip is one negotiation branch and covers the deployment.
- **Transparent compression middleware in the webserver**: rejected — the carrier does not know content types or streaming intent; the file-serving and RPC owners do.
- **Immutable by extension alone**: rejected — `public/` copies (favicon, manifest) are unhashed and would be pinned forever; the dash-hash name check excludes them.

## Consequences

After the first load, boot is index.html (the rev manifest, `no-cache`) plus cache hits, so a public reload is one round trip instead of 40+ requests; rebuilds refetch only bundles whose rev changed. Reverse proxies can now cache effectively (freshness plus `Vary`). History reads and other JSON-RPC calls transfer at roughly a quarter of their uncompressed bytes. gzip costs CPU only on cache misses and per buffered RPC response. The one residual risk is an unhashed file whose name looks content-hashed — documented as a Known Limitation; the shipped dist emits none.
