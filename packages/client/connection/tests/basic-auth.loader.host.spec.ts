/**
 * REAL-composition coverage: a test-only cordis.yml booted through the
 * vendored Loader mounts the webserver and the connection carrier with a
 * basicAuth value, and the assertions observe the running server's 401/200
 * surface, the derived session cookie, and the gate-less default.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { once } from 'node:events'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import HttpServer from '@deepseek-ai/dsh-host-webserver'
import * as Connection from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Write a two-row cordis.yml (webserver + connection), then boot it through the real Loader. */
async function loadComposition(basicAuth?: string): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-connection-auth-'))
  const configPath = join(root, 'cordis.yml')
  const rows = [
    "- name: '@deepseek-ai/dsh-host-webserver'",
    '  config:',
    "    host: '127.0.0.1'",
    '    port: 0',
    "- name: '@deepseek-ai/dsh-client-connection'",
  ]
  if (basicAuth !== undefined) {
    rows.push('  config:', `    basicAuth: ${JSON.stringify(basicAuth)}`)
  }
  await writeFile(configPath, [...rows, ''].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-host-webserver', HttpServer],
    ['@deepseek-ai/dsh-client-connection', Connection],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
}

/** GET one path; returns status, headers, and body. */
async function request(port: number, path: string, headers: Record<string, string> = {}): Promise<{
  status: number
  headers: Headers
  body: string
}> {
  const response = await fetch(`http://127.0.0.1:${String(port)}${path}`, { headers })
  return { status: response.status, headers: response.headers, body: await response.text() }
}

/** Raw GET with a custom Host, returning the status line and headers verbatim. */
async function rawWithHost(port: number, path: string, host: string): Promise<string> {
  const socket = connect(port, '127.0.0.1')
  await once(socket, 'connect')
  const response = once(socket, 'data')
  socket.write([
    `GET ${path} HTTP/1.1`,
    `Host: ${host}`,
    '',
    '',
  ].join('\r\n'))
  const [data] = await response as [Buffer]
  socket.destroy()
  return String(data)
}

/** Raw headerless GET returning the status line and response headers verbatim. */
async function rawChallenge(port: number, path: string): Promise<string> {
  return rawWithHost(port, path, `127.0.0.1:${String(port)}`)
}

describe('basic auth through the real Loader', () => {
  it('answers 401 with the Basic challenge, accepts the credential, and mints a cookie', { timeout: 60_000 }, async () => {
    const loaded = await loadComposition('alice:secret')
    const port = loaded.webServer.port
    loaded.webServer.register({ kind: 'exact', path: '/probe', handler: (_req, res) => { res.writeHead(200); res.end('OK') } })

    // Unauthenticated requests are challenged before any route can answer.
    const challenged = await rawChallenge(port, '/probe')
    expect(challenged).toMatch(/^HTTP\/1\.1 401 /)
    expect(challenged.toLowerCase()).toContain('www-authenticate: basic realm="dsh"')

    // The accepted credential dispatches and mints the derived cookie.
    const credentials = `Basic ${Buffer.from('alice:secret').toString('base64')}`
    const granted = await request(port, '/probe', { authorization: credentials })
    expect(granted.status).toBe(200)
    expect(granted.body).toBe('OK')
    const setCookie = granted.headers.get('set-cookie')
    expect(setCookie).toBeDefined()
    expect(setCookie).toMatch(/^dsh-auth=[^;]+; HttpOnly; SameSite=Lax; Path=\//)
    const cookie = setCookie!.slice('dsh-auth='.length, setCookie!.indexOf(';'))

    // The cookie alone dispatches on the next request.
    const viaCookie = await request(port, '/probe', { cookie: `dsh-auth=${cookie}` })
    expect(viaCookie.status).toBe(200)
    expect(viaCookie.body).toBe('OK')

    // Wrong credentials stay challenged.
    const wrong = await request(port, '/probe', {
      authorization: `Basic ${Buffer.from('alice:wrong').toString('base64')}`,
    })
    expect(wrong.status).toBe(401)

    // The PWA manifest bypasses the gate (Chromium fetches it
    // credentials-free); with no fallback owner in this composition it answers
    // 404, not 401, while a non-manifest path stays challenged.
    expect((await request(port, '/manifest.webmanifest')).status).toBe(404)
    expect((await request(port, '/manifest.webmanifest?rev=1')).status).toBe(404)
    expect((await fetch(`http://127.0.0.1:${String(port)}/manifest.webmanifest`, { method: 'POST' })).status).toBe(401)
    expect((await request(port, '/favicon.ico')).status).toBe(401)

    // An authenticated request reaches the privileged configuration plane on
    // a non-loopback authority; an anonymous one is challenged by the gate
    // before the trust fence's 403 can answer.
    const privileged = await request(port, '/api/settings.describe', { cookie: `dsh-auth=${cookie}` })
    expect(privileged.status).toBe(404) // past the pin; this composition has no apiProxy
    const anonymous = await rawWithHost(port, '/api/settings.describe', 'harness.example')
    expect(anonymous).toMatch(/^HTTP\/1\.1 401 /)
  })

  it('dispatches every request when no basicAuth is configured', { timeout: 60_000 }, async () => {
    const loaded = await loadComposition()
    const port = loaded.webServer.port
    loaded.webServer.register({ kind: 'exact', path: '/probe', handler: (_req, res) => { res.writeHead(200); res.end('OK') } })
    const granted = await request(port, '/probe')
    expect(granted.status).toBe(200)
    expect(granted.body).toBe('OK')
    // Without the gate there is no authentication: the privileged plane stays
    // loopback-only even for a declared authority.
    const anonymous = await rawWithHost(port, '/api/settings.describe', 'harness.example')
    expect(anonymous).toMatch(/^HTTP\/1\.1 403 /)
  })
})
