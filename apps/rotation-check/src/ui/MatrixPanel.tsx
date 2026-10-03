import type { Matrix3 } from '../analysis/matrix3.js'
import { EULER_AXES, type EulerDeg } from '../analysis/rotations.js'

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
