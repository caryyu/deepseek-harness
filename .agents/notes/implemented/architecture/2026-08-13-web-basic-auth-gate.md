# Agent Note: Web Basic auth gate ships as an optional webserver seat

Status: implemented

English | [中文](2026-08-13-web-basic-auth-gate.zh.md)

## Problem

The Web GUI needs a deployment-level authentication layer, and a browser imposes the hard constraint: `new WebSocket()` sends no custom headers, and browsers do not reliably attach cached Basic credentials to an upgrade handshake. A pure `Authorization: Basic` check would therefore authenticate every HTTP call while silently killing both event downlinks. The existing `/api` browser-trust fence explicitly is not authentication — its own docs deferred a real authentication layer — and per-route checks would have to be repeated at every registration site (HTTP route, both upgrade routes, `/plugins`, the static fallback), guaranteeing a hole.

## Decision

`dsh-host-webserver` gains a single optional auth seat, `registerAuth(check)`, executed before every HTTP dispatch and every upgrade dispatch, so one registration shields named routes, the static fallback, and 404 answers alike. The server owns only the rejection protocol: a false return answers HTTP with 401 plus `WWW-Authenticate: Basic realm="dsh"` and destroys upgrade sockets; a throwing gate falls into the existing per-request 400 containment. The gate semantics live in `dsh-client-connection` (`src/basic-auth.ts`), the same package that owns the trust fence, driven by a new optional `basicAuth` config value (`user:pass`).

The gate accepts two channels because the browser cannot carry one credential everywhere: a valid Basic header dispatches and mints a derived session cookie (`dsh-auth`, SHA-256 of the credentials, `HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`), and a valid cookie dispatches afterwards. Same-origin WebSockets attach the cookie, which is what makes both downlinks work. There is no session table and no revocation short of changing the credentials; the credential and cookie compares are constant-time, and a malformed `basicAuth` value fails the plugin load loudly at the config boundary.

The CLI publishes the value as `--basic-auth <user:pass>`, falling back to the `DSH_BASIC_AUTH` environment variable (flag wins; the environment form keeps the password out of `ps` and shell history). The web-app patch injects it into the connection row. Absent the value no gate registers and every request dispatches as before.

The browser side stays minimal: on the first unauthenticated navigation the 401 challenge raises the native login prompt, `fetch` then reuses the cached credentials automatically, and `web-api-client.ts` navigates once per rejected session (sessionStorage-marked) so an expired session re-prompts instead of failing silently. A successful response clears the marker. The PWA manifest (`GET /manifest.webmanifest`) bypasses the gate: Chromium fetches it with credentials 'omit' before the page's auth state exists, and its body is public PWA metadata.

The gate doubles as the real authentication layer the trust fence deferred: requests it verified carry an `AUTHENTICATED` stamp (a module symbol) that the HTTP bridge hands to the fetch-shaped handler, and the privileged-method loopback pin (settings/credentials plane, native dialogs, agent-preset authoring) admits stamped requests from any trusted authority. The stamp matters because the manifest bypass is not authentication. This is safe against DNS rebinding because the browser cannot carry the gate's credentials (the cookie is same-site, the Basic credentials are secret) to a rebound page.

## Alternatives considered

- **Per-route checks inside connection**: rejected — two dispatch paths (HTTP route handlers plus upgrade handlers) plus every other route owner would each need the check, and the static shell would stay public.
- **A login form plus a server-side session table**: rejected — a native-prompt flow needs no UI at all, and a derived cookie needs no state; per-session revocation can be added later if a deployment demands it.
- **Front a reverse proxy with Basic auth**: still the supported path for TLS and LAN deployments, but it is not a product feature and does not travel with `dsh web`.

## Consequences

The trust fence stays on top of the gate as defense in depth. The privileged-method loopback pinning now has one door: a request the gate authenticated reaches the privileged plane from any trusted authority, while anonymous callers stay loopback-only — the pin keeps its original meaning (no anonymous LAN caller reaches the configuration plane) and the gate supplies the authentication the pin deferred. This is access control, not confidentiality: over plain HTTP both channels are sniffable, so a non-loopback deployment should still sit behind TLS. Changing the credentials revokes every issued cookie at once. Chromium's same-origin WebSocket cookie behavior is the verified browser contract; Firefox behavior is covered by the assembled web replay.
