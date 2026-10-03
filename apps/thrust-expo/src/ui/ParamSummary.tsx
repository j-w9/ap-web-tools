import { paramToString } from '@apwt/ardupilot'
import { PARAM_METADATA, SAVED_PARAM_NAMES, type MotorParamName } from '../analysis/params.js'
import type { ExpoSetting } from '../analysis/linearisation.js'

export interface ParamSummaryProps {
  values: Readonly<Record<(typeof SAVED_PARAM_NAMES)[number], number>>
  motThstHover: number | null
  /** Null before there is data to fit. */
  expoSetting: ExpoSetting['kind'] | null
}

function show(value: number): string {
  return Number.isFinite(value) ? paramToString(value) : '—'
}

const EXPO_NOTE: Readonly<Record<ExpoSetting['kind'], string>> = { fit: 'fitted', fixed: 'manual' }

/** The values the parameter file will contain. */
export function ParamSummary({ values, motThstHover, expoSetting }: ParamSummaryProps) {
  const rows: { name: MotorParamName; value: string; note?: string }[] = SAVED_PARAM_NAMES.map((name) => ({
    name,
    value: show(values[name]),
    ...(name === 'MOT_THST_EXPO' && expoSetting ? { note: EXPO_NOTE[expoSetting] } : {})
  }))
  rows.push({
    name: 'MOT_THST_HOVER',
    value: motThstHover === null ? '—' : show(motThstHover),
    ...(motThstHover === null ? { note: 'not estimated, not saved' } : {})
  })
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
          {rows.map((r) => (
            <tr key={r.name}>
              <td>{r.name}</td>
              <td>
                {r.note && (
                  <span className="apwt-badge apwt-badge--gray" style={{ marginRight: 8 }}>
                    {r.note}
                  </span>
                )}
                {r.value}
              </td>
              <td style={{ textAlign: 'left', whiteSpace: 'normal', fontFamily: 'var(--font)' }}>
                {PARAM_METADATA[r.name].description}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
