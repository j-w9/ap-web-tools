import { useEffect, useRef } from 'react'

export interface ConfirmDialogProps {
  readonly text: string
  readonly onOk: () => void
  readonly onCancel: () => void
}

/**
 * Upstream's `confirm()` as a modal dialog with the same text and OK/Cancel choices. Cancel has
 * focus first, and Escape cancels, as the browser's prompt does.
 */
export function ConfirmDialog({ text, onOk, onCancel }: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (dialog !== null && !dialog.open) dialog.showModal()
  }, [])
  return (
    <dialog
      ref={ref}
      className="apwt-card gcs-confirm"
      aria-label="Confirm command"
      onCancel={(e) => {
        e.preventDefault()
        onCancel()
      }}
    >
      <p>{text}</p>
      <div className="gcs-row gcs-row--end">
        <button type="button" className="apwt-btn" autoFocus onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="apwt-btn apwt-btn--primary" onClick={onOk}>
          OK
        </button>
      </div>
    </dialog>
  )
}
