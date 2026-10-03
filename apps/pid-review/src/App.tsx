import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  PlotlyChart,
  linkAutorangeReset,
  linkAxisRanges,
  relayoutRange,
  type PlotRelayoutEvent,
  type PlotlyHTMLElement
} from '@apwt/plot'
import { fftAmplitudeScale, fftFrequencyScale, type AmplitudeKind } from '@apwt/signal'
import { ErrorBanner, OpenInButton, Section, ToolPage, useLoading, useLogFile, type LogFact } from '@apwt/tool-shell'
import { computeAxisFft } from './analysis/batch-fft.js'
import { availableKeys, type LoadedLog, type PidAxisData, type PidAxisFft } from './analysis/data.js'
import { FULL_PID_ONLY_KEYS, type FftKey } from './analysis/keys.js'
import { loadLog } from './analysis/load.js'
import { stepResponses } from './analysis/step-response.js'
import { specLabel, type SpecKey } from './analysis/vehicle.js'
import type { VehicleType } from '@apwt/dataflash'
import { ParamSetTable } from './ui/ParamSetTable.js'
import { Rail } from './ui/Rail.js'
import { ScaleChips, SignalChips, SpectrogramChips, type FrequencyScaleSettings } from './ui/SpectrumControls.js'
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
const STEP_LAYOUT = stepLayout()
type PlotName = 'inputs' | 'outputs' | 'fft' | 'step' | 'spec'
type FftByAxis = ReadonlyMap<SpecKey, PidAxisFft | null>

const VEHICLE_NAMES: Readonly<Record<VehicleType, string>> = {
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
  const [selectedKey, setSelectedKey] = useState<SpecKey | null>(null)
  const [windowSize, setWindowSize] = useState(512)
  /** Editable analysis window; applied to the plots on Recalculate. */
  const [timeRange, setTimeRange] = useState<[number, number]>([0, 0])
  const [applied, setApplied] = useState<{ range: [number, number]; fft: FftByAxis } | null>(null)
  const [dirty, setDirty] = useState(false)

  // ----- Display settings -----
  const [amplitudeKind, setAmplitudeKind] = useState<AmplitudeKind>('dB')
  const [frequencySettings, setFrequencySettings] = useState<FrequencyScaleSettings>({ log: false, rpm: false })
  const [chosenKeys, setShownKeys] = useState<ReadonlySet<FftKey>>(new Set(DEFAULT_SHOWN))
  /** Per-controller test visibility the user has chosen; unset controllers show every valid test. */
  const [chosenSets, setChosenSets] = useState<ReadonlyMap<SpecKey, readonly boolean[]>>(new Map())
  const [chosenSpectrogramKey, setSpectrogramKey] = useState<FftKey>('Out')

  const amplitude = useMemo(
    () => fftAmplitudeScale({ dB: amplitudeKind === 'dB', psd: amplitudeKind === 'PSD' }),
    [amplitudeKind]
  )
  const frequency = useMemo(() => fftFrequencyScale(frequencySettings), [frequencySettings])

  const axis: PidAxisData | null = useMemo(() => log?.axes.find((a) => a.spec.key === selectedKey) ?? null, [log, selectedKey])
  const axisFft = (selectedKey !== null && applied?.fft.get(selectedKey)) || null
  const keysWithData = useMemo(() => (axis ? availableKeys(axis) : new Set<FftKey>()), [axis])
  const enabledKeys = useMemo(() => {
    const full = axis ? axis.spec.source.message !== 'RATE' : false
    return new Set([...keysWithData].filter((k) => full || !FULL_PID_ONLY_KEYS.includes(k)))
  }, [axis, keysWithData])

  // Effective selections: the user's choices, limited to what the current controller has.
  const shownKeys = useMemo(() => new Set([...chosenKeys].filter((k) => enabledKeys.has(k))), [chosenKeys, enabledKeys])
  const spectrogramKey: FftKey = enabledKeys.has(chosenSpectrogramKey) ? chosenSpectrogramKey : 'Out'
  const shownSets = useMemo(
    () =>
      (selectedKey !== null ? chosenSets.get(selectedKey) : undefined) ??
      axis?.sets.map((_, i) => axisFft?.sets[i] != null) ??
      [],
    [chosenSets, selectedKey, axis, axisFft]
  )
  const setShownSets = (sets: readonly boolean[]) => {
    if (selectedKey !== null) setChosenSets((m) => new Map(m).set(selectedKey, sets))
  }

  // ----- Calculation -----
  const calculate = useCallback((target: LoadedLog, size: number, range: [number, number]) => {
    const fft = new Map(target.axes.map((a) => [a.spec.key, computeAxisFft(a.sets, size)] as const))
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
        setSelectedKey(first ? first.spec.key : null)
        setShownKeys(new Set(DEFAULT_SHOWN))
        setChosenSets(new Map())
        document.title = name ? `PID Review: ${name}` : 'PID Review'
        calculate(loaded, windowSize, range)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    }, 'Reading log')
  })

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
    () => (applied ? spectrumTraces(axisFft, { amplitude, frequency, range: applied.range, shownKeys, shownSets }) : []),
    [applied, axisFft, amplitude, frequency, shownKeys, shownSets]
  )
  const fftLayout = useMemo(() => spectrumLayout(amplitude, frequency), [amplitude, frequency])
  const stepData = useMemo(() => stepTraces(steps, shownSets), [steps, shownSets])
  const specTrace = useMemo(
    () => spectrogramTrace(axisFft, spectrogramKey, amplitude, frequency),
    [axisFft, spectrogramKey, amplitude, frequency]
  )
  const specLayout = useMemo(() => spectrogramLayout(frequency, appliedRange), [frequency, appliedRange])

  // ----- Plot linking: zooming one time or frequency axis zooms its partners -----
  const [plots, setPlots] = useState<Partial<Record<PlotName, PlotlyHTMLElement>>>({})
  const ready = useCallback(
    (name: PlotName) => (el: PlotlyHTMLElement) => setPlots((p) => (p[name] === el ? p : { ...p, [name]: el })),
    []
  )
  useEffect(() => {
    const p = plots
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
  }, [plots])

  const onFlightRelayout = useCallback(
    (event: PlotRelayoutEvent) => {
      if (!log) return
      const r = relayoutRange(event)
      if (r === undefined) return
      setTimeRange(r === 'autorange' ? [Math.floor(log.startTime), Math.ceil(log.endTime)] : [Math.floor(r[0]), Math.ceil(r[1])])
      setDirty(true)
    },
    [log]
  )

  const facts: LogFact[] | null = log
    ? [
        { label: 'File', value: fileName ?? 'From another tool' },
        { label: 'Vehicle', value: VEHICLE_NAMES[log.vehicle] },
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
          Time and frequency content of the rate controller target, response and output from a <code>.bin</code> log. Set the{' '}
          <b>PID</b> bit of <code>LOG_BITMASK</code> before flying to record every PID term; the default <code>RATE</code> message
          also works.
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
          availableKeys={new Set(log?.axes.map((a) => a.spec.key))}
          selectedKey={selectedKey}
          onSelectKey={setSelectedKey}
          calculateEnabled={log != null && dirty}
          onCalculate={() => {
            if (log) void run(() => calculate(log, windowSize, timeRange), 'Calculating')
          }}
        />
      }
    >
      <ErrorBanner message={error} />

      <Section title="Flight data" help="Zoom into part of the flight to set the analysis window, then recalculate.">
        <PlotlyChart
          className="apwt-plot apwt-plot--short"
          data={flightTraces}
          layout={flightLayout}
          onRelayout={onFlightRelayout}
        />
      </Section>

      <Section
        title={axis ? `Time domain: ${specLabel(axis.spec.key)}` : 'Time domain'}
        help="Controller inputs and outputs over time. Look for tracking error, overshoot and oscillation."
      >
        <PlotlyChart className="apwt-plot" data={inputTraces} layout={inputLayout} onReady={ready('inputs')} />
        <PlotlyChart className="apwt-plot" data={outputTraces} layout={outputLayout} onReady={ready('outputs')} />
      </Section>

      <Section
        title="Frequency domain"
        help="Mean spectrum of each signal over the analysis window. Look for resonances and noise the D term amplifies."
        tools={
          <ScaleChips
            amplitude={amplitudeKind}
            onAmplitudeChange={setAmplitudeKind}
            frequency={frequencySettings}
            onFrequencyChange={setFrequencySettings}
          />
        }
      >
        <SignalChips enabled={enabledKeys} shown={shownKeys} onShownChange={setShownKeys} />
        {axis && <ParamSetTable paramSets={axis.paramSets} valid={validSets} shown={shownSets} onShownChange={setShownSets} />}
        {log ? <PlotlyChart className="apwt-plot" data={fftTraces} layout={fftLayout} onReady={ready('fft')} /> : empty}
      </Section>

      <Section
        title="Step response"
        help="Estimated closed-loop response to a unit step in target rate. Look at rise time, overshoot and settling."
      >
        {log ? <PlotlyChart className="apwt-plot" data={stepData} layout={STEP_LAYOUT} onReady={ready('step')} /> : empty}
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
