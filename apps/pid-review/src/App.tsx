import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PlotlyChart, linkAutorangeReset, linkAxisRanges, relayoutRange, type PlotlyHTMLElement } from '@apwt/plot'
import { fftAmplitudeScale, fftFrequencyScale } from '@apwt/signal'
import { SectionTitle, ToolPage, useLoading, useLogFile } from '@apwt/tool-shell'
import { computeAxisFft } from './analysis/batch-fft.js'
import { availableKeys, type LoadedLog, type PidAxisData, type PidAxisFft } from './analysis/data.js'
import { FULL_PID_ONLY_KEYS, type FftKey } from './analysis/keys.js'
import { loadLog } from './analysis/load.js'
import { stepResponses } from './analysis/step-response.js'
import { specKey } from './analysis/vehicle.js'
import { ComponentSelector, SpectrogramComponent } from './ui/ComponentSelector.js'
import { ParamSetTable } from './ui/ParamSetTable.js'
import { ScaleControls, type AmplitudeScaleKind, type FrequencyScaleSettings } from './ui/ScaleControls.js'
import { SetupPanel } from './ui/SetupPanel.js'
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

const PLOT_STYLE = { width: 1200, height: 450 } as const
const DEFAULT_SHOWN: readonly FftKey[] = ['Tar', 'Act', 'Out']

type FftByAxis = Readonly<Record<string, PidAxisFft | null>>

export function App() {
  const { run } = useLoading()

  // ----- Loaded log and selection -----
  const [log, setLog] = useState<LoadedLog | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [windowSize, setWindowSize] = useState(512)
  /** Editable analysis range; applied to the plots when the user clicks Calculate. */
  const [timeRange, setTimeRange] = useState<[number, number]>([0, 0])
  const [applied, setApplied] = useState<{ range: [number, number]; fft: FftByAxis } | null>(null)
  const [dirty, setDirty] = useState(false)

  // ----- Display settings -----
  const [amplitudeKind, setAmplitudeKind] = useState<AmplitudeScaleKind>('dB')
  const [frequencySettings, setFrequencySettings] = useState<FrequencyScaleSettings>({ log: false, rpm: false })
  const [shownKeys, setShownKeys] = useState<ReadonlySet<FftKey>>(new Set(DEFAULT_SHOWN))
  const [shownSets, setShownSets] = useState<readonly boolean[]>([])
  const [spectrogramKey, setSpectrogramKey] = useState<FftKey>('Out')

  const amplitude = useMemo(
    () => fftAmplitudeScale({ dB: amplitudeKind === 'dB', psd: amplitudeKind === 'psd' }),
    [amplitudeKind]
  )
  const frequency = useMemo(() => fftFrequencyScale(frequencySettings), [frequencySettings])

  const axis: PidAxisData | null = useMemo(
    () => log?.axes.find((a) => specKey(a.spec) === selectedKey) ?? null,
    [log, selectedKey]
  )
  const axisFft = (selectedKey && applied?.fft[selectedKey]) || null
  const enabledKeys = useMemo(() => (axis ? availableKeys(axis) : new Set<FftKey>()), [axis])

  // ----- Calculation -----
  const calculate = useCallback(
    (target: LoadedLog, size: number, range: [number, number]) => {
      const fft: Record<string, PidAxisFft | null> = {}
      for (const a of target.axes) fft[specKey(a.spec)] = computeAxisFft(a.sets, size)
      setApplied({ range, fft })
      setDirty(false)
    },
    []
  )

  const onCalculate = () => {
    if (!log) return
    void run(() => calculate(log, windowSize, timeRange))
  }

  const { file, openFile } = useLogFile(async (buffer, name) => {
    await run(() => {
      const loaded = loadLog(buffer)
      const range: [number, number] = [Math.floor(loaded.startTime), Math.ceil(loaded.endTime)]
      setLog(loaded)
      setTimeRange(range)
      const first = loaded.axes[0]
      setSelectedKey(first ? specKey(first.spec) : null)
      setShownKeys(new Set(DEFAULT_SHOWN))
      document.title = name ? `PID Review: ${name}` : 'ArduPilot PID Review'
      calculate(loaded, windowSize, range)
    })
  })

  // When the selected controller changes, reset per-set visibility and drop keys it lacks.
  useEffect(() => {
    if (!axis) return
    const fft = axisFft
    setShownSets(axis.sets.map((_, i) => (fft ? fft.sets[i] != null : false)))
    setShownKeys((prev) => new Set([...prev].filter((k) => enabledKeys.has(k))))
    if (!enabledKeys.has(spectrogramKey)) setSpectrogramKey('Out')
  }, [axis, axisFft, enabledKeys, spectrogramKey])

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
  const inputLayout = useMemo(() => timeDomainLayout(axis?.spec.units ?? 'deg / s', appliedRange, axis, log), [axis, appliedRange, log])
  const outputLayout = useMemo(() => timeDomainLayout('', appliedRange, axis, log), [axis, appliedRange, log])
  const fftTraces = useMemo(
    () => (applied ? spectrumTraces(axisFft, { amplitude, frequency, range: applied.range, shownKeys, shownSets }) : []),
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

  // ----- Plot linking -----
  const plots = useRef<Partial<Record<'inputs' | 'outputs' | 'fft' | 'step' | 'spec', PlotlyHTMLElement>>>({})
  const [readyCount, setReadyCount] = useState(0)
  const ready = (name: keyof typeof plots.current) => (el: PlotlyHTMLElement) => {
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
    (event: Parameters<NonNullable<React.ComponentProps<typeof PlotlyChart>['onRelayout']>>[0]) => {
      if (!log) return
      const r = relayoutRange(event)
      if (r === undefined) return
      const range: [number, number] =
        r === 'autorange' ? [Math.floor(log.startTime), Math.ceil(log.endTime)] : [Math.floor(r[0]), Math.ceil(r[1])]
      setTimeRange(range)
      setDirty(true)
    },
    [log]
  )

  const validSets = axis ? axis.sets.map((_, i) => axisFft?.sets[i] != null) : []
  const hasFullPid = axis ? axis.spec.id[0] !== 'RATE' : false
  const selectorEnabled = new Set(
    [...enabledKeys].filter((k) => hasFullPid || !FULL_PID_ONLY_KEYS.includes(k))
  )

  return (
    <ToolPage
      title="ArduPilot PID Review Tool"
      readmeUrl="https://github.com/ArduPilot/WebTools/blob/main/PIDReview/Readme.md"
      intro={
        <>
          This tool takes a .bin log with RATE or PID messages and shows the time and frequency content of the rate
          controller target, response and output. To record the full set of PID components the <b>PID</b> bit of the{' '}
          <code>LOG_BITMASK</code> parameter must be set before flying. The <code>RATE</code> log message is enabled by
          default and can also be used by this tool.
        </>
      }
    >
      <SetupPanel
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
        file={file}
        messageTypes={log?.messageTypes ?? null}
        onFile={openFile}
        calculateEnabled={log != null && dirty}
        onCalculate={onCalculate}
      />

      <SectionTitle help='Zoom into a section of the flight to change the Analysis time then click "Calculate".'>
        Flight Data
      </SectionTitle>
      <PlotlyChart data={flightTraces} layout={flightLayout} style={PLOT_STYLE} onRelayout={onFlightRelayout} />

      <SectionTitle help="Shows PID inputs and outputs in the time domain. Useful for inspecting tracking error, overshoot, and oscillations.">
        Time domain
      </SectionTitle>
      <PlotlyChart data={inputTraces} layout={inputLayout} style={PLOT_STYLE} onReady={ready('inputs')} />
      <PlotlyChart data={outputTraces} layout={outputLayout} style={PLOT_STYLE} onReady={ready('outputs')} />

      <SectionTitle help="Displays the frequency response of PID components. Helps identify resonances, noise amplification, and D-term behavior.">
        Frequency domain
      </SectionTitle>
      <div className="apwt-row" style={{ width: 1145, marginLeft: 30, flexWrap: 'nowrap' }}>
        <ComponentSelector
          enabled={selectorEnabled}
          shown={shownKeys}
          onShownChange={setShownKeys}
          loggingRateHz={axisFft?.axis.averageSampleRate ?? null}
          windowSize={axisFft?.axis.windowSize ?? null}
        />
        {axis ? (
          <ParamSetTable paramSets={axis.paramSets} valid={validSets} shown={shownSets} onShownChange={setShownSets} />
        ) : (
          <fieldset style={{ minHeight: 300, flex: 1 }}>
            <legend>Tests</legend>
          </fieldset>
        )}
      </div>
      <PlotlyChart data={fftTraces} layout={fftLayout} style={PLOT_STYLE} onReady={ready('fft')} />
      <ScaleControls
        amplitude={amplitudeKind}
        onAmplitudeChange={setAmplitudeKind}
        frequency={frequencySettings}
        onFrequencyChange={setFrequencySettings}
      />

      <SectionTitle help="Simulated PID response to a step input. Used to evaluate rise time, overshoot, damping, and stability.">
        Step Response
      </SectionTitle>
      <PlotlyChart data={stepData} layout={stepLayoutMemo} style={PLOT_STYLE} onReady={ready('step')} />

      <SectionTitle help="Time-frequency view of PID output. Shows how control effort and noise vary throughout the flight.">
        PID Spectrogram
      </SectionTitle>
      <PlotlyChart data={specTrace} layout={specLayout} style={PLOT_STYLE} onReady={ready('spec')} />
      <SpectrogramComponent enabled={selectorEnabled} selected={spectrogramKey} onSelect={setSpectrogramKey} />
    </ToolPage>
  )
}
