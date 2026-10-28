# Agent Note: Web surface auth seat

Status: implemented

English | [中文](2026-10-02-webserver-auth-seat.zh.md)

## Problem

`@deepseek-ai/dsh-host-webserver` owns the process's only HTTP listener and exposes named routes, upgrade routes, and one fallback seat. The Connection plugin authenticates the Host API and the index, but static assets stay public by design, so a deployment needing one credential in front of the entire surface — index, assets, `/api`, and the mux upgrade — had no single place to enforce it.

## Decision

`registerAuth(check, challenge)` claims one request gate. The check runs inside `handle()` before route matching, so named routes, the fallback, and 404 answers are gated alike, and before every upgrade dispatch. The gate owns credential semantics; the server owns the rejection protocol: 401 with the registered `WWW-Authenticate` challenge for HTTP, socket destruction for upgrades, and deny-plus-log when the gate throws. One gate may live at a time and the disposer releases the seat. The HTTP call receives the response, letting a gate mint cookies before admitting; the upgrade call receives none, so only a handshake already carrying a cookie can pass. This is a fork-local extension: upstream 0.2.0-rc.2 and 0.2.1-rc.3 have no equivalent seat and keep static assets public.

## Alternatives considered

**A reverse proxy in front of the server.** Rejected for this deployment because it adds a second long-lived process and a second place that owns transport policy for a single-machine LAN setup.

**Patch each consuming plugin.** Rejected because the Connection owns `/api` authentication and the frontend-static plugin owns index authentication, so whole-surface coverage would need two patches and would still leave 404 answers ungated.

**Put the gate inside the fallback handler.** Rejected because the fallback answers only unmatched paths, so `/api` traffic and upgrade handshakes would bypass it.

## Consequences

The seat is the only fork-local change under `packages/`; the credential check itself ships as an ordinary plugin a profile mounts. Reapplying one file is the full upgrade cost, and an upstream equivalent would let the deployment delete it. Because the gate cannot read request bodies, credential schemes that need a body must live in a route rather than in the seat. Compositions that register a gate now require it for static assets, which is the point of the seat.
