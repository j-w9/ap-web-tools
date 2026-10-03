import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  PlotlyChart,
  linkAutorangeReset,
  linkAxisRanges,
  relayoutRange,
  type PlotRelayoutEvent,
  type PlotlyHTMLElement
} from '@apwt/plot'
import { fftAmplitudeScale, fftFrequencyScale, type AmplitudeKind } from '@apwt/signal'
import {
  ErrorBanner,
  OpenInButton,
  Section,
  ToolPage,
  useLoading,
  useLogFile,
  type LogFact
} from '@apwt/tool-shell'
import { computeAxisFft } from './analysis/batch-fft.js'
import { availableKeys, type LoadedLog, type PidAxisData, type PidAxisFft } from './analysis/data.js'
import { FULL_PID_ONLY_KEYS, type FftKey } from './analysis/keys.js'
import { loadLog } from './analysis/load.js'
import { stepResponses } from './analysis/step-response.js'
import { specKey, specLabel } from './analysis/vehicle.js'
import { ParamSetTable } from './ui/ParamSetTable.js'
import { Rail } from './ui/Rail.js'
import {
  ScaleChips,
  SignalChips,
  SpectrogramChips,
  type FrequencyScaleSettings
} from './ui/SpectrumControls.js'
import {
  flightDataLayout,
  flightDataTraces,
  spectrogramLayout,
  spectrogramTrace,
  spectrumLayout,
  spectrumTraces,
  stepLayout,
  stepTraces,
  timeDomainLayout,
  timeInputTraces,
  timeOutputTraces
} from './ui/traces.js'

const DEFAULT_SHOWN: readonly FftKey[] = ['Tar', 'Act', 'Out']
type PlotName = 'inputs' | 'outputs' | 'fft' | 'step' | 'spec'
type FftByAxis = Readonly<Record<string, PidAxisFft | null>>

const VEHICLE_NAMES: Readonly<Record<string, string>> = {
  copter: 'Copter',
  plane: 'Plane',
  rover: 'Rover',
  sub: 'Sub',
  tracker: 'Tracker',
  blimp: 'Blimp'
}

export function App() {
  const { run } = useLoading()

  // ----- Loaded log and analysis inputs -----
  const [log, setLog] = useState<LoadedLog | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [windowSize, setWindowSize] = useState(512)
  /** Editable analysis window; applied to the plots on Recalculate. */
  const [timeRange, setTimeRange] = useState<[number, number]>([0, 0])
  const [applied, setApplied] = useState<{ range: [number, number]; fft: FftByAxis } | null>(null)
  const [dirty, setDirty] = useState(false)

  // ----- Display settings -----
  const [amplitudeKind, setAmplitudeKind] = useState<AmplitudeKind>('dB')
  const [frequencySettings, setFrequencySettings] = useState<FrequencyScaleSettings>({ log: false, rpm: false })
  const [shownKeys, setShownKeys] = useState<ReadonlySet<FftKey>>(new Set(DEFAULT_SHOWN))
  const [shownSets, setShownSets] = useState<readonly boolean[]>([])
  const [spectrogramKey, setSpectrogramKey] = useState<FftKey>('Out')

  const amplitude = useMemo(
    () => fftAmplitudeScale({ dB: amplitudeKind === 'dB', psd: amplitudeKind === 'PSD' }),
    [amplitudeKind]
  )
  const frequency = useMemo(() => fftFrequencyScale(frequencySettings), [frequencySettings])

  const axis: PidAxisData | null = useMemo(
    () => log?.axes.find((a) => specKey(a.spec) === selectedKey) ?? null,
    [log, selectedKey]
  )
  const axisFft = (selectedKey !== null && applied?.fft[selectedKey]) || null
  const keysWithData = useMemo(() => (axis ? availableKeys(axis) : new Set<FftKey>()), [axis])
  const enabledKeys = useMemo(() => {
    const full = axis ? axis.spec.id[0] !== 'RATE' : false
    return new Set([...keysWithData].filter((k) => full || !FULL_PID_ONLY_KEYS.includes(k)))
  }, [axis, keysWithData])

  // ----- Calculation -----
  const calculate = useCallback((target: LoadedLog, size: number, range: [number, number]) => {
    const fft: Record<string, PidAxisFft | null> = {}
    for (const a of target.axes) fft[specKey(a.spec)] = computeAxisFft(a.sets, size)
    setApplied({ range, fft })
    setDirty(false)
  }, [])

  const { file, openFile } = useLogFile(async (buffer, name) => {
    await run(() => {
      try {
        const loaded = loadLog(buffer)
        const range: [number, number] = [Math.floor(loaded.startTime), Math.ceil(loaded.endTime)]
        setError(null)
        setLog(loaded)
        setFileName(name)
        setTimeRange(range)
        const first = loaded.axes[0]
        setSelectedKey(first ? specKey(first.spec) : null)
        setShownKeys(new Set(DEFAULT_SHOWN))
        document.title = name ? `PID Review: ${name}` : 'PID Review'
        calculate(loaded, windowSize, range)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    }, 'Reading log')
  })

  // When the controller changes, reset per-set visibility and drop keys it lacks.
  useEffect(() => {
    if (!axis) return
    setShownSets(axis.sets.map((_, i) => axisFft?.sets[i] != null))
    setShownKeys((prev) => new Set([...prev].filter((k) => enabledKeys.has(k))))
    setSpectrogramKey((k) => (enabledKeys.has(k) ? k : 'Out'))
  }, [axis, axisFft, enabledKeys])

  const steps = useMemo(
    () => (axis && axisFft && applied ? stepResponses(axis.sets, axisFft.axis, applied.range) : null),
    [axis, axisFft, applied]
  )

  // ----- Plot data -----
  const appliedRange = applied?.range ?? null
  const flightTraces = useMemo(() => flightDataTraces(log?.flight ?? null), [log])
  const flightLayout = useMemo(() => flightDataLayout(log ? timeRange : null), [log, timeRange])
  const inputTraces = useMemo(() => timeInputTraces(axis), [axis])
  const outputTraces = useMemo(() => timeOutputTraces(axis), [axis])
  const inputLayout = useMemo(
    () => timeDomainLayout(axis?.spec.units ?? 'deg / s', appliedRange, axis, log),
    [axis, appliedRange, log]
  )
  const outputLayout = useMemo(() => timeDomainLayout('Output', appliedRange, axis, log), [axis, appliedRange, log])
  const fftTraces = useMemo(
    () =>
      applied ? spectrumTraces(axisFft, { amplitude, frequency, range: applied.range, shownKeys, shownSets }) : [],
    [applied, axisFft, amplitude, frequency, shownKeys, shownSets]
  )
  const fftLayout = useMemo(() => spectrumLayout(amplitude, frequency), [amplitude, frequency])
  const stepData = useMemo(() => stepTraces(steps, shownSets), [steps, shownSets])
  const stepLayoutMemo = useMemo(stepLayout, [])
  const specTrace = useMemo(
    () => spectrogramTrace(axisFft, spectrogramKey, amplitude, frequency),
    [axisFft, spectrogramKey, amplitude, frequency]
  )
  const specLayout = useMemo(() => spectrogramLayout(frequency, appliedRange), [frequency, appliedRange])

  // ----- Plot linking: zooming one time or frequency axis zooms its partners -----
  const plots = useRef<Partial<Record<PlotName, PlotlyHTMLElement>>>({})
  const [readyCount, setReadyCount] = useState(0)
  const ready = (name: PlotName) => (el: PlotlyHTMLElement) => {
    plots.current[name] = el
    setReadyCount((n) => n + 1)
  }
  useEffect(() => {
    const p = plots.current
    if (!p.inputs || !p.outputs || !p.fft || !p.step || !p.spec) return
    const unlink = [
      linkAxisRanges([
        { element: p.fft, axis: 'x' },
        { element: p.spec, axis: 'y' }
      ]),
      linkAxisRanges([
        { element: p.inputs, axis: 'x' },
        { element: p.outputs, axis: 'x' },
        { element: p.spec, axis: 'x' }
      ]),
      linkAutorangeReset([p.inputs, p.outputs, p.fft, p.step, p.spec])
    ]
    return () => unlink.forEach((u) => u())
  }, [readyCount])

  const onFlightRelayout = useCallback(
    (event: PlotRelayoutEvent) => {
      if (!log) return
      const r = relayoutRange(event)
      if (r === undefined) return
      setTimeRange(
        r === 'autorange'
          ? [Math.floor(log.startTime), Math.ceil(log.endTime)]
          : [Math.floor(r[0]), Math.ceil(r[1])]
      )
      setDirty(true)
    },
    [log]
  )

  const facts: LogFact[] | null = log
    ? [
        { label: 'File', value: fileName ?? 'From another tool' },
        { label: 'Vehicle', value: VEHICLE_NAMES[log.vehicle] ?? log.vehicle },
        ...(log.firmware ? [{ label: 'Firmware', value: log.firmware }] : []),
        { label: 'Duration', value: `${(log.endTime - log.startTime).toFixed(0)} s` },
        ...(axisFft
          ? [
              { label: 'Logging rate', value: `${axisFft.axis.averageSampleRate.toFixed(0)} Hz` },
              {
                label: 'Resolution',
                value: `${(axisFft.axis.averageSampleRate / axisFft.axis.windowSize).toFixed(2)} Hz`
              }
            ]
          : [])
      ]
    : null

  const validSets = axis ? axis.sets.map((_, i) => axisFft?.sets[i] != null) : []
  const empty = <div className="apwt-empty">Open a log to see this plot</div>

  return (
    <ToolPage
      title="PID Review"
      readmeUrl="https://github.com/ArduPilot/WebTools/blob/main/PIDReview/Readme.md"
      intro={
        <>
          Time and frequency content of the rate controller target, response and output from a <code>.bin</code> log.
          Set the <b>PID</b> bit of <code>LOG_BITMASK</code> before flying to record every PID term; the default{' '}
          <code>RATE</code> message also works.
        </>
      }
      actions={<OpenInButton file={file} messageTypes={log?.messageTypes ?? null} />}
      rail={
        <Rail
          facts={facts}
          onFile={openFile}
          windowSize={windowSize}
          onWindowSizeChange={(s) => {
            setWindowSize(s)
            setDirty(true)
          }}
          timeRange={timeRange}
          timeLimits={log ? [Math.floor(log.startTime), Math.ceil(log.endTime)] : null}
          onTimeRangeChange={(r) => {
            setTimeRange(r)
            setDirty(true)
          }}
          availableSpecs={log?.axes.map((a) => a.spec) ?? []}
          selectedSpecKey={selectedKey}
          onSelectSpec={setSelectedKey}
          calculateEnabled={log != null && dirty}
          onCalculate={() => {
            if (log) void run(() => calculate(log, windowSize, timeRange), 'Calculating')
          }}
        />
      }
    >
      <ErrorBanner message={error} />

      <Section title="Flight data" help="Zoom into part of the flight to set the analysis window, then recalculate.">
        <PlotlyChart className="apwt-plot apwt-plot--short" data={flightTraces} layout={flightLayout} onRelayout={onFlightRelayout} />
      </Section>

      <Section
        title={axis ? `Time domain: ${specLabel(axis.spec)}` : 'Time domain'}
        help="Controller inputs and outputs over time. Look for tracking error, overshoot and oscillation."
      >
        <PlotlyChart className="apwt-plot" data={inputTraces} layout={inputLayout} onReady={ready('inputs')} />
        <PlotlyChart className="apwt-plot" data={outputTraces} layout={outputLayout} onReady={ready('outputs')} />
      </Section>

      <Section
        title="Frequency domain"
        help="Mean spectrum of each signal over the analysis window. Look for resonances and noise the D term amplifies."
        tools={<ScaleChips amplitude={amplitudeKind} onAmplitudeChange={setAmplitudeKind} frequency={frequencySettings} onFrequencyChange={setFrequencySettings} />}
      >
        <SignalChips enabled={enabledKeys} shown={shownKeys} onShownChange={setShownKeys} />
        {axis && (
          <ParamSetTable paramSets={axis.paramSets} valid={validSets} shown={shownSets} onShownChange={setShownSets} />
        )}
        {log ? <PlotlyChart className="apwt-plot" data={fftTraces} layout={fftLayout} onReady={ready('fft')} /> : empty}
      </Section>

      <Section
        title="Step response"
        help="Estimated closed-loop response to a unit step in target rate. Look at rise time, overshoot and settling."
      >
        {log ? <PlotlyChart className="apwt-plot" data={stepData} layout={stepLayoutMemo} onReady={ready('step')} /> : empty}
      </Section>

      <Section
        title="Spectrogram"
        help="How each signal's frequency content changes through the flight."
        tools={<SpectrogramChips enabled={enabledKeys} selected={spectrogramKey} onSelect={setSpectrogramKey} />}
      >
        {log ? <PlotlyChart className="apwt-plot" data={specTrace} layout={specLayout} onReady={ready('spec')} /> : empty}
      </Section>
    </ToolPage>
  )
}
