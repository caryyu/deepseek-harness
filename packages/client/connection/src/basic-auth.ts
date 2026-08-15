/**
 * HTTP Basic + derived-cookie request authentication for the Web carrier.
 *
 * The webserver auth gate needs two channels because the browser cannot carry
 * one credential everywhere: `fetch` reuses the Basic credentials the browser
 * cached after the native login prompt, but `new WebSocket()` sends no custom
 * headers and browsers do not reliably attach cached Basic credentials to an
 * upgrade handshake. A same-origin WebSocket does attach cookies, so the gate
 * mints a derived session cookie on the first valid Basic request and accepts
 * that cookie afterwards. The cookie value is a hash of the credentials — no
 * server-side session table, no revocation besides changing the credentials —
 * and carries HttpOnly / SameSite=Lax / Path=/ so scripts cannot read it and
 * the browser sends it on same-site WebSocket handshakes.
 *
 * This is access control, not confidentiality: over plain HTTP both channels
 * are sniffable, and the challenge/credential compare must stay constant-time.
 */

import { createHash, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, IncomingHttpHeaders } from 'node:http'
import type { WebAuthCheck } from '@deepseek-ai/dsh-host-webserver'

/** The `user:pass` pair the deployment requires. */
export interface BasicAuthCredentials {
  username: string
  password: string
}

/** Session cookie name; the value is the credential-derived hash. */
const COOKIE_NAME = 'dsh-auth'
/** Session lifetime; the browser re-authenticates through the Basic prompt after it. */
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30
/** The Authorization scheme this gate accepts. */
const BASIC_PREFIX = 'Basic '
/** PWA metadata path fetched by the browser without credentials. */
const PUBLIC_MANIFEST_PATH = '/manifest.webmanifest'

/**
 * Marker the gate stamps on requests it verified by credential (Basic header
 * or derived cookie), so later stages can distinguish "this request was
 * authenticated" from "this request simply passed the gate" — the PWA
 * manifest bypass must not count as authentication. The stamp travels from
 * the node request to the fetch request through the HTTP bridge.
 */
export const AUTHENTICATED: unique symbol = Symbol('dsh.authenticated')

type AuthenticatedCarrier = { [AUTHENTICATED]?: true }

/**
 * Whether a request carrier carries the gate's authentication stamp.
 * @param carrier - node request or bridged fetch request.
 * @returns true when the gate verified its credentials.
 */
export function isAuthenticated(carrier: IncomingMessage | Request): boolean {
  return (carrier as unknown as AuthenticatedCarrier)[AUTHENTICATED] === true
}

/** Stamp a request carrier as authenticated by the gate. */
function stamp(carrier: IncomingMessage | Request): void {
  ;(carrier as unknown as AuthenticatedCarrier)[AUTHENTICATED] = true
}

/**
 * Parse the `user:pass` config value. The first colon splits the pair, so a
 * password may contain colons; a missing colon or an empty part is a
 * misconfiguration and fails loud at the config boundary, never at request
 * time.
 * @param value - the raw config value, verbatim.
 * @returns the parsed credentials.
 */
export function parseBasicAuthConfig(value: string): BasicAuthCredentials {
  const colon = value.indexOf(':')
  if (colon <= 0 || colon === value.length - 1) {
    throw new Error(`basicAuth must be "user:pass" with both parts non-empty, got ${JSON.stringify(value)}`)
  }
  return { username: value.slice(0, colon), password: value.slice(colon + 1) }
}

/** Constant-time compare of two byte strings of equal length. */
function equalBytes(provided: Buffer, expected: Buffer): boolean {
  return provided.length === expected.length && timingSafeEqual(provided, expected)
}

/** The stable cookie value for one credential pair. */
function cookieValue(credentials: BasicAuthCredentials): string {
  return createHash('sha256').update(`${credentials.username}:${credentials.password}`).digest('base64url')
}

/** Whether the Authorization header carries the accepted Basic credentials. */
function verifyBasic(authorization: string | undefined, credentials: BasicAuthCredentials): boolean {
  if (authorization === undefined || !authorization.startsWith(BASIC_PREFIX)) return false
  const decoded = Buffer.from(authorization.slice(BASIC_PREFIX.length), 'base64').toString('utf8')
  return equalBytes(Buffer.from(decoded), Buffer.from(`${credentials.username}:${credentials.password}`))
}

/** Whether the Cookie header carries the accepted derived cookie. */
function verifyCookie(headers: IncomingHttpHeaders, expected: string): boolean {
  const cookie = headers.cookie
  if (cookie === undefined) return false
  for (const part of cookie.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1 || part.slice(0, eq).trim() !== COOKIE_NAME) continue
    return equalBytes(Buffer.from(part.slice(eq + 1).trim()), Buffer.from(expected))
  }
  return false
}

/**
 * Build the gate for one credential pair: accepts a valid derived cookie, or a
 * valid Basic header — and then issues the cookie on the HTTP response (the
 * upgrade path has no response, so an upgrade must already carry a cookie or
 * the Basic header; the cookie lands on the next HTTP request). The PWA
 * manifest answers without credentials: Chromium fetches it with
 * credentials 'omit' (it predates the page's auth state), and its body is
 * public PWA metadata, so a GET to that exact path bypasses the gate.
 * @param credentials - the accepted `user:pass` pair.
 * @returns the webserver auth check.
 */
export function createBasicAuthGate(credentials: BasicAuthCredentials): WebAuthCheck {
  const expected = cookieValue(credentials)
  return (req: IncomingMessage, res) => {
    if (req.method === 'GET') {
      try {
        if (new URL(req.url ?? '/', 'http://x').pathname === PUBLIC_MANIFEST_PATH) return true
      } catch {
        // Unparsable url: fall through to the credential checks; the
        // webserver's per-request containment answers the bad request.
      }
    }
    if (verifyCookie(req.headers, expected)) {
      stamp(req)
      return true
    }
    if (!verifyBasic(req.headers.authorization, credentials)) return false
    stamp(req)
    if (res !== undefined) {
      res.setHeader('set-cookie', [
        `${COOKIE_NAME}=${expected}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${String(COOKIE_MAX_AGE_SECONDS)}`,
      ])
    }
    return true
  }
}
