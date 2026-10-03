import { Download } from 'lucide-react'
import type { RatioSuggestion } from '../analysis/params.js'

export interface ParamPanelProps {
  /** Per sensor, in sensor order; null when the window had too few valid samples. */
  suggestions: readonly (RatioSuggestion | null)[]
  /** Ratio parameter name per sensor, for rows without a suggestion. */
  names: readonly string[]
  /** Fit reliability warnings. */
  warnings: readonly string[]
  onSave: () => void
  /** Upstream's confirm text while a save waits for OK or Cancel. */
  confirm: string | null
  onConfirm: (ok: boolean) => void
  /** Result of the last save (upstream's alert text), shown under the button. */
  saveStatus: string | null
}

const fmt = (v: number | undefined | null, digits: number): string => (v == null || !isFinite(v) ? 'n/a' : v.toFixed(digits))

/** Suggested ratios with the current value and change, warnings, and the .param download. */
export function ParamPanel({ suggestions, names, warnings, onSave, confirm, onConfirm, saveStatus }: ParamPanelProps) {
  return (
    <>
      <div className="apwt-table-wrap">
        <table className="apwt-table">
          <thead>
            <tr>
              <th>Parameter</th>
              <th>Suggested</th>
              <th>Current</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            {suggestions.map((s, i) => (
              <tr key={names[i] ?? i}>
                <td>{s?.name ?? names[i]}</td>
                {s ? (
                  <>
                    <td className={s.outOfRange ? 'apwt-changed' : undefined}>{fmt(s.ratio, 3)}</td>
                    <td>{fmt(s.current, 3)}</td>
                    <td>
                      {s.changePercent !== null && isFinite(s.changePercent)
                        ? `${s.changePercent >= 0 ? '+' : ''}${s.changePercent.toFixed(1)}%`
                        : 'n/a'}
                    </td>
                  </>
                ) : (
                  <td colSpan={3}>not enough valid samples in the selected window</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {warnings.map((w) => (
        <p key={w} className="apwt-error" role="alert">
          {w}
        </p>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
        <button type="button" className="apwt-btn apwt-btn--primary" disabled={confirm !== null} onClick={onSave}>
          <Download />
          Save parameters
        </button>
      </div>
      {confirm !== null && (
        <div role="alertdialog" aria-label="Confirm save" style={{ marginTop: 12 }}>
          <p className="apwt-error" style={{ whiteSpace: 'pre-wrap' }}>
            {confirm}
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="apwt-btn apwt-btn--primary" onClick={() => onConfirm(true)}>
              OK
            </button>
            <button type="button" className="apwt-btn" onClick={() => onConfirm(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {saveStatus && (
        <p className="apwt-section__help" style={{ whiteSpace: 'pre-wrap' }}>
          {saveStatus}
        </p>
      )}
    </>
  )
}
