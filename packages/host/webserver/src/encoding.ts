/**
 * HTTP response content-encoding negotiation for fully-buffered file bodies.
 * The webserver itself serves no files, so this helper exists for its file
 * serving consumers (the client-modules bundle route and the frontend-static
 * dist server); both send one complete body per response, which is the only
 * shape gzip applies to (streaming responses such as SSE must not compress).
 * @module dsh-host-webserver/encoding
 */

import { gzip } from 'node:zlib'
import { promisify } from 'node:util'

const gzipAsync = promisify(gzip)

/** One fully-buffered response body after negotiation. */
export interface GzipResult {
  /** The body to send: gzip-compressed when the client accepted it, else the original buffer. */
  body: Buffer
  /** The value for `Content-Encoding`; undefined for the identity encoding. */
  encoding: 'gzip' | undefined
}

/**
 * Compress a fully-buffered body with gzip when the client accepts it.
 * Negotiation matches an explicit `gzip` token (a `q=0` preference rejects it)
 * or a bare `*` wildcard; it does not implement full q-value precedence, so a
 * malformed or unusual `Accept-Encoding` value falls back to identity. Callers
 * send `Vary: accept-encoding` alongside so shared caches key on the choice.
 * @param acceptEncoding - the request's `Accept-Encoding` header value.
 * @param body - the complete uncompressed response body.
 * @returns the body plus the encoding to declare; the identity body is
 * returned untouched and shared, so callers must not mutate it.
 */
export async function gzipIfAccepted(
  acceptEncoding: string | undefined,
  body: Buffer,
): Promise<GzipResult> {
  if (acceptEncoding === undefined || !acceptsGzip(acceptEncoding)) {
    return { body, encoding: undefined }
  }
  return { body: await gzipAsync(body), encoding: 'gzip' }
}

/** Whether an `Accept-Encoding` header value permits gzip (lenient parsing; see {@link gzipIfAccepted}). */
function acceptsGzip(header: string): boolean {
  let wildcard = false
  for (const part of header.split(',')) {
    const pieces = part.trim().toLowerCase().split(';').map(piece => piece.trim())
    const token = pieces[0]
    const q = pieces.slice(1).find(piece => piece.startsWith('q='))?.slice(2)
    const acceptable = Number(q) !== 0
    if (token === 'gzip') return acceptable
    if (token === '*') wildcard = acceptable
  }
  return wildcard
}
