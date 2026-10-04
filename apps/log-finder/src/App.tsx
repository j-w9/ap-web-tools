import { useMemo, useRef, useState } from 'react'
import type { VehicleType } from '@apwt/dataflash'
import { ErrorBanner, Section, ToolPage, type LogFact } from '@apwt/tool-shell'
import { ALL_PARAM_IGNORE_KEYS, type ParamIgnoreKey } from './analysis/param-diff.js'
import { scanLogs, type SkipReason, type SkippedFile } from './analysis/scan.js'
import {
  INITIAL_SORT,
  buildTables,
  groupByBoard,
  nextSort,
  parseDateInput,
  vehicleKey,
  type BoardSort,
  type LogFilter,
  type ScannedLog,
  type SortKey,
  type VehicleFilterKey
} from './analysis/table.js'
import { LogTable, VEHICLE_NAMES } from './ui/LogTable.js'
import { EMPTY_FILTER_INPUTS, Rail, type FilterInputs, type ScanStatus } from './ui/Rail.js'
import { canPickDirectory, listSource, pickDirectory, sourceLabel, toLogFileRefs, type LogSource } from './ui/sources.js'

/** Upstream `initial_load()` alerts this when `showDirectoryPicker` is missing; shown in the page instead. */
const NO_DIRECTORY_PICKER = 'This browser does not support directory opening.'

const SKIP_REASONS: Readonly<Record<SkipReason, string>> = {
  'parse-error': 'could not be parsed',
  'not-a-log': 'is not an ArduPilot log',
  unreadable: 'could not be read'
}

/** Vehicle filter chips in a fixed order: known vehicles, then unknown. */
const VEHICLE_ORDER: readonly VehicleFilterKey[] = [...(Object.keys(VEHICLE_NAMES) as VehicleType[]), 'unknown']

function toLogFilter(inputs: FilterInputs): LogFilter {
  return {
    text: inputs.text,
    hiddenVehicles: inputs.hiddenVehicles,
    warningsOnly: inputs.warningsOnly,
    flownOnly: inputs.flownOnly,
    from: parseDateInput(inputs.from),
    to: parseDateInput(inputs.to, true)
  }
}

export function App() {
  // ----- Scan -----
  const [source, setSource] = useState<LogSource | null>(null)
  const [logs, setLogs] = useState<readonly ScannedLog<File>[]>([])
  const [skipped, setSkipped] = useState<readonly SkippedFile[]>([])
  const [status, setStatus] = useState<ScanStatus>({ kind: 'idle' })
  const [error, setError] = useState<string | null>(null)
  /** Incremented to cancel the running scan when a new one starts or the user stops it. */
  const scanId = useRef(0)

  // ----- View -----
  const [filterInputs, setFilterInputs] = useState<FilterInputs>(EMPTY_FILTER_INPUTS)
  const [ignored, setIgnored] = useState<ReadonlySet<ParamIgnoreKey>>(new Set(ALL_PARAM_IGNORE_KEYS))
  /** Each board's table keeps its own sort, as upstream's separate Tabulator tables do. */
  const [sorts, setSorts] = useState<ReadonlyMap<string, BoardSort>>(new Map())

  const scan = async (next: LogSource) => {
    const id = ++scanId.current
    const active = () => scanId.current === id
    setSource(next)
    setLogs([])
    setSkipped([])
    setSorts(new Map())
    setError(null)
    setStatus({ kind: 'listing' })
    document.title = `Logs in: ${sourceLabel(next)}`

    let files
    try {
      files = await listSource(next)
    } catch (e) {
      if (!active()) return
      setError(`Could not list the logs in ${sourceLabel(next)}: ${e instanceof Error ? e.message : String(e)}. Choose it again.`)
      setStatus({ kind: 'idle' })
      return
    }

    const found: ScannedLog<File>[] = []
    const failed: SkippedFile[] = []
    for await (const event of scanLogs(toLogFileRefs(files))) {
      if (!active()) return
      switch (event.kind) {
        case 'start':
          setStatus({ kind: 'scanning', done: 0, total: event.total })
          break
        case 'loaded':
          found.push(event.log)
          setLogs([...found])
          setStatus({ kind: 'scanning', done: event.done, total: event.total })
          break
        case 'skipped':
          failed.push(event.skipped)
          setSkipped([...failed])
          setStatus({ kind: 'scanning', done: event.done, total: event.total })
          break
      }
    }
    if (active()) setStatus({ kind: 'idle' })
  }

  const stop = () => {
    scanId.current++
    setStatus({ kind: 'idle' })
  }

  // ----- Derived -----
  const filter = useMemo(() => toLogFilter(filterInputs), [filterInputs])
  const tables = useMemo(() => buildTables(logs, { filter, sorts, ignored }), [logs, filter, sorts, ignored])
  const vehicles = useMemo(() => {
    const present = new Set(logs.map((l) => vehicleKey(l.summary)))
    return VEHICLE_ORDER.filter((v) => present.has(v))
  }, [logs])
  const boards = useMemo(() => groupByBoard(logs).length, [logs])
  const shownCount = tables.reduce((n, t) => n + t.rows.length, 0)

  const sortBoard = (board: string, key: SortKey) => {
    const displayed = tables.find((t) => t.board === board)?.sorted ?? []
    setSorts((current) => new Map(current).set(board, nextSort(current.get(board) ?? INITIAL_SORT, key, displayed)))
  }

  /** The diffs are recomputed in display order from `ignored` (see `buildTables`). */
  const changeIgnored = (next: ReadonlySet<ParamIgnoreKey>) => {
    setIgnored(next)
  }

  const facts: LogFact[] | null = source
    ? [
        { label: 'Searched', value: sourceLabel(source) },
        { label: 'Logs', value: shownCount === logs.length ? logs.length : `${shownCount} of ${logs.length}` },
        ...(skipped.length > 0 ? [{ label: 'Skipped', value: skipped.length }] : []),
        { label: 'Boards', value: boards }
      ]
    : null

  const scanning = status.kind !== 'idle'

  return (
    <ToolPage
      title="Log Finder"
      readmeUrl="https://github.com/ArduPilot/WebTools/blob/main/LogFinder/Readme.md"
      intro={
        <>
          Search a folder of <code>.bin</code> logs and list them by flight controller with date, firmware, flight time, distance
          and parameter changes between flights. Open any log in another tool from its row.
        </>
      }
      rail={
        <Rail
          facts={facts}
          status={status}
          canReload={source !== null}
          onSource={(s) => void scan(s)}
          onPickDirectory={() =>
            void pickDirectory().then((s) => {
              if (s) void scan(s)
            })
          }
          onReload={() => {
            if (source) void scan(source)
          }}
          onStop={stop}
          vehicles={vehicles}
          filter={filterInputs}
          onFilterChange={setFilterInputs}
          ignored={ignored}
          onIgnoredChange={changeIgnored}
        />
      }
    >
      <ErrorBanner message={error} />

      <ErrorBanner message={canPickDirectory() ? null : NO_DIRECTORY_PICKER} />

      {tables.map((table) => (
        <Section
          key={table.board}
          title={table.board}
          help={table.commonPath ? <code>{table.commonPath}</code> : undefined}
          tools={
            <span className="apwt-badge apwt-badge--gray">
              {table.rows.length === table.sorted.length ? table.sorted.length : `${table.rows.length} of ${table.sorted.length}`}{' '}
              {table.sorted.length === 1 ? 'log' : 'logs'}
            </span>
          }
        >
          <LogTable table={table} sort={sorts.get(table.board) ?? INITIAL_SORT} onSort={(key) => sortBoard(table.board, key)} />
        </Section>
      ))}

      {tables.length === 0 && (
        <Section title="Logs" help="Logs are grouped by flight controller, oldest first. Click a column heading to sort.">
          <div className="apwt-empty">
            {logs.length > 0
              ? 'No logs match the filters. Clear them in the panel to see every log.'
              : scanning
                ? 'Searching for logs…'
                : source
                  ? 'No ArduPilot logs were found. Choose another folder.'
                  : 'Choose a folder or drop logs on the panel to start.'}
          </div>
        </Section>
      )}

      {skipped.length > 0 && (
        <Section title="Skipped files" help="These .bin files were left out of the tables.">
          <details>
            <summary style={{ cursor: 'pointer' }}>
              {skipped.length} {skipped.length === 1 ? 'file' : 'files'}
            </summary>
            <ul style={{ fontFamily: 'var(--mono)', fontSize: 13 }}>
              {skipped.map((s) => (
                <li key={s.relativePath}>
                  {s.relativePath} {SKIP_REASONS[s.reason]}
                </li>
              ))}
            </ul>
          </details>
        </Section>
      )}
    </ToolPage>
  )
}
