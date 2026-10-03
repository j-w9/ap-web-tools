import type { TextMatrix } from '../analysis/setup.js'

export interface MatrixTableProps {
  /** Upstream table id and the prefix of pyAircraftIden's parameter names: A, B, H0 or H1. */
  name: string
  label: string
  matrix: TextMatrix
  onChange: (matrix: TextMatrix) => void
}

/** A grid of text cells: numbers, or symbols with an optional leading minus. */
export function MatrixTable({ name, label, matrix, onChange }: MatrixTableProps) {
  const set = (i: number, j: number, value: string) =>
    onChange(matrix.map((row, r) => (r === i ? row.map((cell, c) => (c === j ? value : cell)) : row)))
  return (
    <div className="sysid-matrix">
      <div className="sysid-picker__label">{label}</div>
      <table>
        <tbody>
          {matrix.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>
                  <input
                    type="text"
                    className="apwt-input"
                    aria-label={`${name}_${i}_${j}`}
                    title={`${name}_${i}_${j}`}
                    value={cell}
                    onChange={(e) => set(i, j, e.target.value)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
