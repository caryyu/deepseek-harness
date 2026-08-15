/**
 * Unit coverage for the Basic + derived-cookie auth gate: config parsing,
 * constant-time credential and cookie verification, and the HTTP/upgrade
 * response split. The gate's composition with the webserver and the browser
 * carrier is covered by the real-Loader suite and the node-half suite.
 */

import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import { createBasicAuthGate, isAuthenticated, parseBasicAuthConfig } from '../src/basic-auth.ts'

/** Minimal request carrying the given headers. */
function request(headers: Record<string, string>): IncomingMessage {
  const req = Readable.from([]) as unknown as IncomingMessage
  Object.assign(req, { url: '/api/x', method: 'GET', headers })
  return req
}

/** Minimal response recording only the header the gate may set. */
function response(): { res: ServerResponse; setCookies: string[] } {
  const setCookies: string[] = []
  const res = {
    setHeader(name: string, value: string | string[]) {
      if (name === 'set-cookie') setCookies.push(...(Array.isArray(value) ? value : [value]))
    },
  } as unknown as ServerResponse
  return { res, setCookies }
}

const basic = (user: string, pass: string): string =>
  `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`

describe('parseBasicAuthConfig', () => {
  it('splits on the first colon and keeps colons inside the password', () => {
    expect(parseBasicAuthConfig('alice:secret')).toEqual({ username: 'alice', password: 'secret' })
    expect(parseBasicAuthConfig('alice:pa:ss')).toEqual({ username: 'alice', password: 'pa:ss' })
  })

  it('fails loud on a missing colon or an empty part', () => {
    expect(() => parseBasicAuthConfig('nocolon')).toThrow(/must be "user:pass"/)
    expect(() => parseBasicAuthConfig(':secret')).toThrow(/must be "user:pass"/)
    expect(() => parseBasicAuthConfig('alice:')).toThrow(/must be "user:pass"/)
  })
})

describe('createBasicAuthGate', () => {
  const gate = createBasicAuthGate({ username: 'alice', password: 'secret' })

  it('rejects a request carrying no credential', async () => {
    const { res } = response()
    expect(await gate(request({ host: '127.0.0.1:3080' }), res)).toBe(false)
    expect(await gate(request({ host: '127.0.0.1:3080' }), undefined)).toBe(false)
  })

  it('lets the unauthenticated PWA manifest GET through and nothing else', async () => {
    const { res } = response()
    const at = (url: string, method = 'GET'): IncomingMessage => {
      const req = request({ host: '127.0.0.1:3080' })
      Object.assign(req, { url, method })
      return req
    }
    expect(await gate(at('/manifest.webmanifest'), res)).toBe(true)
    expect(await gate(at('/manifest.webmanifest?v=1'), res)).toBe(true)
    expect(await gate(at('/manifest.webmanifest'), undefined)).toBe(true)
    // Non-GET to the same path and any other path stay gated.
    expect(await gate(at('/manifest.webmanifest', 'POST'), res)).toBe(false)
    expect(await gate(at('/favicon.ico'), res)).toBe(false)
    expect(await gate(at('/'), res)).toBe(false)
    // An unparsable url falls through to the credential checks, not a throw.
    expect(await gate(at('http://['), res)).toBe(false)
    // An absent url parses as '/' and stays gated.
    const noUrl = request({ host: '127.0.0.1:3080' })
    noUrl.url = undefined
    expect(await gate(noUrl, res)).toBe(false)
  })

  it('rejects a wrong password and non-Basic Authorization values', async () => {
    expect(await gate(request({ authorization: basic('alice', 'wrong') }), undefined)).toBe(false)
    expect(await gate(request({ authorization: 'Bearer token' }), undefined)).toBe(false)
    expect(await gate(request({ authorization: 'Basic !!!not-base64!!!' }), undefined)).toBe(false)
  })

  it('accepts the Basic credentials and mints the derived cookie on the HTTP response', async () => {
    const { res, setCookies } = response()
    const req = request({ authorization: basic('alice', 'secret') })
    expect(await gate(req, res)).toBe(true)
    expect(setCookies).toHaveLength(1)
    expect(setCookies[0]).toMatch(/^dsh-auth=[^;]+; HttpOnly; SameSite=Lax; Path=\/; Max-Age=/)
  })

  it('stamps authenticated requests and never the manifest bypass', async () => {
    const { res } = response()
    const viaBasic = request({ authorization: basic('alice', 'secret') })
    await gate(viaBasic, res)
    expect(isAuthenticated(viaBasic)).toBe(true)

    const mint = response()
    await gate(request({ authorization: basic('alice', 'secret') }), mint.res)
    const cookie = mint.setCookies[0]!.slice('dsh-auth='.length, mint.setCookies[0]!.indexOf(';'))
    const viaCookie = request({ cookie: `dsh-auth=${cookie}` })
    await gate(viaCookie, undefined)
    expect(isAuthenticated(viaCookie)).toBe(true)

    const rejected = request({ cookie: 'dsh-auth=wrong' })
    await gate(rejected, undefined)
    expect(isAuthenticated(rejected)).toBe(false)

    const manifest = request({ host: '127.0.0.1:3080' })
    Object.assign(manifest, { url: '/manifest.webmanifest' })
    await gate(manifest, res)
    expect(isAuthenticated(manifest)).toBe(false)
  })

  it('accepts the Basic credentials on the upgrade path, which has no response to carry a cookie', async () => {
    expect(await gate(request({ authorization: basic('alice', 'secret') }), undefined)).toBe(true)
  })

  it('accepts the derived cookie without any Authorization header', async () => {
    const { res, setCookies } = response()
    await gate(request({ authorization: basic('alice', 'secret') }), res)
    const cookie = setCookies[0]!.slice('dsh-auth='.length, setCookies[0]!.indexOf(';'))
    expect(await gate(request({ cookie: `dsh-auth=${cookie}` }), undefined)).toBe(true)
    expect(await gate(request({ cookie: `other=1; dsh-auth=${cookie}` }), undefined)).toBe(true)
  })

  it('rejects a wrong cookie value and an unparsable cookie header', async () => {
    expect(await gate(request({ cookie: 'dsh-auth=wrong' }), undefined)).toBe(false)
    expect(await gate(request({ cookie: 'justname' }), undefined)).toBe(false)
  })

  it('mints the same cookie for the same credentials across gate instances', async () => {
    const first = response()
    await createBasicAuthGate({ username: 'alice', password: 'secret' })(
      request({ authorization: basic('alice', 'secret') }),
      first.res,
    )
    const cookie = first.setCookies[0]!.slice('dsh-auth='.length, first.setCookies[0]!.indexOf(';'))
    expect(await gate(request({ cookie: `dsh-auth=${cookie}` }), undefined)).toBe(true)
  })
})
