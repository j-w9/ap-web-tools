import { ArrowDown, ArrowUp, Map as MapIcon } from 'lucide-react'
import type { VehicleType } from '@apwt/dataflash'
import { formatDistance, formatFlightTime, formatSize, formatStartTime } from '../analysis/format.js'
import type { BoardTable, ScannedLog, SortKey, SortState } from '../analysis/table.js'
import { OpenInMenu, ParamDiffCell, ParamDownloadButton, WarningsButton } from './cells.js'

export const VEHICLE_NAMES: Readonly<Record<VehicleType, string>> = {
  copter: 'Copter',
  plane: 'Plane',
  rover: 'Rover',
  sub: 'Sub',
  tracker: 'Tracker',
  blimp: 'Blimp'
}

const COLUMNS: readonly { key: SortKey; label: string }[] = [
  { key: 'date', label: 'Date' },
  { key: 'name', label: 'Name' },
  { key: 'size', label: 'Size' },
  { key: 'vehicle', label: 'Vehicle' },
  { key: 'firmware', label: 'Firmware' },
  { key: 'flightTime', label: 'Flight time' },
  { key: 'distance', label: 'Distance' }
]

const LEFT = { textAlign: 'left' } as const
const ACTIONS = { display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' } as const

export interface LogTableProps {
  table: BoardTable<File>
  sort: SortState
  onSort: (key: SortKey) => void
  onShowPath: (log: ScannedLog<File>) => void
}

/** One board's logs (upstream: one Tabulator table per board). */
export function LogTable({ table, sort, onSort, onShowPath }: LogTableProps) {
  return (
    <div className="apwt-table-wrap">
      <table className="apwt-table">
        <thead>
          <tr>
            {COLUMNS.map((c) => (
              <th
                key={c.key}
                style={c.key === 'name' || c.key === 'firmware' ? LEFT : undefined}
                aria-sort={sort.key === c.key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
              >
                <button
                  type="button"
                  onClick={() => onSort(c.key)}
                  style={{
                    font: 'inherit',
                    letterSpacing: 'inherit',
                    textTransform: 'inherit',
                    color: 'inherit',
                    background: 'none',
                    border: 0,
                    padding: 0,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    ...(sort.key === c.key ? { color: 'var(--yellow-text)' } : {})
                  }}
                >
                  {c.label}
                  {sort.key === c.key &&
                    (sort.direction === 'asc' ? <ArrowUp width={12} height={12} /> : <ArrowDown width={12} height={12} />)}
                </button>
              </th>
            ))}
            <th>Param changes</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {table.rows.map(({ log, paramDiff }) => {
            const s = log.summary
            return (
              <tr key={log.relativePath}>
                <td>{formatStartTime(s.startTime)}</td>
                <td style={LEFT} title={log.relativePath}>
                  {log.name}
                </td>
                <td>{formatSize(s.sizeBytes)}</td>
                <td>{s.vehicle ? VEHICLE_NAMES[s.vehicle] : '-'}</td>
                <td style={LEFT} title={[s.version.osString, s.boardName].filter(Boolean).join(' · ') || undefined}>
                  {s.version.fwString ?? '-'}
                </td>
                <td>{formatFlightTime(s.flightTimeS)}</td>
                <td>
                  {s.distanceM === undefined ? (
                    '-'
                  ) : (
                    <button
                      type="button"
                      className="apwt-btn apwt-btn--ghost"
                      style={{ padding: '4px 8px', fontSize: 13 }}
                      title="Show the flight path"
                      onClick={() => onShowPath(log)}
                    >
                      <MapIcon />
                      {formatDistance(s.distanceM)}
                    </button>
                  )}
                </td>
                <td>
                  <ParamDiffCell diff={paramDiff} />
                </td>
                <td>
                  <div style={ACTIONS}>
                    <ParamDownloadButton name={log.name} params={s.params} />
                    <OpenInMenu file={log.file} messageTypes={s.messageTypes} />
                    <WarningsButton summary={s} />
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
        {table.totals && (
          <tfoot>
            <tr style={{ background: 'rgb(var(--s3))', borderTop: '1px solid rgb(var(--s4))' }}>
              <td style={LEFT}>Total</td>
              <td style={LEFT}>{table.rows.length} logs</td>
              <td>{formatSize(table.totals.sizeBytes)}</td>
              <td />
              <td />
              <td>{formatFlightTime(table.totals.flightTimeS)}</td>
              <td>{formatDistance(table.totals.distanceM)}</td>
              <td title="Changes from the first row to the last">
                <ParamDiffCell diff={table.totals.paramDiff} />
              </td>
              <td />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}
