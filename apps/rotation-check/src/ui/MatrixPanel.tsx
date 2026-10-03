import type { Matrix3 } from '../analysis/matrix3.js'
import { EULER_AXES, type EulerDeg, type StandardRotation } from '../analysis/rotations.js'

/** Fixed decimals without a distracting "-0.0000" for values that round to zero. */
function fmt(value: number, digits: number): string {
  const s = value.toFixed(digits)
  return Number(s) === 0 ? (0).toFixed(digits) : s
}

const ROWS = [
  ['a', 'X forward'],
  ['b', 'Y right'],
  ['c', 'Z down']
] as const

/** The rotation matrix as a table: each column is a rotated body axis in the reference frame. */
export function MatrixTable({ matrix }: { matrix: Matrix3 }) {
  return (
    <div className="apwt-table-wrap">
      <table className="apwt-table">
        <thead>
          <tr>
            <th>Reference axis</th>
            <th>Body X</th>
            <th>Body Y</th>
            <th>Body Z</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map(([row, label]) => (
            <tr key={row}>
              <td>{label}</td>
              <td>{fmt(matrix[row].x, 4)}</td>
              <td>{fmt(matrix[row].y, 4)}</td>
              <td>{fmt(matrix[row].z, 4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function eulerText(e: EulerDeg): string {
  return EULER_AXES.map((axis) => `${axis} ${fmt(e[axis], 1)}°`).join(', ')
}

export interface MatchListProps {
  matches: readonly StandardRotation[]
  onSelect: (rotation: StandardRotation) => void
}

/** Standard rotations equal to a custom one, as buttons that select them. */
export function MatchList({ matches, onSelect }: MatchListProps) {
  if (matches.length === 0) {
    return <span>None. Use a custom rotation (CUSTOM_ROT1_ROLL, _PITCH, _YAW).</span>
  }
  return (
    <span className="apwt-readout" style={{ justifyContent: 'flex-end' }}>
      {matches.map((r) => (
        <button key={r.value} type="button" className="apwt-btn apwt-btn--ghost" onClick={() => onSelect(r)}>
          {r.value}: {r.name}
        </button>
      ))}
    </span>
  )
}
