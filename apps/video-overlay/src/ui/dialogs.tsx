import { useCallback, useMemo, useRef, useState } from 'react'
import type { Dialogs } from '../widgets/widget.js'

interface PendingConfirm {
  readonly text: string
  readonly resolve: (ok: boolean) => void
}

/**
 * In-page replacements for upstream's `alert()` and `confirm()`, with the same text and choices:
 * alerts queue as dismissible messages, a confirmation is a modal with OK and Cancel.
 */
export function useDialogs(): { dialogs: Dialogs; view: React.ReactNode } {
  const [alerts, setAlerts] = useState<readonly { id: number; text: string }[]>([])
  const [pending, setPending] = useState<PendingConfirm | null>(null)
  const nextId = useRef(0)

  const alert = useCallback((text: string) => {
    const id = nextId.current++
    setAlerts((list) => [...list, { id, text }])
  }, [])
  const confirm = useCallback((text: string) => new Promise<boolean>((resolve) => setPending({ text, resolve })), [])
  const dialogs = useMemo(() => ({ alert, confirm }), [alert, confirm])

  const answer = (ok: boolean) => {
    pending?.resolve(ok)
    setPending(null)
  }

  const view = (
    <>
      {alerts.map((a) => (
        <div key={a.id} className="apwt-error vo-alert" role="alert">
          <span>{a.text}</span>
          <button type="button" className="apwt-btn" onClick={() => setAlerts((list) => list.filter((x) => x.id !== a.id))}>
            OK
          </button>
        </div>
      ))}
      {pending && (
        <div className="vo-modal" role="alertdialog" aria-modal="true">
          <div className="apwt-card vo-modal__panel">
            <p className="vo-modal__text">{pending.text}</p>
            <div className="vo-btn-row">
              <button type="button" className="apwt-btn apwt-btn--primary" onClick={() => answer(true)}>
                OK
              </button>
              <button type="button" className="apwt-btn" onClick={() => answer(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
  return { dialogs, view }
}
