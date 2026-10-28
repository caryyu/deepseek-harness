# Fork-local patches

This checkout is upstream `deepseek-ai/deepseek-harness` at release tag `dsh-v0.2.0-rc.2` plus the
surfaces below. They restore deployment behaviour upstream does not ship; everything else is
untouched upstream code, so an upgrade is "replace the tree, re-apply these five patches".

## Surfaces

| Path | Behaviour | Drop when |
|---|---|---|
| `packages/host/webserver/src/index.ts` | `registerAuth(check, challenge)` gate seat: one owner; runs before HTTP route matching and before upgrade dispatch; rejection answers 401 with the registered `WWW-Authenticate` value, or closes an upgrade socket; a throwing gate denies and logs | upstream exposes an equivalent whole-surface gate |
| `packages/client/ui-layout` | narrow-viewport sidebar drawer: floating mid-height toggle, zero-width hidden column, `layout` locale namespace | upstream ships a drawer toggle |
| `packages/client/ui-conversation/src/client/skeleton/InputBar.module.css` | `.trailing { flex: 0 1 auto }` so the right-side group shrinks and the model trigger ellipsizes instead of wrapping | the shipped composer already shrinks |
| `packages/client/ui-model-selection/src/client/ModelSelect.module.css` | `@container (max-width: 460px)` hides the model name when the trigger carries an effort span | upstream collapses the chip itself |
| `packages/session-query/session-log-export` | labelled export capsule that folds into an ellipsis menu below 480px (container query on the header title row) | upstream restores the labelled form |

The last four are UI-only and exempt from Agent Notes; the gate seat carries
`.agents/notes/implemented/architecture/2026-10-02-webserver-auth-seat.md`.

## Basic authentication

The gate logic is a plugin outside the repository: `~/dsh-plugins/dsh-basic-auth` (own git repo,
plain ESM, no build step, `node --test test.js`). It accepts `Authorization: Basic` or the
`dsh-auth` cookie it mints (`sha256(user:pass)`, `HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`),
bypasses `GET /manifest.webmanifest`, and **appends** its cookie with `appendHeader` — the
Connection's token redirect writes its own session cookie through `writeHead`, which would drop a
replaced header.

Install it into a profile with `dsh plugin --profile web add ~/dsh-plugins/dsh-basic-auth`, then mount
it in `~/.dsh/profiles/web/cordis.patch.yml`:

```yaml
- insert:
    - id: basic-auth
      name: dsh-basic-auth
      disabled: !!js '!process.env.DSH_BASIC_AUTH'
      config:
        credential: !!js process.env.DSH_BASIC_AUTH
```

Quote the expression: an unquoted leading `!` is YAML tag syntax and fails the overlay parse. A row
that targets an existing id is a patch; a new row needs the `insert` list, or the layer warns
`entry "basic-auth" not found` and skips it.

## Deployment wiring

- `~/.dsh/dsh.web-lan.patch.yml` binds `webserver.host: 0.0.0.0` and `port: 3080`.
- Launch with `DSH_BASIC_AUTH=user:pass` exported:
  `pnpm dsh web --patch ~/.dsh/dsh.web-lan.patch.yml --trusted-host dsh-macos.t.caryyu.top`.
- Without the variable the row is disabled and the surface behaves as if the gate did not exist.
- Upstream's browser session still guards the Host API and the index, so a new device answers the
  Basic prompt and then visits the printed `?token=` URL once; both cookies last 30 days.

## Verification checklist

1. `curl -si http://127.0.0.1:3080/` → `401` with `www-authenticate: Basic realm="dsh"`.
2. `curl -si -u user:pass "http://127.0.0.1:3080/?token=<printed token>"` → `303`.
3. `curl -u user:pass -c jar -b jar <asset URL>` mints `dsh-auth`; `curl -b jar /` → `200`.
4. `curl -si http://127.0.0.1:3080/manifest.webmanifest` → `200` without credentials.
5. Wrong password → `401`.
6. Browser over LAN: Basic prompt → token URL → UI loads; the `remote.mux` WebSocket stays connected.
7. Narrow window (< 1024px): the sidebar hides and the floating chevron reopens it; the export
   capsule becomes an ellipsis menu below 480px; the model chip keeps only the effort level.

## Upgrade protocol

1. Bump `master` to the target tag, then re-apply the five surfaces (`git diff dsh-v0.2.0-rc.2 HEAD -- <path>` once the fork commit exists).
2. Follow the target's toolchain pins (`0.2.1` moves to pnpm 11.28.5 and Node ≥ 24.9).
3. Rebuild `pnpm run build --profile official` (keeps `DSH_CLIENT_BUILD_PROFILE=official` and
   `DSH_CLIENT_TITLE=DeepSeek Harness`, so the official wordmark and title stay).
4. Run the checklist, then `pnpm run test:gui`, `pnpm run typecheck`, `pnpm run test:docs`.
5. Read `docs/upgrade-guide/` for the target: from `0.2.1`, `web-listener-trust-config` rejects
   `host: 0.0.0.0`, so the LAN overlay must bind a concrete interface address.

The plugin and the UI patches do not change between upgrades unless the target's client layout moves.
