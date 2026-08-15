/**
 * Browser carrier 401 handling: an unauthenticated response triggers one
 * navigation so the native Basic challenge can replay, and a successful
 * response clears the marker so the next expired session navigates again.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebApiClient } from '../src/client/web-api-client.ts'

type Win = {
  location?: { origin: string; pathname: string; search: string; assign: (url: string) => void }
  sessionStorage?: {
    getItem: (key: string) => string | null
    setItem: (key: string, value: string) => void
    removeItem: (key: string) => void
  }
}

const marker = 'dsh-web-reauth'

function installBrowser(): { assign: ReturnType<typeof vi.fn> } {
  const assign = vi.fn()
  const store = new Map<string, string>()
  const sessionStorage = {
    getItem: (key: string): string | null => store.get(key) ?? null,
    setItem: (key: string, value: string): void => { store.set(key, value) },
    removeItem: (key: string): void => { store.delete(key) },
  }
  Object.assign(globalThis, {
    location: { origin: 'http://127.0.0.1:3080', pathname: '/', search: '', assign },
    sessionStorage,
  })
  return { assign }
}

const unauthorized = (): Response => new Response('', { status: 401 })
const ok = (rpcId: string): Response => new Response(JSON.stringify({
  type: 'server-response',
  rpcId,
  result: { ok: true, value: { items: [] } },
}), {
  status: 200,
  headers: { 'content-type': 'application/json' },
})

/** Fetch stub replaying a scripted `'401' | 'ok'` sequence and echoing the request rpcId. */
function scriptedFetch(sequence: ('401' | 'ok')[]): ReturnType<typeof vi.fn> {
  return vi.fn<typeof fetch>(async (_input, init) => {
    const { rpcId } = JSON.parse(init?.body as string) as { rpcId: string }
    return sequence.shift() === 'ok' ? ok(rpcId) : unauthorized()
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete (globalThis as Win).location
  delete (globalThis as Win).sessionStorage
})

describe('WebApiClient 401 handling', () => {
  it('navigates once on a 401 and not again while the session stays rejected', async () => {
    const { assign } = installBrowser()
    vi.stubGlobal('fetch', scriptedFetch(['401', '401']))
    const client = new WebApiClient()

    await expect(client.sessions.list({})).rejects.toThrow()
    expect(assign).toHaveBeenCalledTimes(1)
    expect(assign).toHaveBeenCalledWith('/?reauth=1')
    await expect(client.sessions.list({})).rejects.toThrow()
    expect(assign).toHaveBeenCalledTimes(1)
  })

  it('clears the marker on a successful response and navigates on the next 401', async () => {
    const { assign } = installBrowser()
    vi.stubGlobal('fetch', scriptedFetch(['401', 'ok', '401']))
    const client = new WebApiClient()

    await expect(client.sessions.list({})).rejects.toThrow()
    expect(assign).toHaveBeenCalledTimes(1)
    expect(globalThis.sessionStorage?.getItem(marker)).toBe('1')
    await client.sessions.list({})
    expect(globalThis.sessionStorage?.getItem(marker)).toBeNull()
    await expect(client.sessions.list({})).rejects.toThrow()
    expect(assign).toHaveBeenCalledTimes(2)
  })

  it('does not navigate when storage is unavailable', async () => {
    const { assign } = installBrowser()
    const sessionStorage = {
      getItem: (): string | null => { throw new Error('storage blocked') },
      setItem: (): void => { throw new Error('storage blocked') },
      removeItem: (): void => { throw new Error('storage blocked') },
    }
    Object.assign(globalThis, { sessionStorage })
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(unauthorized()))
    const client = new WebApiClient()

    await expect(client.sessions.list({})).rejects.toThrow()
    expect(assign).not.toHaveBeenCalled()
  })
})
