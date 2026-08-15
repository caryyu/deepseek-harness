import { useState, type ReactNode } from 'react'
import {
  IconDownloadOutline16, IconEllipsisOutline16, Menu,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { SessionLogDownloadDialog, type SessionLogDownloadDialogProps } from './Dialog.tsx'
import css from './HeaderAction.module.css'

/**
 * Render the Session Header export capsule and its shared result dialog. On
 * title rows too narrow for the capsule, a compact overflow trigger takes
 * over and the capsule becomes the dropdown's single row; the swap is a
 * container query against the header row (see HeaderAction.module.css), so
 * the two forms never render together.
 * @param props - Session runtime, download controller, and localized dialog copy.
 * @returns the persistent Header action and Session-scoped dialog.
 */
export function SessionLogDownloadHeaderAction(props: SessionLogDownloadDialogProps): ReactNode {
  const { sessionId, useSessionLogDownload, request, t } = props
  const entry = useSessionLogDownload(state => state.bySession[String(sessionId)])
  const busy = entry?.status === 'downloading'
  const [open, setOpen] = useState(false)

  const download = (): void => {
    setOpen(false)
    void request(sessionId)
  }

  return (
    <>
      <span className={css.root}>
        <button
          type="button"
          className={css.sessionLogButton}
          disabled={busy}
          aria-busy={busy}
          onClick={() => { void request(sessionId) }}
        >
          <span>{t('action.sessionLog')}</span>
          <IconDownloadOutline16 size={12} />
        </button>
        <Menu
          open={open}
          side="bottom"
          align="end"
          onClose={() => { setOpen(false) }}
          anchor={(
            <button
              type="button"
              className={css.moreButton}
              aria-label={t('more.aria')}
              aria-busy={busy}
              aria-expanded={open}
              disabled={busy}
              onClick={() => { setOpen(current => !current) }}
            >
              <IconEllipsisOutline16 />
            </button>
          )}
          items={[{
            id: 'download',
            label: t('action.sessionLog'),
            icon: <IconDownloadOutline16 size={14} />,
            disabled: busy,
          }]}
          onSelect={download}
        />
      </span>
      <SessionLogDownloadDialog {...props} />
    </>
  )
}
