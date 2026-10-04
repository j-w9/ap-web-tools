import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  PlotlyChart,
  linkAutorangeReset,
  linkAxisRanges,
  relayoutRange,
  type PlotRelayoutEvent,
  type PlotlyHTMLElement
} from '@apwt/plot'
import { ErrorBanner, OpenInButton, Section, ToolPage, useLoading, useLogFile, type LogFact } from '@apwt/tool-shell'
import { CONTROL_LOOP_LABELS, DEFAULT_DISPLAY, loopComparison, type DisplaySettings } from './analysis/display.js'
import { identifyResponses, measuredResponses, windowSizeFromText, type IdentifiedResponses } from './analysis/freq-resp.js'
import { PartialTuneLogError, loadTuneLog, type LoadedTuneLog } from './analysis/load.js'
import { loadParamText, saveParamText, urlSettings } from './analysis/param-file.js'
import {
  DEFAULT_INPUTS,
  tuneTarget,
  withInputs,
  type InputName,
  type Inputs,
  type TuneAxis,
  type TuneTarget,
  type TuneVehicle
} from './analysis/params.js'
import { predictResponses } from './analysis/predict.js'
import { tuneAxisForSid } from './analysis/sid.js'
import { airspeedScalingFor, loadTimeHistory, type AirspeedScaling } from './analysis/time-history.js'
import { LoopChips, ScaleChips } from './ui/ComparisonControls.js'
import { ParamPanel, type FileStatus } from './ui/ParamPanel.js'
import { AnalysisRail } from './ui/Rail.js'
import { SidRunTable } from './ui/SidRunTable.js'
import {
  coherenceLayout,
  comparisonTraces,
  flightDataLayout,
  flightDataTraces,
  magnitudeLayout,
  phaseLayout
} from './ui/traces.js'

const VEHICLE_NAMES: Readonly<Record<TuneVehicle, string>> = {
  copter: 'Copter',
  quadplane: 'QuadPlane (VTOL)',
  'fixed-wing': 'Plane (fixed wing)'
}

const FIXED_WING_YAW = 'Fixed-wing yaw has no rate controller model. Pick a roll or pitch run.'

/** The identified responses of the last calculation and what they were calculated for. */
interface Analysis {
  readonly identified: IdentifiedResponses
  readonly target: TuneTarget
  /** `SID_AXIS` of the run analysed, which decides which measured responses are meaningful. */
  readonly sidAxis: number
  /** Airspeed scaling of the prediction (upstream's `aspeed`/`eas2tas` at calculation time). */
  readonly airspeed: AirspeedScaling
}

type PlotName = 'magnitude' | 'phase' | 'coherence'

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function download(text: string, name: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export function App() {
  const { run } = useLoading()
  const [url] = useState(() => urlSettings(window.location.href))

  // ----- Log, analysis window and calculation -----
  const [log, setLog] = useState<LoadedTuneLog | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedRun, setSelectedRun] = useState<number | null>(null)
  const [axis, setAxis] = useState<TuneAxis>('Roll')
  const [timeRange, setTimeRange] = useState<[number, number]>([0, 0])
  // The window size input's committed text; upstream reads it with parseInt when calculating.
  const [windowSizeText, setWindowSizeText] = useState('1024')
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [dirty, setDirty] = useState(false)

  // ----- Parameters and display -----
  const [inputs, setInputs] = useState<Inputs>(() => withInputs(DEFAULT_INPUTS, url.inputs))
  const [display, setDisplay] = useState<DisplaySettings>(() => ({ ...DEFAULT_DISPLAY, ...url.display }))
  const [fileStatus, setFileStatus] = useState<FileStatus>({ kind: 'idle' })
  const setDisplayField = <K extends keyof DisplaySettings>(key: K, value: DisplaySettings[K]) =>
    setDisplay((d) => ({ ...d, [key]: value }))

  // Upstream page global that outlives a log: vehicle_type (kept when a log has no firmware
  // banner). Its aspeed/eas2tas globals are not carried over (proven bug, see airspeedScalingFor).
  const vehicleRef = useRef<TuneVehicle>('copter')

  const vehicle = log?.vehicle ?? vehicleRef.current
  const target = tuneTarget(vehicle, axis)
  const sidAxis = (selectedRun !== null ? log?.runs[selectedRun]?.axis : undefined) ?? 0

  const calculate = useCallback(
    (loaded: LoadedTuneLog, t: TuneTarget | null, sid: number, range: readonly [number, number], sizeText: string) => {
      try {
        // Upstream's order: window size check, FFT set-up, parameter form (which throws for
        // fixed-wing yaw), then the time histories.
        const size = windowSizeFromText(sizeText)
        if (t === null) {
          setAnalysis(null)
          setError(FIXED_WING_YAW)
          return
        }
        const history = loadTimeHistory(loaded.log, loaded.attitudeMessage, t, range[0], range[1])
        const airspeed = airspeedScalingFor(history)
        setAnalysis({ identified: identifyResponses(history, t.axis, size), target: t, sidAxis: sid, airspeed })
        setError(null)
        setDirty(false)
      } catch (e) {
        setAnalysis(null)
        setError(message(e))
      }
    },
    []
  )

  const { file, openFile } = useLogFile(async (buffer, name) => {
    await run(() => {
      try {
        const loaded = loadTuneLog(buffer, { vehicle: vehicleRef.current })
        vehicleRef.current = loaded.vehicle
        const first = loaded.runs[0]
        const nextAxis = (first && tuneAxisForSid(first.axis)) ?? axis
        setLog(loaded)
        setFileName(name)
        setInputs((current) => withInputs(current, loaded.inputs))
        setSelectedRun(first ? 0 : null)
        setAxis(nextAxis)
        document.title = name ? `Analytic Tune: ${name}` : 'Analytic Tune'
        if (first) {
          const range: [number, number] = [first.startTime, first.endTime]
          setTimeRange(range)
          calculate(loaded, tuneTarget(loaded.vehicle, nextAxis), first.axis, range, windowSizeText)
        } else {
          // As upstream, the analysis window is left as it was.
          setAnalysis(null)
          setError('The log has no system identification runs (SIDD).')
        }
      } catch (e) {
        // Upstream keeps the parameters it copied before failing part way.
        if (e instanceof PartialTuneLogError) setInputs((current) => withInputs(current, e.inputs))
        setError(message(e))
      }
    }, 'Reading log')
  })

  const selectRun = (index: number) => {
    const r = log?.runs[index]
    if (!log || !r) return
    const nextAxis = tuneAxisForSid(r.axis) ?? axis
    const range: [number, number] = [r.startTime, r.endTime]
    setSelectedRun(index)
    setAxis(nextAxis)
    setTimeRange(range)
    void run(() => calculate(log, tuneTarget(log.vehicle, nextAxis), r.axis, range, windowSizeText), 'Calculating')
  }

  /**
   * Upstream recalculates everything, reading the analysis window and FFT size afresh, whenever a
   * parameter input or the attitude check box changes. Predictions here follow the parameters
   * live; when the window or FFT size has been edited since the last calculation, this
   * recalculates as upstream's change handlers do.
   */
  const recalculateIfStale = (range: readonly [number, number] = timeRange, sizeText: string = windowSizeText) => {
    if (log && (dirty || analysis === null)) {
      void run(() => calculate(log, target, sidAxis, range, sizeText), 'Calculating')
    }
  }

  // ----- Derived responses: parameters and display settings update these live -----
  const measured = useMemo(
    () => (analysis ? measuredResponses(analysis.identified, display.useAttitude, inputs.SCHED_LOOP_RATE) : null),
    [analysis, display.useAttitude, inputs.SCHED_LOOP_RATE]
  )
  const prediction = useMemo(() => {
    if (!analysis || !measured) return null
    try {
      return {
        value: predictResponses(measured.bareAircraft.H, analysis.identified.sampleRate, analysis.identified.windowSize, {
          target: analysis.target,
          inputs,
          airspeed: analysis.airspeed
        })
      }
    } catch (e) {
      // Upstream's calculation stops with an error for these inputs (for example a notch
      // selection naming no FILTn group).
      return { error: message(e) }
    }
  }, [analysis, measured, inputs])
  const predicted = prediction && 'value' in prediction ? prediction.value : null
  // Upstream only disables the fixed-wing-unavailable loops; a loop already selected stays shown.
  const loop = display.loop
  const comparison = useMemo(
    () => (analysis && measured && predicted ? loopComparison(loop, analysis.sidAxis, measured, predicted) : null),
    [analysis, measured, predicted, loop]
  )

  // ----- Plot data -----
  const flightTraces = useMemo(() => flightDataTraces(log?.flight ?? null), [log])
  const flightLayout = useMemo(() => flightDataLayout(log ? timeRange : null), [log, timeRange])
  const traces = useMemo(
    () =>
      comparisonTraces(comparison, measured?.freq ?? null, {
        gain: display.gain,
        phase: display.phase,
        frequencyUnit: display.frequencyUnit
      }),
    [comparison, measured, display.gain, display.phase, display.frequencyUnit]
  )
  const magLayout = useMemo(() => magnitudeLayout(display), [display])
  const phLayout = useMemo(() => phaseLayout(display), [display])
  const cohLayout = useMemo(() => coherenceLayout(display), [display])

  // ----- Plot linking: the frequency axes zoom together -----
  const [plots, setPlots] = useState<Partial<Record<PlotName, PlotlyHTMLElement>>>({})
  const ready = useCallback(
    (name: PlotName) => (el: PlotlyHTMLElement) => setPlots((p) => (p[name] === el ? p : { ...p, [name]: el })),
    []
  )
  useEffect(() => {
    const { magnitude, phase, coherence } = plots
    if (!magnitude || !phase || !coherence) return
    const unlink = [
      linkAxisRanges([
        { element: magnitude, axis: 'x' },
        { element: phase, axis: 'x' },
        { element: coherence, axis: 'x' }
      ]),
      linkAutorangeReset([magnitude, phase, coherence])
    ]
    return () => unlink.forEach((u) => u())
  }, [plots])

  const onFlightRelayout = useCallback(
    (event: PlotRelayoutEvent) => {
      if (!log) return
      const r = relayoutRange(event)
      // As upstream, zooming sets whole-second bounds; resetting the zoom leaves the window alone.
      if (r === undefined || r === 'autorange') return
      setTimeRange([Math.floor(r[0]), Math.ceil(r[1])])
      setDirty(true)
    },
    [log]
  )

  // ----- Parameter changes and files -----
  const onInput = (name: InputName, value: number) => {
    setInputs((current) => ({ ...current, [name]: value }))
    recalculateIfStale()
  }
  const onLoadParams = (paramFile: File) => {
    void paramFile.text().then((text) => {
      const loaded = loadParamText(text)
      setInputs((current) => withInputs(current, loaded.values))
      const range: [number, number] = [loaded.startTime ?? timeRange[0], loaded.endTime ?? timeRange[1]]
      const sizeText = loaded.windowSizeText ?? windowSizeText
      if (loaded.startTime !== undefined || loaded.endTime !== undefined) setTimeRange(range)
      if (loaded.windowSizeText !== undefined) setWindowSizeText(sizeText)
      if (loaded.useAttitude !== undefined) setDisplayField('useAttitude', loaded.useAttitude)
      setFileStatus({ kind: 'loaded', name: paramFile.name, count: loaded.values.size, ignored: loaded.ignored })
      recalculateIfStale(range, sizeText)
    })
  }
  // Fixed-wing yaw (no target) saves what upstream builds for it; upstream throws there (proven
  // bug fixed, docs/bug-proofs/analytic-tune.md row 112).
  const onSaveParams = () => download(saveParamText(inputs, target), 'filter.param')

  const identified = analysis?.identified
  const facts: LogFact[] | null = log
    ? [
        { label: 'File', value: fileName ?? 'From another tool' },
        { label: 'Vehicle', value: VEHICLE_NAMES[log.vehicle] },
        ...(log.firmware ? [{ label: 'Firmware', value: log.firmware }] : []),
        { label: 'SID runs', value: String(log.runs.length) },
        ...(identified
          ? [
              { label: 'Logging rate', value: `${identified.sampleRate.toFixed(0)} Hz` },
              { label: 'Resolution', value: `${(identified.sampleRate / identified.windowSize).toFixed(2)} Hz` },
              { label: 'Windows averaged', value: String(identified.windowCount) }
            ]
          : [])
      ]
    : null

  const empty = (text: string) => <div className="apwt-empty">{text}</div>
  const noData = log ? 'Pick a run and calculate to see this plot' : 'Open a log with system identification runs to see this plot'
  const calculatedHidden = comparison !== null && !comparison.calculated.visible
  const shownTarget = analysis?.target

  return (
    <ToolPage
      title="Analytic Tune"
      readmeUrl="https://github.com/ArduPilot/WebTools/blob/main/AnalyticTune/Readme.md"
      intro={
        <>
          Identify the aircraft from <b>SystemID</b> mode flight data and predict how gain and filter changes affect the rate and
          attitude loops. The model is linear, so rate and acceleration limits reduce its accuracy.
        </>
      }
      actions={<OpenInButton file={file} messageTypes={log?.messageTypes ?? null} />}
      rail={
        <div className="at-rail">
          <AnalysisRail
            facts={facts}
            onFile={openFile}
            loaded={log !== null}
            timeRange={timeRange}
            onTimeRangeChange={(r) => {
              setTimeRange(r)
              setDirty(true)
            }}
            windowSizeText={windowSizeText}
            onWindowSizeCommit={(text) => {
              setWindowSizeText(text)
              setDirty(true)
            }}
            useAttitude={display.useAttitude}
            onUseAttitudeChange={(use) => {
              setDisplayField('useAttitude', use)
              recalculateIfStale()
            }}
            calculateEnabled={log !== null && (dirty || analysis === null)}
            onCalculate={() => {
              if (log) void run(() => calculate(log, target, sidAxis, timeRange, windowSizeText), 'Calculating')
            }}
          />
          <ParamPanel
            inputs={inputs}
            onInput={onInput}
            target={target}
            logLoaded={log !== null}
            fileStatus={fileStatus}
            onLoadFile={onLoadParams}
            onSaveFile={onSaveParams}
          />
        </div>
      }
    >
      <ErrorBanner message={error ?? (prediction && 'error' in prediction ? prediction.error : null)} />

      <Section title="System ID runs" help="Each SystemID mode run in the log. Pick one to analyse it.">
        {log && log.runs.length > 0 ? (
          <SidRunTable runs={log.runs} selected={selectedRun} onSelect={selectRun} />
        ) : (
          empty('Open a log with SIDS and SIDD messages to list its runs')
        )}
      </Section>

      <Section title="Flight data" help="SID target and gyro rates. Zoom in to set the analysis window, then calculate.">
        {log ? (
          <PlotlyChart
            className="apwt-plot apwt-plot--short"
            data={flightTraces}
            layout={flightLayout}
            onRelayout={onFlightRelayout}
          />
        ) : (
          empty('Open a log with system identification runs to see its flight data')
        )}
      </Section>

      <Section
        title={shownTarget ? `Calculated vs. predicted: ${shownTarget.axis.toLowerCase()} axis` : 'Calculated vs. predicted'}
        help="Measured response from the flight against the model's prediction with the parameters in the rail."
        tools={
          <ScaleChips
            gain={display.gain}
            onGainChange={(v) => setDisplayField('gain', v)}
            phase={display.phase}
            onPhaseChange={(v) => setDisplayField('phase', v)}
            frequencyAxis={display.frequencyAxis}
            onFrequencyAxisChange={(v) => setDisplayField('frequencyAxis', v)}
            frequencyUnit={display.frequencyUnit}
            onFrequencyUnitChange={(v) => setDisplayField('frequencyUnit', v)}
          />
        }
      >
        <LoopChips vehicle={vehicle} value={loop} onChange={(v) => setDisplayField('loop', v)} />
        {calculatedHidden && (
          <p className="at-note">
            This run does not excite the {CONTROL_LOOP_LABELS[loop].toLowerCase()} loop, so only the prediction is shown.
          </p>
        )}
        {analysis ? (
          <>
            <PlotlyChart className="apwt-plot at-bode" data={traces.magnitude} layout={magLayout} onReady={ready('magnitude')} />
            <PlotlyChart className="apwt-plot at-bode" data={traces.phase} layout={phLayout} onReady={ready('phase')} />
          </>
        ) : (
          empty(noData)
        )}
      </Section>

      <Section
        title="Coherence"
        help="How much of each output the input explains, from 0 to 1. Trust the responses where it is near 1."
      >
        {analysis ? (
          <PlotlyChart
            className="apwt-plot at-coherence"
            data={traces.coherence}
            layout={cohLayout}
            onReady={ready('coherence')}
          />
        ) : (
          empty(noData)
        )}
      </Section>
    </ToolPage>
  )
}
