import { Download } from 'lucide-react'
import { outOfRangeText, type RatioSuggestion } from '../analysis/params.js'

export interface ParamPanelProps {
  /** Per sensor, in sensor order; null when the window had too few valid samples. */
  suggestions: readonly (RatioSuggestion | null)[]
  /** Ratio parameter name per sensor, for rows without a suggestion. */
  names: readonly string[]
  /** Fit reliability warnings. */
  warnings: readonly string[]
  onSave: () => void
  /** Result of the last save, shown under the button. */
  saveStatus: string | null
}

const fmt = (v: number | undefined | null, digits: number): string => (v == null || !isFinite(v) ? 'n/a' : v.toFixed(digits))

/** Suggested ratios with the current value and change, warnings, and the .param download. */
export function ParamPanel({ suggestions, names, warnings, onSave, saveStatus }: ParamPanelProps) {
  const valid = suggestions.filter((s) => s !== null)
  const outOfRange = valid.filter((s) => s.outOfRange)
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
                    <td className={s.outOfRange ? 'apwt-changed' : undefined}>{s.ratio.toFixed(3)}</td>
                    <td>{fmt(s.current, 3)}</td>
                    <td>
                      {s.changePercent !== null && isFinite(s.changePercent)
                        ? `${s.changePercent >= 0 ? '+' : ''}${s.changePercent.toFixed(1)}%`
                        : 'n/a'}
                    </td>
                  </>
                ) : (
                  <td colSpan={3}>Not enough valid samples in the selected window</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {[...warnings, ...outOfRange.map(outOfRangeText)].map((w) => (
        <p key={w} className="apwt-error" role="alert">
          {w}
        </p>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
        <button type="button" className="apwt-btn apwt-btn--primary" disabled={valid.length === 0} onClick={onSave}>
          <Download />
          {outOfRange.length > 0 ? 'Save parameters anyway' : 'Save parameters'}
        </button>
        {saveStatus && <span className="apwt-section__help">{saveStatus}</span>}
      </div>
    </>
  )
}
