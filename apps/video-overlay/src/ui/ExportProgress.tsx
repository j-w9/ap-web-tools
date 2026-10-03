import { exportRunning, type ExportState } from '../export/pipeline.js'

/** Blocking progress panel while an export runs, with upstream's percentage and a Cancel button. */
export function ExportProgress({ state, onCancel }: { state: ExportState; onCancel: () => void }) {
  if (!exportRunning(state)) return null
  const encoding = state.status === 'encoding'
  return (
    <div className="vo-modal" role="status" aria-live="polite">
      <div className="apwt-card vo-modal__panel">
        <div className="apwt-loading__label">{encoding ? `Exporting ${state.progressText}` : 'Preparing export…'}</div>
        <div className="vo-bar">
          <span style={{ width: `${encoding ? Math.min(100, Math.max(0, state.progress * 100)) : 0}%` }} />
        </div>
        <button type="button" className="apwt-btn apwt-btn--block" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
