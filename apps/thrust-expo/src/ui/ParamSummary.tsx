import { paramToString } from '@apwt/ardupilot'
import type { ExpoSetting } from '../analysis/linearisation.js'
import { PARAM_METADATA, type MotorParamName } from '../analysis/params.js'

export interface ParamSummaryProps {
  /** What Save parameters writes, in file order (upstream `params` with `save` set). */
  saved: readonly { readonly name: MotorParamName; readonly value: number | null }[]
  /** How the expo was chosen at the last plot update; null without data. */
  expoSetting: ExpoSetting['kind'] | null
}

/** A value as the file writes it, or a dash where upstream's `param_to_string` would fail. */
function show(value: number | null): string {
  try {
    return paramToString(value ?? 0)
  } catch {
    return '—'
  }
}

const EXPO_NOTE: Readonly<Record<ExpoSetting['kind'], string>> = { fit: 'fitted', fixed: 'manual' }

/** The values the parameter file will contain (a convenience view of upstream's `params`). */
export function ParamSummary({ saved, expoSetting }: ParamSummaryProps) {
  return (
    <div className="apwt-table-wrap">
      <table className="apwt-table">
        <thead>
          <tr>
            <th>Parameter</th>
            <th>Value</th>
            <th style={{ textAlign: 'left' }}>Description</th>
          </tr>
        </thead>
        <tbody>
          {saved.map((r) => {
            const note = r.name === 'MOT_THST_EXPO' && expoSetting ? EXPO_NOTE[expoSetting] : null
            return (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td>
                  {note && (
                    <span className="apwt-badge apwt-badge--gray" style={{ marginRight: 8 }}>
                      {note}
                    </span>
                  )}
                  {show(r.value)}
                </td>
                <td style={{ textAlign: 'left', whiteSpace: 'normal', fontFamily: 'var(--font)' }}>
                  {PARAM_METADATA[r.name].description}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
