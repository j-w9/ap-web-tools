import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  PlotlyChart,
  linkAutorangeReset,
  linkAxisRanges,
  relayoutRange,
  type PlotRelayoutEvent,
  type PlotlyHTMLElement
} from '@apwt/plot'
import { fftAmplitudeScale, fftFrequencyScale, fftWindowSizeInc, type AmplitudeKind } from '@apwt/signal'
import { ErrorBanner, OpenInButton, Section, ToolPage, useLoading, useLogFile, type LogFact } from '@apwt/tool-shell'
import { WINDOW_NOT_POWER_OF_TWO, computeAxisFft, parseWindowSize } from './analysis/batch-fft.js'
import type { LoadedLog, PidAxisData, PidAxisFft } from './analysis/data.js'
import type { FftKey } from './analysis/keys.js'
import { LoadError, loadLog } from './analysis/load.js'
import { DEFAULT_SHOWN_KEYS, DEFAULT_SPECTROGRAM_KEY, enabledKeys, selectionsForAxis, validSets } from './analysis/selection.js'
import { carryOverStaleMeans, stepResponses, type SetStepResponse } from './analysis/step-response.js'
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

const STEP_LAYOUT = stepLayout()
type PlotName = 'inputs' | 'outputs' | 'fft' | 'step' | 'spec'
type FftByAxis = ReadonlyMap<SpecKey, PidAxisFft | null>
type Range = [number, number]

/** Upstream FFT window size input default. */
const DEFAULT_WINDOW = '512'

/**
 * What the plots currently show, captured when upstream redraws: on load, Calculate, a scale
 * change or a controller change. Upstream's `redraw()` reads the analysis time inputs at that
 * moment, so an edited range reaches the plots at the next redraw even without Calculate.
 */
interface Drawn {
  key: SpecKey
  range: Range
  /** Spectrogram time range: also refreshed when the spectrogram signal changes. */
  spectrogramRange: Range
  /** Step plot contents, including means carried over by upstream's stale-mean quirk. */
  steps: (SetStepResponse | null)[] | null
}

/** Setup of the selected controller (upstream `add_param_sets`): Tests table state and selections. */
interface AxisSetup {
  key: SpecKey
  valid: readonly boolean[]
}

const VEHICLE_NAMES: Readonly<Record<VehicleType, string>> = {
  copter: 'Copter',
  plane: 'Plane',
  rover: 'Rover',
  sub: 'Sub',
  tracker: 'Tracker',
  blimp: 'Blimp'
}

const rangeOf = (log: LoadedLog): Range => [Math.floor(log.startTime), Math.ceil(log.endTime)]

export function App() {
  const { run } = useLoading()

  // ----- Loaded log and analysis inputs -----
  const [log, setLog] = useState<LoadedLog | null>(null)
  const [failedTypes, setFailedTypes] = useState<readonly string[] | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedKey, setSelectedKey] = useState<SpecKey | null>(null)
  /** Window size input text and the last committed value (upstream `data-last`). */
  const [windowText, setWindowText] = useState(DEFAULT_WINDOW)
  const [windowLast, setWindowLast] = useState(parseFloat(DEFAULT_WINDOW))
  /** Analysis time inputs (upstream `TimeStart`/`TimeEnd`, read with parseFloat). */
  const [timeRange, setTimeRange] = useState<Range>([0, 0])
  /** FFT results; null before a calculation and after the window size changes (upstream `clear_calculation`). */
  const [fft, setFft] = useState<FftByAxis | null>(null)
  const [calculateEnabled, setCalculateEnabled] = useState(false)
  const [drawn, setDrawn] = useState<Drawn | null>(null)
  const [setup, setSetup] = useState<AxisSetup | null>(null)

  // ----- Display settings -----
  const [amplitudeKind, setAmplitudeKind] = useState<AmplitudeKind>('dB')
  const [frequencySettings, setFrequencySettings] = useState<FrequencyScaleSettings>({ log: false, rpm: false })
  const [chosenKeys, setShownKeys] = useState<ReadonlySet<FftKey>>(new Set(DEFAULT_SHOWN_KEYS))
  const [shownSets, setShownSets] = useState<readonly boolean[]>([])
  const [chosenSpectrogramKey, setSpectrogramKey] = useState<FftKey>(DEFAULT_SPECTROGRAM_KEY)

  const amplitude = useMemo(
    () => fftAmplitudeScale({ dB: amplitudeKind === 'dB', psd: amplitudeKind === 'PSD' }),
    [amplitudeKind]
  )
  const frequency = useMemo(() => fftFrequencyScale(frequencySettings), [frequencySettings])

  const axis: PidAxisData | null = useMemo(() => log?.axes.find((a) => a.spec.key === selectedKey) ?? null, [log, selectedKey])
  const axisFft = (selectedKey !== null && fft?.get(selectedKey)) || null
  const enabled = useMemo(() => (axis ? enabledKeys(axis).keys : new Set<FftKey>()), [axis])

  // Effective selections, limited to what the current controller has.
  const shownKeys = useMemo(() => new Set([...chosenKeys].filter((k) => enabled.has(k))), [chosenKeys, enabled])
  const spectrogramKey: FftKey = enabled.has(chosenSpectrogramKey) ? chosenSpectrogramKey : DEFAULT_SPECTROGRAM_KEY

  // ----- Upstream's redraw: capture the time inputs and recompute the step responses -----
  const redraw = (target: LoadedLog, key: SpecKey, allFft: FftByAxis | null, range: Range, previous: Drawn | null): Drawn => {
    const data = target.axes.find((a) => a.spec.key === key)
    const keyFft = allFft?.get(key) ?? null
    const prevSteps = previous?.key === key ? previous.steps : null
    // With no FFT upstream returns before redraw_step, leaving the step plot as it was.
    const steps =
      data && keyFft ? carryOverStaleMeans(prevSteps, stepResponses(data.sets, keyFft.axis, range), data.sets) : prevSteps
    return { key, range, spectrogramRange: range, steps }
  }

  /** Upstream `setup_axis`: Tests table and selections for the controller, then a fresh redraw. */
  const setupAxis = (
    target: LoadedLog,
    key: SpecKey,
    allFft: FftByAxis | null,
    range: Range,
    shown: ReadonlySet<FftKey>,
    spectrogram: FftKey
  ) => {
    const data = target.axes.find((a) => a.spec.key === key)
    if (!data) return
    const valid = validSets(data, allFft?.get(key) ?? null)
    const next = selectionsForAxis(data, shown, spectrogram)
    setSetup({ key, valid })
    setShownSets(valid)
    setShownKeys(next.shown)
    setSpectrogramKey(next.spectrogram)
    setDrawn(redraw(target, key, allFft, range, null))
  }

  /** Upstream `calculate()`: batch FFT of every controller, or the window size alert. */
  const calculate = (target: LoadedLog): FftByAxis | null => {
    setCalculateEnabled(false)
    const size = parseWindowSize(windowText)
    if (size === null) {
      setError(WINDOW_NOT_POWER_OF_TWO)
      return null
    }
    return new Map(target.axes.map((a) => [a.spec.key, computeAxisFft(a.sets, size)] as const))
  }

  const { file, openFile } = useLogFile(async (buffer, name) => {
    await run(() => {
      try {
        setError(null)
        const loaded = loadLog(buffer)
        const range = rangeOf(loaded)
        const first = loaded.axes[0]!.spec.key
        setLog(loaded)
        setFailedTypes(null)
        setFileName(name)
        setTimeRange(range)
        setSelectedKey(first)
        document.title = name ? `PID Review: ${name}` : 'ArduPilot PID Review'
        let result: FftByAxis | null = null
        try {
          result = calculate(loaded)
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e))
        }
        setFft(result)
        setupAxis(loaded, first, result, range, new Set(DEFAULT_SHOWN_KEYS), DEFAULT_SPECTROGRAM_KEY)
      } catch (e) {
        setLog(null)
        setFft(null)
        setDrawn(null)
        setSetup(null)
        setFailedTypes(e instanceof LoadError ? e.messageTypes : null)
        setError(e instanceof Error ? e.message : String(e))
      }
    }, 'Reading log')
  })

  const onCalculate = () => {
    if (!log || selectedKey === null) return
    void run(() => {
      try {
        setError(null)
        const result = calculate(log)
        if (result === null) return
        setFft(result)
        setDrawn((d) => redraw(log, selectedKey, result, timeRange, d))
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    }, 'Calculating')
  }

  /** Scale changes call upstream `redraw()`, which picks up the current time inputs. */
  const redrawNow = () => {
    if (log && selectedKey !== null) setDrawn((d) => redraw(log, selectedKey, fft, timeRange, d))
  }

  // ----- Plot data -----
  const shownDrawn = drawn !== null && drawn.key === selectedKey ? drawn : null
  const drawnRange = shownDrawn?.range ?? null
  const flightTraces = useMemo(() => flightDataTraces(log?.flight ?? null), [log])
  const flightLayout = useMemo(() => flightDataLayout(log ? timeRange : null), [log, timeRange])
  const inputTraces = useMemo(() => timeInputTraces(axis), [axis])
  const outputTraces = useMemo(() => timeOutputTraces(axis), [axis])
  const inputLayout = useMemo(
    () => timeDomainLayout(axis?.spec.units ?? 'deg / s', drawnRange, axis, log),
    [axis, drawnRange, log]
  )
  const outputLayout = useMemo(() => timeDomainLayout('Output', drawnRange, axis, log), [axis, drawnRange, log])
  const fftTraces = useMemo(
    () => (drawnRange ? spectrumTraces(axisFft, { amplitude, frequency, range: drawnRange, shownKeys, shownSets }) : []),
    [drawnRange, axisFft, amplitude, frequency, shownKeys, shownSets]
  )
  const fftLayout = useMemo(() => spectrumLayout(amplitude, frequency), [amplitude, frequency])
  const steps = axisFft ? (shownDrawn?.steps ?? null) : null
  const stepData = useMemo(() => stepTraces(steps, shownSets), [steps, shownSets])
  const specTrace = useMemo(
    () => spectrogramTrace(axisFft, spectrogramKey, amplitude, frequency),
    [axisFft, spectrogramKey, amplitude, frequency]
  )
  const specRange = shownDrawn?.spectrogramRange ?? null
  const specLayout = useMemo(() => spectrogramLayout(frequency, specRange), [frequency, specRange])

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
      setTimeRange(r === 'autorange' ? rangeOf(log) : [Math.floor(r[0]), Math.ceil(r[1])])
      setCalculateEnabled(true)
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
              { label: 'Logging rate', value: `${axisFft.axis.averageSampleRate.toFixed(2)} Hz` },
              {
                label: 'Resolution',
                value: `${(axisFft.axis.averageSampleRate / axisFft.axis.windowSize).toFixed(2)} Hz`
              }
            ]
          : [])
      ]
    : null

  const tableValid = setup !== null && setup.key === selectedKey ? setup.valid : []
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
      actions={<OpenInButton file={file} messageTypes={log?.messageTypes ?? failedTypes} />}
      rail={
        <Rail
          facts={facts}
          onFile={openFile}
          windowSize={windowText}
          onWindowSizeCommit={(raw) => {
            // Upstream fft_window_size_inc then clear_calculation.
            const next = fftWindowSizeInc(windowLast, parseFloat(raw))
            const text = next === parseFloat(raw) ? raw : String(next)
            setWindowText(text)
            setWindowLast(parseFloat(text))
            if (log) {
              setFft(null)
              setCalculateEnabled(true)
            }
          }}
          timeRange={timeRange}
          timeLimits={log ? rangeOf(log) : null}
          onTimeRangeChange={(r) => {
            setTimeRange(r)
            setCalculateEnabled(true)
          }}
          availableKeys={new Set(log?.axes.map((a) => a.spec.key))}
          selectedKey={selectedKey}
          onSelectKey={(key) => {
            setSelectedKey(key)
            if (log) setupAxis(log, key, fft, timeRange, chosenKeys, chosenSpectrogramKey)
          }}
          calculateEnabled={log != null && calculateEnabled}
          onCalculate={onCalculate}
        />
      }
    >
      <ErrorBanner message={error} />

      <Section title="Flight data" help="Zoom into part of the flight to set the analysis window, then calculate.">
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
            onAmplitudeChange={(kind) => {
              setAmplitudeKind(kind)
              redrawNow()
            }}
            frequency={frequencySettings}
            onFrequencyChange={(settings) => {
              setFrequencySettings(settings)
              redrawNow()
            }}
          />
        }
      >
        <SignalChips enabled={enabled} shown={shownKeys} onShownChange={setShownKeys} />
        {axis && <ParamSetTable paramSets={axis.paramSets} valid={tableValid} shown={shownSets} onShownChange={setShownSets} />}
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
        tools={
          <SpectrogramChips
            enabled={enabled}
            selected={spectrogramKey}
            onSelect={(key) => {
              // Upstream redraw_Spectrogram also re-reads the time inputs for its x range.
              setSpectrogramKey(key)
              setDrawn((d) => (d ? { ...d, spectrogramRange: timeRange } : d))
            }}
          />
        }
      >
        {log ? <PlotlyChart className="apwt-plot" data={specTrace} layout={specLayout} onReady={ready('spec')} /> : empty}
      </Section>
    </ToolPage>
  )
}
