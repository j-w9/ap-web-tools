import { useCallback, useMemo, useState } from 'react'
import { PlotlyChart, relayoutRange, type PlotRelayoutEvent } from '@apwt/plot'
import { DataflashLog } from '@apwt/dataflash'
import {
  ErrorBanner,
  OpenInButton,
  Section,
  ToolPage,
  useLatest,
  useLoading,
  useLogFile,
  useTheme,
  type LogFact
} from '@apwt/tool-shell'
import type { CombinedFit } from './analysis/core.js'
import {
  ekfWindOnFit,
  groundSpeed,
  prepareFit,
  Q_SLIDER,
  runWindModel,
  sameFitInputs,
  seedWarnings,
  sensorSeries,
  sliderToQ,
  type FitInputs,
  type PreparedFit
} from './analysis/fit.js'
import { loadAirspeedLog, type AirspeedLog } from './analysis/load.js'
import { PARAM_FILE_NAME, paramFileText, ratioSuggestions } from './analysis/params.js'
import { chooseTempSource, tempBoxText, temperatureReadout, type TempChoice, type TempSources } from './analysis/temperature.js'
import { fetchGroundTemperature } from './io/open-meteo.js'
import { downloadText } from './ui/download.js'
import { ParamPanel } from './ui/ParamPanel.js'
import { Rail } from './ui/Rail.js'
import { SensorSummary } from './ui/SensorSummary.js'
import {
  AIRSPEED_LAYOUT,
  RESIDUAL_LAYOUT,
  RMS_LAYOUT,
  airspeedTraces,
  flightDataLayout,
  flightDataTraces,
  residualTraces,
  rmsBarTraces,
  windLayout,
  windTraces,
  type SensorPlotSeries
} from './ui/traces.js'
import { WindControls } from './ui/WindControls.js'

/** A loaded log and what the tool derived from it once. */
interface Loaded {
  readonly log: AirspeedLog
  readonly fileName: string | null
  readonly groundSpeed: Float64Array
}

/** The settings form. The fit only reflects it after Calculate. */
interface Draft {
  readonly source: string
  readonly tempChoice: TempChoice
  /** Ground temperature box text, deg C. */
  readonly groundTempText: string
  readonly window: readonly [number, number]
}

/** The last calculation: its inputs, resampled data and seeds, and the wind model at `q`. */
interface Applied {
  readonly inputs: FitInputs
  readonly prepared: PreparedFit
  readonly q: number
  readonly model: CombinedFit | null
}

/** Upstream's ground-temperature box starts at 15 when no preset is available. */
const DEFAULT_GROUND_TEMP = '15'

const EMPTY_DRAFT: Draft = { source: '', tempChoice: 'custom', groundTempText: DEFAULT_GROUND_TEMP, window: [0, 0] }

function draftInputs(draft: Draft): FitInputs | null {
  const groundTempC = parseFloat(draft.groundTempText)
  return isFinite(groundTempC) ? { source: draft.source, groundTempC, window: draft.window } : null
}

function fit(log: AirspeedLog, inputs: FitInputs, q: number): Applied {
  const prepared = prepareFit(log, inputs)
  return { inputs, prepared, q, model: runWindModel(prepared, q) }
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export function App() {
  const { run } = useLoading()
  const theme = useTheme()

  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [openMeteo, setOpenMeteo] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [applied, setApplied] = useState<Applied | null>(null)
  /** Slider position while dragging; `q` is applied when it is released. */
  const [qPosition, setQPosition] = useState<number>(Q_SLIDER.initial)
  const [saveStatus, setSaveStatus] = useState<string | null>(null)

  const log = loaded?.log ?? null
  const latest = useLatest({ loaded, draft, qPosition })

  const tempSources: TempSources = useMemo(
    () => (log ? { ...log.tempSources, ...(openMeteo !== null ? { openmeteo: openMeteo } : {}) } : {}),
    [log, openMeteo]
  )
  const inputs = draftInputs(draft)
  const needCalc = applied === null || inputs === null || !sameFitInputs(applied.inputs, inputs)
  const shown = needCalc ? null : applied

  // ----- Calculation -----
  const calculate = useCallback(
    (target: AirspeedLog, fitInputs: FitInputs | null, q: number) => {
      if (fitInputs === null) {
        setError('Enter a ground temperature before calculating')
        return Promise.resolve()
      }
      return run(() => {
        try {
          setApplied(fit(target, fitInputs, q))
          setSaveStatus(null)
          setError(null)
        } catch (e) {
          setError(errorText(e))
        }
      }, 'Calculating')
    },
    [run]
  )

  const { file, openFile } = useLogFile(async (buffer, name) => {
    let next: AirspeedLog
    try {
      next = await run(() => loadAirspeedLog(DataflashLog.parse(buffer)), 'Reading log')
    } catch (e) {
      setError(errorText(e))
      return
    }
    const choice = chooseTempSource(next.tempSources, 'isa')
    const preset = choice === 'custom' ? undefined : next.tempSources[choice]
    const nextDraft: Draft = {
      source: next.sources[0].name,
      tempChoice: choice,
      groundTempText: preset !== undefined ? tempBoxText(preset) : latest.current.draft.groundTempText,
      window: next.autoWindow
    }
    setLoaded({ log: next, fileName: name, groundSpeed: groundSpeed(next.sources[0]) })
    setOpenMeteo(null)
    setApplied(null)
    setDraft(nextDraft)
    setError(null)
    document.title = name ? `AirspeedFit: ${name}` : 'AirspeedFit'
    const q = sliderToQ(latest.current.qPosition)
    await calculate(next, draftInputs(nextDraft), q)

    // Look up the weather temperature at takeoff; when it arrives it becomes the preferred
    // source and the fit is redone with it, as upstream does.
    const takeoff = next.takeoff
    if (takeoff === null) return
    const oat = await fetchGroundTemperature(takeoff.lat, takeoff.lng, takeoff.date)
    if (oat === null || latest.current.loaded?.log !== next) return
    const weatherDraft: Draft = { ...latest.current.draft, tempChoice: 'openmeteo', groundTempText: tempBoxText(oat) }
    setOpenMeteo(oat)
    setDraft(weatherDraft)
    await calculate(next, draftInputs(weatherDraft), sliderToQ(latest.current.qPosition))
  })

  const commitQ = () => {
    const q = sliderToQ(qPosition)
    if (!applied || applied.q === q) return
    void run(() => setApplied({ ...applied, q, model: runWindModel(applied.prepared, q) }), 'Fitting wind')
  }

  const onFlightRelayout = useCallback(
    (event: PlotRelayoutEvent) => {
      if (!log) return
      const r = relayoutRange(event)
      if (r === undefined) return
      const window: [number, number] =
        r === 'autorange' ? [Math.floor(log.startTime), Math.ceil(log.endTime)] : [Math.floor(r[0]), Math.ceil(r[1])]
      setDraft((d) => ({ ...d, window }))
    },
    [log]
  )

  // ----- Derived display data -----
  const groundTempC = inputs?.groundTempC ?? null
  const readout = useMemo(
    () => (log && groundTempC !== null ? temperatureReadout(log, groundTempC, draft.window) : null),
    [log, groundTempC, draft.window]
  )
  const flightTraces = useMemo(() => flightDataTraces(log, loaded?.groundSpeed ?? null), [log, loaded])
  const flightLayout = useMemo(() => flightDataLayout(log ? draft.window : null), [log, draft.window])

  const model = shown?.model ?? null
  const series: SensorPlotSeries[] = useMemo(
    () =>
      log && model
        ? log.sensors.flatMap((s, i) => {
            const ss = sensorSeries(model, i, s.currentRatio)
            return ss ? [{ instance: s.instance, series: ss }] : []
          })
        : [],
    [log, model]
  )
  const truthColor = theme === 'light' ? '#000000' : '#f3f4f6'
  const biasColor = theme === 'light' ? 'rgba(30,30,30,0.8)' : 'rgba(229,231,235,0.85)'
  const tasData = useMemo(() => (model ? airspeedTraces(model, series, truthColor) : []), [model, series, truthColor])
  const residData = useMemo(() => (model ? residualTraces(model, series) : []), [model, series])
  const rmsData = useMemo(() => rmsBarTraces(series, biasColor), [series, biasColor])
  const windData = useMemo(
    () => (model && shown ? windTraces(model, ekfWindOnFit(shown.prepared.combined, model)) : []),
    [model, shown]
  )
  const windPlotLayout = useMemo(() => windLayout(model?.windDrift ?? NaN), [model])
  const suggestions = useMemo(() => (log ? ratioSuggestions(log.sensors, model) : []), [log, model])
  const warnings = useMemo(() => (shown ? seedWarnings(shown.prepared) : []), [shown])

  const save = () => {
    const text = paramFileText(suggestions)
    if (text === '') return
    downloadText(text, PARAM_FILE_NAME)
    setSaveStatus(
      `Saved ${suggestions.flatMap((s) => (s ? [`${s.name}: ${s.ratio.toFixed(3)}`] : [])).join(', ')} to ${PARAM_FILE_NAME}`
    )
  }

  const facts: LogFact[] | null = log
    ? [
        { label: 'File', value: loaded?.fileName ?? 'From another tool' },
        { label: 'Airspeed sensors', value: log.sensors.length },
        { label: 'Duration', value: `${(log.endTime - log.startTime).toFixed(0)} s` },
        {
          label: 'Flying',
          value: log.flight ? `${log.flight.lo.toFixed(0)} s to ${log.flight.hi.toFixed(0)} s` : 'Not detected'
        },
        ...(shown ? [{ label: 'Fit samples', value: shown.prepared.combined.t.length }] : [])
      ]
    : null

  const noFit = <div className="apwt-empty">Not enough valid samples in the selected window</div>

  return (
    <ToolPage
      title="AirspeedFit"
      readmeUrl="https://github.com/ArduPilot/WebTools/blob/main/AirspeedFit/Readme.md"
      intro={
        <>
          Calibrate <code>ARSPD_RATIO</code> for each airspeed sensor from a <code>.bin</code> log. The EKF ground velocity minus
          an estimated wind is the truth for the airspeed, solved offline forward and backward in time. Pick a window with turns
          or a loiter: a single straight leg cannot separate the wind from the airspeed scale.
        </>
      }
      actions={<OpenInButton file={file} messageTypes={log?.messageTypes ?? null} />}
      rail={
        <Rail
          facts={facts}
          onFile={openFile}
          sources={log?.sources.map((s) => s.name) ?? []}
          source={draft.source}
          onSourceChange={(source) => setDraft((d) => ({ ...d, source }))}
          tempSources={tempSources}
          tempChoice={draft.tempChoice}
          onTempChoiceChange={(choice) =>
            setDraft((d) => {
              const value = choice === 'custom' ? undefined : tempSources[choice]
              return { ...d, tempChoice: choice, groundTempText: value !== undefined ? tempBoxText(value) : d.groundTempText }
            })
          }
          groundTempText={draft.groundTempText}
          onGroundTempTextChange={(text) => setDraft((d) => ({ ...d, tempChoice: 'custom', groundTempText: text }))}
          readout={readout}
          window={draft.window}
          windowLimits={log ? [Math.floor(log.startTime), Math.ceil(log.endTime)] : null}
          onWindowChange={(window) => setDraft((d) => ({ ...d, window }))}
          calculateEnabled={log !== null && needCalc}
          onCalculate={() => {
            if (log) void calculate(log, inputs, sliderToQ(qPosition))
          }}
        />
      }
    >
      <ErrorBanner message={error} />

      <Section
        title="Flight data"
        help="Zoom into part of the flight to set the analysis window, then Calculate. Turns or a loiter at steady airspeed fit best."
      >
        <PlotlyChart className="apwt-plot" data={flightTraces} layout={flightLayout} onRelayout={onFlightRelayout} />
      </Section>

      <Section title="Airspeed sensors" help="Every airspeed sensor in the log is calibrated against one shared wind.">
        {log ? (
          <SensorSummary sensors={log.sensors} />
        ) : (
          <div className="apwt-empty">Open a log to list its airspeed sensors</div>
        )}
      </Section>

      {shown === null ? (
        <Section title="Results">
          <div className="apwt-empty">{log ? 'Click Calculate to see results' : 'Open a log to fit airspeed ratios'}</div>
        </Section>
      ) : (
        <>
          <Section
            title="Expected vs measured airspeed"
            help="True airspeed from ground velocity and the estimated wind, against each sensor before (logged ratio) and after (fitted ratio). Click the legend to hide lines."
          >
            {model ? <PlotlyChart className="apwt-plot" data={tasData} layout={AIRSPEED_LAYOUT} /> : noFit}
          </Section>

          <Section title="Residuals" help="True airspeed minus calibrated airspeed, before and after calibration.">
            {model ? <PlotlyChart className="apwt-plot apwt-plot--short" data={residData} layout={RESIDUAL_LAYOUT} /> : noFit}
          </Section>

          <Section
            title="Calibration RMS error"
            help="RMS airspeed error before and after, per sensor; the narrow dark bar is the mean error (bias). Lower is better."
          >
            {model ? <PlotlyChart className="apwt-plot apwt-plot--short" data={rmsData} layout={RMS_LAYOUT} /> : noFit}
          </Section>

          <Section
            title="Wind model"
            help="The wind as a slow random walk. Low q pins it nearly constant, higher q lets it track weather changes; too high and it absorbs real residuals. The ratios are robust to q."
          >
            <WindControls position={qPosition} onPositionChange={setQPosition} onCommit={commitQ} />
            {model ? <PlotlyChart className="apwt-plot" data={windData} layout={windPlotLayout} /> : noFit}
          </Section>

          <Section title="Suggested parameters" help="Fitted ratios rounded to three decimals, with the change from the log.">
            <ParamPanel
              suggestions={suggestions}
              names={log?.sensors.map((s) => s.ratioName) ?? []}
              warnings={warnings}
              onSave={save}
              saveStatus={saveStatus}
            />
          </Section>
        </>
      )}
    </ToolPage>
  )
}
