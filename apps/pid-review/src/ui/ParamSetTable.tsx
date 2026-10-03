import { defaultColor } from '@apwt/plot'
import type { ParamSets } from '../analysis/param-sets.js'
import { PID_PARAMS, PID_PARAM_KEYS, pidParamName } from '../analysis/vehicle.js'

export interface ParamSetTableProps {
  paramSets: ParamSets
  /** Which sets have analysable data. */
  valid: readonly boolean[]
  shown: readonly boolean[]
  onShownChange: (shown: readonly boolean[]) => void
}

/**
 * One row per parameter set ("test"): colour, a show checkbox and every gain and filter.
 * Values that changed from the previous set are highlighted.
 */
export function ParamSetTable({ paramSets, valid, shown, onShownChange }: ParamSetTableProps) {
  const sets = paramSets.sets
  const multi = sets.length > 1
  const validCount = valid.filter(Boolean).length
  return (
    <div className="apwt-table-wrap">
      <table className="apwt-table">
        <thead>
          <tr>
            <th>Test</th>
            {PID_PARAM_KEYS.map((k) => (
              <th key={k} title={pidParamName(paramSets.prefix, k)}>
                {PID_PARAMS[k].title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sets.map((set, i) => {
            const isValid = valid[i] ?? false
            return (
              <tr key={i}>
                <td>
                  <label className="apwt-chip" style={{ padding: '3px 8px' }}>
                    <input
                      type="checkbox"
                      checked={shown[i] ?? false}
                      disabled={validCount <= 1 || !isValid}
                      onChange={(e) => {
                        const next = [...shown]
                        next[i] = e.target.checked
                        onShownChange(next)
                      }}
                    />
                    {multi && <span className="apwt-chip__swatch" style={{ background: defaultColor(i) }} />}
                    {i + 1}
                    {!isValid && ' (no data)'}
                  </label>
                </td>
                {PID_PARAM_KEYS.map((k) => {
                  const value = set.values[k]
                  const changed = i > 0 && value !== sets[i - 1]?.values[k]
                  return (
                    <td key={k} className={changed ? 'apwt-changed' : undefined}>
                      {value == null ? '–' : value.toFixed(PID_PARAMS[k].decimalPlaces)}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
