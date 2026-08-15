import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { AUTHENTICATED, isAuthenticated } from '../src/basic-auth.ts'
import { bridge } from '../src/http-bridge.ts'

describe('HTTP bridge abort', () => {
  it('destroys a declared-oversize request instead of draining it', async () => {
    const destroyed: true[] = []
    const request = Readable.from([]) as unknown as IncomingMessage
    Object.assign(request, {
      url: '/api/session.prompt',
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '999999' },
      destroy: () => { destroyed.push(true) },
    })
    let status: number | undefined
    let headers: unknown
    const response = Object.assign(new EventEmitter(), {
      writableEnded: false,
      writeHead(code: number, values?: unknown) { status = code; headers = values; return this },
      write() { return true },
      end(this: { writableEnded: boolean }) { this.writableEnded = true; return this },
    }) as unknown as ServerResponse

    await bridge(request, response, {
      fetch: () => { throw new Error('a rejected request must never reach the handler') },
    }, 1000)
    // The socket must not stay parked draining a body the client can trickle
    // at will after the rejection — same discipline as the chunked overrun.
    expect(status).toBe(413)
    expect(headers).toMatchObject({ connection: 'close' })
    expect(destroyed).toHaveLength(1)
  })

  it('aborts a pending native picker request when the browser disconnects', async () => {
    const body = JSON.stringify({
      type: 'client-request', rpcId: 'picker-1', method: 'host.pickDirectory', payload: {},
    })
    const request = Readable.from([Buffer.from(body)]) as unknown as IncomingMessage
    Object.assign(request, {
      url: '/api/host.pickDirectory',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    })

    const response = Object.assign(new EventEmitter(), {
      writableEnded: false,
      writeHead() { return this },
      write() { return true },
      end() { this.writableEnded = true; return this },
    }) as unknown as ServerResponse

    let resolveStarted!: () => void
    const started = new Promise<void>((resolve) => { resolveStarted = resolve })
    let carrierSignal: AbortSignal | undefined
    const pending = bridge(request, response, {
      fetch: async (input) => {
        const fetchRequest = input
        carrierSignal = fetchRequest.signal
        resolveStarted()
        if (!fetchRequest.signal.aborted) {
          await new Promise<void>((resolve) => {
            fetchRequest.signal.addEventListener('abort', () => { resolve() }, { once: true })
          })
        }
        return Response.json({ aborted: fetchRequest.signal.aborted })
      },
    }, Number.MAX_SAFE_INTEGER)
    await started
    response.emit('close')
    await pending
    expect(carrierSignal?.aborted).toBe(true)
  })
})

describe('HTTP bridge authentication stamp', () => {
  it('carries the gate stamp from the node request to the fetch request', async () => {
    const request = Readable.from([]) as unknown as IncomingMessage
    Object.assign(request, {
      url: '/api/settings.describe',
      method: 'POST',
      headers: { 'content-type': 'application/json', host: 'harness.example' },
    })
    // The gate stamps the node request; the bridge must hand it to the
    // fetch-shaped handler, whose privileged-method check consumes it.
    ;(request as unknown as { [AUTHENTICATED]?: true })[AUTHENTICATED] = true

    let seen: Request | undefined
    const response = Object.assign(new EventEmitter(), {
      writableEnded: false,
      writeHead() { return this },
      write() { return true },
      end() { this.writableEnded = true; return this },
    }) as unknown as ServerResponse
    await bridge(request, response, {
      fetch: async (input) => { seen = input; return Response.json({ ok: true }) },
    }, Number.MAX_SAFE_INTEGER)
    expect(isAuthenticated(seen!)).toBe(true)
  })

  it('leaves an unstamped request unstamped', async () => {
    const request = Readable.from([]) as unknown as IncomingMessage
    Object.assign(request, {
      url: '/api/session.list',
      method: 'GET',
      headers: { host: '127.0.0.1:3080' },
    })
    let seen: Request | undefined
    const response = Object.assign(new EventEmitter(), {
      writableEnded: false,
      writeHead() { return this },
      write() { return true },
      end() { this.writableEnded = true; return this },
    }) as unknown as ServerResponse
    await bridge(request, response, {
      fetch: async (input) => { seen = input; return Response.json({ ok: true }) },
    }, Number.MAX_SAFE_INTEGER)
    expect(isAuthenticated(seen!)).toBe(false)
  })
})

describe('HTTP bridge response compression', () => {
  /** What one captured response recorded. */
  interface CapturedResponse {
    status: number
    headers: Record<string, string> | undefined
    chunks: Buffer[]
    writableEnded: boolean
  }

  /** Fake response recording the status, headers, and every written byte. */
  function capture(): { state: CapturedResponse; response: ServerResponse } {
    const state: CapturedResponse = { status: 0, headers: undefined, chunks: [], writableEnded: false }
    const response = Object.assign(new EventEmitter(), {
      writableEnded: false,
      writeHead(code: number, values?: Record<string, string>) {
        state.status = code
        state.headers = values
        return response
      },
      write(chunk: Uint8Array) {
        state.chunks.push(Buffer.from(chunk))
        return true
      },
      end(chunk?: Uint8Array) {
        if (chunk !== undefined) state.chunks.push(Buffer.from(chunk))
        state.writableEnded = true
        return response
      },
    }) as unknown as ServerResponse
    return { state, response }
  }

  /** Bodyless POST fixture carrying the given accept-encoding. */
  function postRequest(acceptEncoding?: string): IncomingMessage {
    const request = Readable.from([]) as unknown as IncomingMessage
    Object.assign(request, {
      url: '/api/session.history',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(acceptEncoding === undefined ? {} : { 'accept-encoding': acceptEncoding }),
      },
    })
    return request
  }

  it('gzip-compresses a JSON-RPC response when the client accepts gzip', async () => {
    const { state, response } = capture()
    const payload = JSON.stringify({ events: [{ seq: 1 }, { seq: 2 }] })
    await bridge(postRequest('gzip'), response, {
      fetch: async () => new Response(payload, { headers: { 'content-type': 'application/json' } }),
    }, Number.MAX_SAFE_INTEGER)
    expect(state.status).toBe(200)
    expect(state.headers).toMatchObject({
      'content-type': 'application/json',
      'content-encoding': 'gzip',
      'vary': 'accept-encoding',
    })
    expect(Number(state.headers?.['content-length'])).toBe(Buffer.concat(state.chunks).length)
    expect(gunzipSync(Buffer.concat(state.chunks)).toString('utf8')).toBe(payload)
  })

  it('serves a JSON-RPC response identity-encoded without an accept-encoding header', async () => {
    const { state, response } = capture()
    const payload = JSON.stringify({ ok: true })
    await bridge(postRequest(), response, {
      fetch: async () => new Response(payload, { headers: { 'content-type': 'application/json' } }),
    }, Number.MAX_SAFE_INTEGER)
    expect(state.headers?.['content-encoding']).toBeUndefined()
    expect(state.headers?.['vary']).toBe('accept-encoding')
    expect(Number(state.headers?.['content-length'])).toBe(Buffer.byteLength(payload))
    expect(Buffer.concat(state.chunks).toString('utf8')).toBe(payload)
  })

  it('streams SSE responses untouched even when gzip is accepted', async () => {
    const { state, response } = capture()
    const frame = 'data: {"type":"session/appended","seq":1}\n\n'
    await bridge(postRequest('gzip'), response, {
      fetch: async () => new Response(frame, {
        headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
      }),
    }, Number.MAX_SAFE_INTEGER)
    expect(state.headers?.['content-encoding']).toBeUndefined()
    expect(Buffer.concat(state.chunks).toString('utf8')).toBe(frame)
  })
})
