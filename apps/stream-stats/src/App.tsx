import { useCallback, useEffect, useMemo, useState } from 'react'
import { PlotlyChart, linkAutorangeReset, linkAxisRanges, type PlotlyHTMLElement } from '@apwt/plot'
import { ErrorBanner, OpenInButton, Section, ToolPage, useLoading, useLogFile, type LogFact } from '@apwt/tool-shell'
import { loadLog, logFormat, type LoadedLog } from './analysis/load.js'
import {
  EMPTY_SELECTION,
  streamStats,
  type ComponentKey,
  type MessageKey,
  type RateUnit,
  type StreamSource,
  type TlogSelection
} from './analysis/stats.js'
import { MavlinkSystems } from './ui/MavlinkSystems.js'
import { Rail } from './ui/Rail.js'
import { COMPOSITION_LAYOUT, compositionTraces, rateLayout, rateTraces, totalTraces } from './ui/traces.js'

type PlotName = 'total' | 'rates'

const FORMAT_NAMES = { bin: 'DataFlash log', tlog: 'Telemetry log' } as const satisfies Record<LoadedLog['kind'], string>

/** Copy of an exclusion set with `value` included (removed from the set) or excluded (added). */
function withIncluded<T>(excluded: ReadonlySet<T>, value: T, include: boolean): ReadonlySet<T> {
  const next = new Set(excluded)
  if (include) next.delete(value)
  else next.add(value)
  return next
}

/** The window size typed by the user, or `null` if it is not a positive number. */
function validWidth(text: string): number | null {
  const width = Number.parseFloat(text)
  return Number.isFinite(width) && width > 0 ? width : null
}

function logFacts(log: LoadedLog, fileName: string | null, byteLength: number): LogFact[] {
  const common: LogFact[] = [
    { label: 'File', value: fileName ?? 'From another tool' },
    { label: 'Format', value: FORMAT_NAMES[log.kind] },
    { label: 'Size', value: `${byteLength.toLocaleString()} bytes` }
  ]
  switch (log.kind) {
    case 'tlog': {
      const { tlog } = log
      return [
        ...common,
        ...(tlog.startTime ? [{ label: 'Start', value: tlog.startTime.toLocaleString() }] : []),
        { label: 'Duration', value: `${tlog.duration.toFixed(0)} s` },
        { label: 'Components', value: tlog.components.length }
      ]
    }
    case 'bin':
      return [...common, { label: 'Message types', value: log.log.messages.length }]
  }
}

export function App() {
  const { run } = useLoading()

  const [loaded, setLoaded] = useState<{ log: LoadedLog; fileName: string | null; byteLength: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selection, setSelection] = useState<TlogSelection>(EMPTY_SELECTION)
  const [unit, setUnit] = useState<RateUnit>('bits')
  const [windowText, setWindowText] = useState('10')

  /** Last valid window size; kept while the user types an invalid one. */
  const [binWidth, setBinWidth] = useState(10)
  const windowValid = validWidth(windowText) !== null
  const changeWindowText = (text: string) => {
    setWindowText(text)
    const width = validWidth(text)
    if (width !== null) setBinWidth(width)
  }

  const { file, openFile } = useLogFile(async (buffer, name) => {
    await run(() => {
      setLoaded(null)
      setSelection(EMPTY_SELECTION)
      const format = logFormat(name)
      if (format === null) {
        setError(`${name ?? 'This file'} is not a .bin or .tlog file. Choose a DataFlash log or a MAVLink telemetry log.`)
        return
      }
      try {
        const log = loadLog(buffer, format)
        setError(null)
        setLoaded({ log, fileName: name, byteLength: buffer.byteLength })
        document.title = name ? `Stream Stats: ${name}` : 'Stream Stats'
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    }, 'Reading log')
  })

  const log = loaded?.log ?? null
  const source: StreamSource | null = useMemo(() => {
    if (log === null) return null
    switch (log.kind) {
      case 'tlog':
        return { kind: 'tlog', tlog: log.tlog, selection }
      case 'bin':
        return { kind: 'bin', log: log.log }
    }
  }, [log, selection])
  const stats = useMemo(() => (source ? streamStats(source, { unit, binWidth }) : null), [source, unit, binWidth])

  const layout = useMemo(() => rateLayout(unit), [unit])
  const rates = useMemo(() => (stats && log ? rateTraces(stats, log.kind, unit) : []), [stats, log, unit])
  const total = useMemo(() => (stats ? totalTraces(stats, unit) : []), [stats, unit])
  const composition = useMemo(() => (stats ? compositionTraces(stats, unit) : []), [stats, unit])

  // Zooming either rate plot's time axis zooms the other; double-click resets both.
  const [plots, setPlots] = useState<Partial<Record<PlotName, PlotlyHTMLElement>>>({})
  const ready = useCallback(
    (name: PlotName) => (el: PlotlyHTMLElement) => setPlots((p) => (p[name] === el ? p : { ...p, [name]: el })),
    []
  )
  useEffect(() => {
    if (!plots.total || !plots.rates) return
    const unlink = [
      linkAxisRanges([
        { element: plots.total, axis: 'x' },
        { element: plots.rates, axis: 'x' }
      ]),
      linkAutorangeReset([plots.total, plots.rates])
    ]
    return () => unlink.forEach((u) => u())
  }, [plots])

  const facts = loaded ? logFacts(loaded.log, loaded.fileName, loaded.byteLength) : null
  const empty = <div className="apwt-empty">Open a log to see this plot</div>
  const noStreams = <div className="apwt-empty">No streams are included. Include a component or message above.</div>
  const hasRates = stats !== null && stats.rates.length > 0

  return (
    <ToolPage
      title="Stream Stats"
      readmeUrl="https://github.com/ArduPilot/WebTools/blob/main/StreamStats/Readme.md"
      intro={
        <>
          Message counts, rates and bandwidth from a MAVLink telemetry log (<code>.tlog</code>) or a DataFlash log (
          <code>.bin</code>), per message and per system and component, over time.
        </>
      }
      actions={
        <OpenInButton file={log?.kind === 'bin' ? file : null} messageTypes={log?.kind === 'bin' ? log.log.messageTypes : null} />
      }
      rail={
        <Rail
          facts={facts}
          onFile={openFile}
          unit={unit}
          onUnitChange={setUnit}
          windowText={windowText}
          onWindowTextChange={changeWindowText}
          windowValid={windowValid}
        />
      }
    >
      <ErrorBanner message={error} />

      {log?.kind === 'tlog' && (
        <Section
          title="MAVLink"
          help="Each system and component in the log, with link health. Switch components or messages off to leave them out of the plots."
        >
          <MavlinkSystems
            tlog={log.tlog}
            selection={selection}
            onToggleComponent={(key: ComponentKey, on) =>
              setSelection((s) => ({ ...s, excludedComponents: withIncluded(s.excludedComponents, key, on) }))
            }
            onToggleMessage={(key: MessageKey, on) =>
              setSelection((s) => ({ ...s, excludedMessages: withIncluded(s.excludedMessages, key, on) }))
            }
          />
        </Section>
      )}

      <Section title="Total rate" help="Combined rate of every included stream, averaged over the window size.">
        {!stats ? (
          empty
        ) : hasRates ? (
          <PlotlyChart className="apwt-plot" data={total} layout={layout} onReady={ready('total')} />
        ) : (
          noStreams
        )}
      </Section>

      <Section title="Message rates" help="Rate of each message stream. Hover a line to see which message it is.">
        {!stats ? (
          empty
        ) : hasRates ? (
          <PlotlyChart className="apwt-plot" data={rates} layout={layout} onReady={ready('rates')} />
        ) : (
          noStreams
        )}
      </Section>

      <Section
        title="Composition"
        help={
          log?.kind === 'tlog'
            ? 'Share of each included stream, labelled (system, component) message.'
            : 'Share of each message type in the log.'
        }
      >
        {loaded?.log.kind === 'bin' && unit === 'bits' && (
          <p className="apwt-section__help">Total size: {loaded.byteLength.toLocaleString()} bytes</p>
        )}
        {!stats ? (
          empty
        ) : stats.composition.length > 0 ? (
          <PlotlyChart className="apwt-plot" style={{ height: 720 }} data={composition} layout={COMPOSITION_LAYOUT} />
        ) : (
          noStreams
        )}
      </Section>
    </ToolPage>
  )
}
