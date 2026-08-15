// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSyncExternalStore } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { SessionLogDownloadController } from '../src/client/controller.ts'
import { SessionLogDownloadHeaderAction } from '../src/client/HeaderAction.tsx'
import type { SessionLogDownloadDialogProps } from '../src/client/Dialog.tsx'
import { en } from '../src/client/locales.ts'

const SID = 'session-export-header' as SessionId

function bindSessionExport(controller: SessionLogDownloadController) {
  return function useSessionLogDownload<T>(selector: (state: ReturnType<typeof controller.store.getSnapshot>) => T): T {
    return useSyncExternalStore(
      listener => controller.store.subscribe(listener),
      () => selector(controller.store.getSnapshot()),
    )
  }
}

function bench() {
  const controller = new SessionLogDownloadController(async () => new Response('zip'), vi.fn())
  const request = vi.fn((sessionId: SessionId) => controller.download(sessionId))
  const dismiss = vi.fn((sessionId: SessionId) => { controller.dismiss(sessionId) })
  const useSessionLogDownload = bindSessionExport(controller)
  const props = {
    sessionId: SID,
    useSessionLogDownload,
    request,
    dismiss,
    t: (key: keyof typeof en): string => en[key],
  } as unknown as SessionLogDownloadDialogProps
  const view = render(<SessionLogDownloadHeaderAction {...props} />)
  return { controller, request, view }
}

afterEach(cleanup)

describe('Session export Header action', () => {
  it('renders the 111×32 text capsule and downloads through the shared controller', async () => {
    const b = bench()
    const button = b.view.getByRole('button', { name: 'Session log' })
    expect(button.querySelector('svg')).not.toBeNull()
    fireEvent.click(button)
    await waitFor(() => { expect(b.request).toHaveBeenCalledWith(SID) })
    expect(await b.view.findByRole('dialog', { name: 'Session download started' })).toBeTruthy()
  })

  it('disables the capsule while either entry path downloads this Session', async () => {
    const b = bench()
    let release!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => { release = resolve })
    const controller = new SessionLogDownloadController(() => pending, vi.fn())
    const useSessionLogDownload = bindSessionExport(controller)
    b.view.rerender(<SessionLogDownloadHeaderAction {...({
      sessionId: SID,
      useSessionLogDownload,
      request: (sessionId: SessionId) => controller.download(sessionId),
      dismiss: (sessionId: SessionId) => { controller.dismiss(sessionId) },
      t: (key: keyof typeof en): string => en[key],
    } as unknown as SessionLogDownloadDialogProps)} />)

    const download = controller.download(SID)
    const button = b.view.getByRole('button', { name: 'Session log' })
    await waitFor(() => { expect(button.getAttribute('aria-busy')).toBe('true') })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    release(new Response('zip'))
    await download
    await waitFor(() => { expect(button.getAttribute('aria-busy')).toBe('false') })
  })

  it('offers the capsule action through the overflow menu when the row is narrow', async () => {
    const b = bench()
    const more = b.view.getByRole('button', { name: en['more.aria'] })
    fireEvent.click(more)
    expect(b.view.getByRole('menuitem', { name: 'Session log' })).toBeTruthy()
    expect(more.getAttribute('aria-expanded')).toBe('true')
    // Escape closes the dropdown without acting (the Menu primitive's listener).
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => { expect(b.view.queryByRole('menuitem', { name: 'Session log' })).toBeNull() })
    expect(more.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(more)
    fireEvent.click(b.view.getByRole('menuitem', { name: 'Session log' }))
    await waitFor(() => { expect(b.request).toHaveBeenCalledWith(SID) })
    await waitFor(() => { expect(b.view.queryByRole('menuitem', { name: 'Session log' })).toBeNull() })
  })

  it('disables the overflow trigger and its row while this Session downloads', async () => {
    const b = bench()
    let release!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => { release = resolve })
    const controller = new SessionLogDownloadController(() => pending, vi.fn())
    const useSessionLogDownload = bindSessionExport(controller)
    b.view.rerender(<SessionLogDownloadHeaderAction {...({
      sessionId: SID,
      useSessionLogDownload,
      request: (sessionId: SessionId) => controller.download(sessionId),
      dismiss: (sessionId: SessionId) => { controller.dismiss(sessionId) },
      t: (key: keyof typeof en): string => en[key],
    } as unknown as SessionLogDownloadDialogProps)} />)

    const more = b.view.getByRole('button', { name: en['more.aria'] })
    fireEvent.click(more)
    const item = b.view.getByRole('menuitem', { name: 'Session log' })

    const download = controller.download(SID)
    await waitFor(() => { expect(more.getAttribute('aria-busy')).toBe('true') })
    expect((more as HTMLButtonElement).disabled).toBe(true)
    expect((item as HTMLButtonElement).disabled).toBe(true)
    release(new Response('zip'))
    await download
    await waitFor(() => { expect(more.getAttribute('aria-busy')).toBe('false') })
    expect((item as HTMLButtonElement).disabled).toBe(false)
  })
})
