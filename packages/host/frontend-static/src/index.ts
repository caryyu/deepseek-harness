/**
 * @deepseek-ai/dsh-host-frontend-static — SPA dist server over the webserver
 * fallback seat: serves the built frontend directory with the semantics the
 * Web shell locked at step1 — traversal outside the dist root is 403, any
 * miss falls back to index.html with HTTP 200 (SPA routing), unknown
 * extensions ship as octet-stream, non-GET/HEAD is 405. Every index response
 * runs through the webserver's registered index taps (boot-manifest
 * injection). The dist location is workspace knowledge of the composing
 * application, so `distIndex` is typically supplied through a `!!js`
 * expression, never hardcoded by a deployment.
 * @module @deepseek-ai/dsh-host-frontend-static
 */

import type { ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { basename, dirname, extname, join, normalize, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { gzipIfAccepted } from '@deepseek-ai/dsh-host-webserver'

/** Stable Cordis plugin name. */
export const name = 'frontend-static'

/** Service required before the fallback seat can be claimed. */
export const inject = ['webServer']

/** Plugin config: the dist anchor. */
export interface Config {
  /** Absolute path of index.html inside the dist root. */
  distIndex: string
}

export const Config: z<Config> = z.object({
  distIndex: z.string().required(),
})

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.map': 'application/json',
  '.webmanifest': 'application/manifest+json',
}

/**
 * Dist files whose bodies are text and therefore gzip-compressible (fonts and
 * unknown extensions ship raw).
 */
const COMPRESSIBLE: ReadonlySet<string> = new Set([
  '.html', '.js', '.css', '.svg', '.json', '.map', '.webmanifest',
])

/**
 * Content-hashed asset name: vite emits `name-<hash>.<ext>` (build assets) and
 * copies `public/` verbatim (manifest, favicon), so a dash-hash name plus a
 * known extension identifies a body that a rebuild renames. Only those may be
 * pinned; everything else revalidates every fetch.
 */
const HASHED_ASSET_NAME = /-[A-Za-z0-9_-]{8,}\.(?:js|css|json|map|svg|woff2?|ttf)(?:\.map)?$/

/** Index responses carry the boot manifest; they must always revalidate. */
const INDEX_CACHE = 'no-cache'

/** Responses for `HASHED_ASSET_NAME` bodies: content-addressed by filename, safe to pin. */
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable'

/** Every response that may switch on `Accept-Encoding` declares it for shared caches. */
const VARY = 'accept-encoding'

/**
 * Serve one GET/HEAD static request from the dist root.
 * @param pathname - decoded URL pathname of the request.
 * @param res - the node:http response to write.
 * @param distRoot - absolute dist root directory (resolved by the caller).
 * @param distIndex - absolute path of index.html inside distRoot.
 * @param renderIndex - produces the index.html body (index-tap injection) for
 * `/` and every SPA fallback.
 * @param acceptEncoding - the request's `Accept-Encoding` header value; text
 * bodies are gzip-compressed when it permits gzip.
 */
export async function serveStatic(
  pathname: string, res: ServerResponse, distRoot: string, distIndex: string,
  renderIndex: () => Promise<string>, acceptEncoding: string | undefined,
): Promise<void> {
  const target = resolve(normalize(join(distRoot, pathname)))
  // Traversal rejection: the target must be distRoot itself (`/`) or stay under
  // it. `sep`, not '/': resolve() emits backslash paths on Windows, where a '/'
  // suffix would reject every legitimate subpath as traversal.
  if (target !== distRoot && !target.startsWith(distRoot + sep)) {
    res.writeHead(403)
    res.end()
    return
  }
  const serveIndex = async (): Promise<void> => {
    const { body, encoding } = await gzipIfAccepted(acceptEncoding, Buffer.from(await renderIndex()))
    res.writeHead(200, {
      'content-type': MIME['.html'],
      'cache-control': INDEX_CACHE,
      'vary': VARY,
      ...(encoding === undefined ? {} : { 'content-encoding': encoding }),
      'content-length': String(body.length),
    })
    res.end(body)
  }
  if (target === distRoot || target === distIndex) {
    await serveIndex()
    return
  }
  const ext = extname(target)
  const cacheControl = HASHED_ASSET_NAME.test(basename(target)) ? IMMUTABLE_CACHE : INDEX_CACHE
  let raw: Buffer
  try {
    raw = await readFile(target)
  } catch {
    // Miss (ENOENT/EISDIR) falls back to index.html with 200 (SPA routing).
    await serveIndex()
    return
  }
  const { body, encoding } = await gzipIfAccepted(COMPRESSIBLE.has(ext) ? acceptEncoding : undefined, raw)
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': cacheControl,
    'vary': VARY,
    ...(encoding === undefined ? {} : { 'content-encoding': encoding }),
    'content-length': String(body.length),
  })
  res.end(body)
}

/**
 * Claim the webserver fallback seat and serve the dist.
 * @param ctx - plugin context carrying the webServer service.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  const distIndex = config.distIndex
  const distRoot = dirname(distIndex)
  const renderIndex = async (): Promise<string> =>
    ctx.webServer.applyIndexTaps(await readFile(distIndex, 'utf8'))
  ctx.effect(() => ctx.webServer.registerFallback(async (req, res) => {
    // Non-GET/HEAD without a matching named route is 405 (fallback-only
    // semantics: named routes own their method handling).
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405)
      res.end()
      return
    }
    /* v8 ignore next -- node:http always sets url on server requests */
    const rawPath = new URL(req.url ?? '/', 'http://x').pathname
    await serveStatic(decodeURIComponent(rawPath), res, distRoot, distIndex, renderIndex, req.headers['accept-encoding'])
  }), 'frontend-static: fallback seat')
}
