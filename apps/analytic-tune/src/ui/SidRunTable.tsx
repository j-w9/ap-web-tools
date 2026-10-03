import { defaultColor, withAlpha } from '@apwt/plot'
import { Chip } from '@apwt/tool-shell'
import { sidAxisLabel, type SidRun } from '../analysis/sid.js'

export interface SidRunTableProps {
  runs: readonly SidRun[]
  selected: number | null
  onSelect: (index: number) => void
}

/** The system identification runs in the log, one selectable row each (upstream "System ID Runs"). */
export function SidRunTable({ runs, selected, onSelect }: SidRunTableProps) {
  const coloured = runs.length > 1
  return (
    <div className="apwt-table-wrap">
      <table className="apwt-table at-runs">
        <thead>
          <tr>
            <th>Num</th>
            <th>Use</th>
            <th>SID axis</th>
            <th>
              Start time <span className="at-unit">(s)</span>
            </th>
            <th>
              End time <span className="at-unit">(s)</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run, i) => {
            const colour = coloured ? defaultColor(i) : undefined
            return (
              <tr
                key={`${run.startTime}-${i}`}
                className={selected === i ? 'at-run--selected' : undefined}
                style={colour ? { background: withAlpha(colour, 0.25) } : undefined}
              >
                <td>
                  {colour && <span className="at-swatch" style={{ background: colour }} />}
                  {i + 1}
                </td>
                <td>
                  <Chip type="radio" name="sid-run" checked={selected === i} onChange={() => onSelect(i)}>
                    {selected === i ? 'In use' : 'Use'}
                  </Chip>
                </td>
                <td>{sidAxisLabel(run.axis)}</td>
                <td>{run.startTime.toFixed(2)}</td>
                <td>{run.endTime.toFixed(2)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
