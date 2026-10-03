import { defaultColor, withAlpha } from '@apwt/plot'
import type { ParamSets } from '../analysis/param-sets.js'
import { PID_PARAMS, PID_PARAM_KEYS, pidParamName } from '../analysis/vehicle.js'

export interface ParamSetTableProps {
  paramSets: ParamSets
  /** Which sets have analysable data (an FFT). */
  valid: readonly boolean[]
  shown: readonly boolean[]
  onShownChange: (shown: readonly boolean[]) => void
}

const cell = (color: string | null): React.CSSProperties => ({
  border: '1px solid #000',
  padding: 8,
  ...(color ? { backgroundColor: withAlpha(color, 0.4) } : {})
})

/** One row per parameter set: its number, a show checkbox and every PID gain, bold where changed. */
export function ParamSetTable({ paramSets, valid, shown, onShownChange }: ParamSetTableProps) {
  const sets = paramSets.sets
  const multi = sets.length > 1
  const validCount = valid.filter(Boolean).length
  return (
    <fieldset style={{ minHeight: 300, flex: 1 }}>
      <legend>Tests</legend>
      <table style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={cell(null)}>Num</th>
            <th style={cell(null)}>Show</th>
            {PID_PARAM_KEYS.map((k) => (
              <th key={k} style={cell(null)} title={pidParamName(paramSets.prefix, k)}>
                {PID_PARAMS[k].title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sets.map((set, i) => {
            const color = multi ? defaultColor(i) : null
            const isValid = valid[i] ?? false
            return (
              <tr key={i}>
                <td style={cell(color)}>{i + 1}</td>
                <td style={cell(color)}>
                  <input
                    type="checkbox"
                    checked={shown[i] ?? false}
                    disabled={validCount === 1 || !isValid}
                    onChange={(e) => {
                      const next = [...shown]
                      next[i] = e.target.checked
                      onShownChange(next)
                    }}
                  />
                </td>
                {PID_PARAM_KEYS.map((k) => {
                  const value = set.values[k]
                  const prev = i > 0 ? sets[i - 1]?.values[k] : undefined
                  const changed = i > 0 && value !== prev
                  const text = value == null ? '' : value.toFixed(PID_PARAMS[k].decimalPlaces)
                  return (
                    <td key={k} style={cell(color)}>
                      {changed ? <b>{text}</b> : text}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </fieldset>
  )
}
