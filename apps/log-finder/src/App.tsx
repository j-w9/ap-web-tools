import { useMemo, useRef, useState } from 'react'
import { DataflashLog, type VehicleType } from '@apwt/dataflash'
import { PlotlyChart } from '@apwt/plot'
import { ErrorBanner, Section, ToolPage, useLoading, type LogFact } from '@apwt/tool-shell'
import { formatFlightTime, formatSize } from './analysis/format.js'
import { ALL_PARAM_IGNORE_KEYS, type ParamIgnoreKey } from './analysis/param-diff.js'
import { scanLogs, type SkipReason, type SkippedFile } from './analysis/scan.js'
import { flightPath, type FlightPath } from './analysis/summary.js'
import {
  DEFAULT_SORT,
  buildTables,
  groupByBoard,
  nextSort,
  parseDateInput,
  vehicleKey,
  type LogFilter,
  type ScannedLog,
  type SortState,
  type VehicleFilterKey
} from './analysis/table.js'
import { LogTable, VEHICLE_NAMES } from './ui/LogTable.js'
import { EMPTY_FILTER_INPUTS, Rail, type FilterInputs, type ScanStatus } from './ui/Rail.js'
import { listSource, pickDirectory, sourceLabel, toLogFileRefs, type LogSource } from './ui/sources.js'
import { FLIGHT_PATH_LAYOUT, flightPathTraces } from './ui/traces.js'

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
  const { run } = useLoading()

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
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT)
  const [path, setPath] = useState<{ log: ScannedLog<File>; path: FlightPath } | null>(null)
  const pathSection = useRef<HTMLDivElement>(null)

  const scan = async (next: LogSource) => {
    const id = ++scanId.current
    const active = () => scanId.current === id
    setSource(next)
    setLogs([])
    setSkipped([])
    setPath(null)
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

  const showPath = (log: ScannedLog<File>) =>
    void run(async () => {
      try {
        const found = flightPath(DataflashLog.parse(await log.file.arrayBuffer()))
        setPath(found ? { log, path: found } : null)
        requestAnimationFrame(() => pathSection.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
      } catch (e) {
        setError(`Could not read ${log.name} again: ${e instanceof Error ? e.message : String(e)}. Reload the folder.`)
      }
    }, 'Reading flight path')

  // ----- Derived -----
  const filter = useMemo(() => toLogFilter(filterInputs), [filterInputs])
  const tables = useMemo(() => buildTables(logs, { filter, sort, ignored }), [logs, filter, sort, ignored])
  const vehicles = useMemo(() => {
    const present = new Set(logs.map((l) => vehicleKey(l.summary)))
    return VEHICLE_ORDER.filter((v) => present.has(v))
  }, [logs])
  const boards = useMemo(() => groupByBoard(logs).length, [logs])
  const shownCount = tables.reduce((n, t) => n + t.rows.length, 0)
  const pathTraces = useMemo(() => (path ? flightPathTraces(path.path) : []), [path])

  const facts: LogFact[] | null = source
    ? [
        { label: 'Searched', value: sourceLabel(source) },
        { label: 'Logs', value: shownCount === logs.length ? logs.length : `${shownCount} of ${logs.length}` },
        ...(skipped.length > 0 ? [{ label: 'Skipped', value: skipped.length }] : []),
        { label: 'Boards', value: boards },
        { label: 'Total size', value: formatSize(logs.reduce((n, l) => n + l.summary.sizeBytes, 0)) },
        { label: 'Flight time', value: formatFlightTime(logs.reduce((n, l) => n + (l.summary.flightTimeS ?? 0), 0)) }
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
          onIgnoredChange={setIgnored}
        />
      }
    >
      <ErrorBanner message={error} />

      {path && (
        <div ref={pathSection}>
          <Section
            title={`Flight path: ${path.log.name}`}
            help="Position track from POS messages, in metres from the first fix. Green is the start, red the end."
            tools={
              <button type="button" className="apwt-btn apwt-btn--ghost" onClick={() => setPath(null)}>
                Close
              </button>
            }
          >
            <PlotlyChart className="apwt-plot" data={pathTraces} layout={FLIGHT_PATH_LAYOUT} />
          </Section>
        </div>
      )}

      {tables.map((table) => (
        <Section
          key={table.board}
          title={table.board}
          help={table.commonPath ? <code>{table.commonPath}</code> : undefined}
          tools={
            <span className="apwt-badge apwt-badge--gray">
              {table.rows.length} {table.rows.length === 1 ? 'log' : 'logs'}
            </span>
          }
        >
          <LogTable table={table} sort={sort} onSort={(key) => setSort((s) => nextSort(s, key))} onShowPath={showPath} />
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
