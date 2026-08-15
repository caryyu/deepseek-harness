/** Node-half composition diagnostics for package metadata and built client bundles. */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import type { WebServer, WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { ClientModuleRegistry } from '../src/index.ts'

let root: string | undefined

afterEach(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true })
  root = undefined
})

/** Create a resolvable package whose client export points at the returned path. */
function writePackage(
  packageName: string,
  metadata: Record<string, unknown> = { dsh: { client: { platform: 'web' } } },
): string {
  root ??= realpathSync(mkdtempSync(join(tmpdir(), 'dsh-client-modules-')))
  const pkgRoot = join(root, 'node_modules', ...packageName.split('/'))
  const clientPath = join(pkgRoot, 'lib', 'client.js')
  mkdirSync(pkgRoot, { recursive: true })
  writeFileSync(join(pkgRoot, 'package.json'), JSON.stringify({
    name: packageName,
    exports: {
      './client': './lib/client.js',
      './package.json': './package.json',
    },
    ...metadata,
  }))
  return clientPath
}

/** Construct the node-half service and capture its plugin-bundle route. */
function constructWithRoute(packageNames: string[]): { service: ClientModuleRegistry; route: WebRoute } {
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(root!).href + '/'
  ctx.provide('loader', {
    *entries() {
      for (const packageName of packageNames) {
        yield { options: { name: packageName }, fiber: {}, disabled: false }
      }
    },
  })
  let route: WebRoute | undefined
  const webServer: Pick<WebServer, 'port' | 'register' | 'tapIndex'> = {
    port: 0,
    register: (candidate) => {
      if (candidate.path === '/plugins') route = candidate
      return () => {}
    },
    tapIndex: () => () => {},
  }
  ctx.provide('webServer', webServer as WebServer)
  const service = new ClientModuleRegistry(ctx)
  if (route === undefined) throw new Error('client bundle route was not registered')
  return { service, route }
}

/** Construct the node-half service over the enabled fixture entries. */
function construct(packageNames: string[]): ClientModuleRegistry {
  return constructWithRoute(packageNames).service
}

/** Dispatch one bundle-route request, capturing the raw response bytes. */
async function dispatch(
  route: WebRoute,
  url: string,
  acceptEncoding?: string,
): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  let status = 0
  let headers: Record<string, string> | undefined
  let body = Buffer.alloc(0)
  const response = {
    writeHead(nextStatus: number, nextHeaders?: Record<string, string>) {
      status = nextStatus
      headers = nextHeaders
      return response
    },
    end(chunk?: Uint8Array) {
      body = Buffer.from(chunk ?? [])
      return response
    },
  } as unknown as ServerResponse
  await route.handler({
    method: 'GET',
    url,
    headers: { ...(acceptEncoding === undefined ? {} : { 'accept-encoding': acceptEncoding }) },
  } as IncomingMessage, response)
  return { status, headers: headers ?? {}, body }
}

describe('client bundle activation', () => {
  it('allows sibling dsh roles', () => {
    const currentName = '@fixture/current-client-field'
    const clientPath = writePackage(currentName, {
      dsh: {
        bundle: { patch: './cordis.patch.yml' },
        client: { platform: 'web' },
        profile: { bundles: [] },
      },
    })
    mkdirSync(dirname(clientPath), { recursive: true })
    writeFileSync(clientPath, 'module.exports = {}\n')
    expect(construct([currentName]).graph().entries.map(entry => entry.id)).toEqual([currentName])
  })

  it('groups missing bundles under one source-build instruction with a package/path list', () => {
    const firstName = '@fixture/missing-first'
    const secondName = '@fixture/missing-second'
    const firstPath = writePackage(firstName)
    const secondPath = writePackage(secondName)
    expect(() => construct([firstName, secondName])).toThrow([
      'client-modules: 2 client packages failed to compose:',
      '  client bundles not found; run `pnpm run build` before launch:',
      `    - package: ${firstName}`,
      `      path: ${firstPath}`,
      `    - package: ${secondName}`,
      `      path: ${secondPath}`,
    ].join('\n'))
  })

  it('does not report other bundle read failures as missing builds', () => {
    const packageName = '@fixture/unreadable-client'
    const clientPath = writePackage(packageName)
    mkdirSync(clientPath, { recursive: true })
    let thrown: unknown
    try {
      construct([packageName])
    } catch (error) {
      thrown = error
    }
    expect(String(thrown)).toContain('client-modules: 1 client package failed to compose:')
    expect(String(thrown)).toContain('  other failures:')
    expect(String(thrown)).toContain('EISDIR')
    expect(String(thrown)).not.toContain('pnpm run build')
  })

  it('serves the source map beside a registered client bundle', async () => {
    const packageName = '@fixture/source-map'
    const clientPath = writePackage(packageName)
    mkdirSync(dirname(clientPath), { recursive: true })
    writeFileSync(clientPath, 'module.exports = {}\n')
    const map = '{"version":3,"sources":["src/client/index.tsx"]}\n'
    writeFileSync(`${clientPath}.map`, map)
    const { route } = constructWithRoute([packageName])

    const plain = await dispatch(route, `/plugins/${packageName}/client.js.map`)
    expect(plain.status).toBe(200)
    // The map URL carries no rev, so it revalidates instead of pinning.
    expect(plain.headers).toEqual({
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-cache',
      'vary': 'accept-encoding',
      'content-length': String(Buffer.byteLength(map)),
    })
    expect(plain.body.toString('utf8')).toBe(map)

    const gzipped = await dispatch(route, `/plugins/${packageName}/client.js.map`, 'gzip')
    expect(gzipped.headers['content-encoding']).toBe('gzip')
    expect(gunzipSync(gzipped.body).toString('utf8')).toBe(map)
  })

  it('serves bundles as immutable content-addressed responses with negotiated gzip', async () => {
    const packageName = '@fixture/bundle-cache'
    const clientPath = writePackage(packageName)
    mkdirSync(dirname(clientPath), { recursive: true })
    const content = 'module.exports = {}\n'.repeat(300)
    writeFileSync(clientPath, content)
    const { route } = constructWithRoute([packageName])
    const url = `/plugins/${packageName}/client.js?rev=abc123`

    const plain = await dispatch(route, url)
    expect(plain.status).toBe(200)
    // The rev query content-addresses the body, so the browser may pin it.
    expect(plain.headers).toEqual({
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'public, max-age=31536000, immutable',
      'vary': 'accept-encoding',
      'content-length': String(Buffer.byteLength(content)),
    })
    expect(plain.body.toString('utf8')).toBe(content)

    const gzipped = await dispatch(route, url, 'gzip')
    expect(gzipped.headers).toMatchObject({
      'content-encoding': 'gzip',
      'cache-control': 'public, max-age=31536000, immutable',
      'vary': 'accept-encoding',
    })
    expect(Number(gzipped.headers['content-length'])).toBe(gzipped.body.length)
    expect(gunzipSync(gzipped.body).toString('utf8')).toBe(content)
  })
})
