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
  /** Window size as committed (upstream reads it with `parseFloat` on the input's change event). */
  const [windowText, setWindowText] = useState('10')
  const binWidth = Number.parseFloat(windowText)

  const { file, openFile } = useLogFile(async (buffer, name) => {
    await run(() => {
      setLoaded(null)
      setSelection(EMPTY_SELECTION)
      const format = logFormat(name)
      // Upstream resets the page and ignores a file that is neither .bin nor .tlog.
      setError(null)
      if (format === null) return
      try {
        const log = loadLog(buffer, format)
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
  // A window of 0 or an empty one makes upstream throw while binning; the port shows that error
  // instead of plots.
  const computed = useMemo(() => {
    if (source === null) return { stats: null, error: null }
    try {
      return { stats: streamStats(source, { unit, binWidth }), error: null }
    } catch (e) {
      return { stats: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [source, unit, binWidth])
  const stats = computed.stats

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
          defaultWindowText={windowText}
          onWindowCommit={setWindowText}
        />
      }
    >
      <ErrorBanner message={error ?? computed.error} />

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
        {!stats ? empty : <PlotlyChart className="apwt-plot" data={total} layout={layout} onReady={ready('total')} />}
      </Section>

      <Section title="Message rates" help="Rate of each message stream. Hover a line to see which message it is.">
        {!stats ? empty : <PlotlyChart className="apwt-plot" data={rates} layout={layout} onReady={ready('rates')} />}
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
        {!stats ? empty : <PlotlyChart className="apwt-plot ss-pie" data={composition} layout={COMPOSITION_LAYOUT} />}
      </Section>
    </ToolPage>
  )
}
