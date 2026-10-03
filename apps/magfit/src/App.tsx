import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  PlotlyChart,
  defaultColor,
  linkAutorangeReset,
  linkAxisRanges,
  relayoutRange,
  type PlotRelayoutEvent,
  type PlotlyHTMLElement
} from '@apwt/plot'
import { ErrorBanner, OpenInButton, Section, ToolPage, useLoading, useLogFile, type LogFact } from '@apwt/tool-shell'
import { loadMagFitLog, type MagFitLog } from './analysis/load.js'
import { prepareAttitude, runFits, type CompassFitResult, type PreparedAttitude } from './analysis/magfit.js'
import type { OrientationOption } from './analysis/orientation.js'
import type { UseOverride } from './analysis/params.js'
import {
  compassCalibrations,
  reconcileSelection,
  savedCalibration,
  toggleCalibration,
  type Calibration,
  type CalibrationId,
  type CompassSelection
} from './ui/calibrations.js'
import { CompassCard } from './ui/CompassCard.js'
import { ParamTable } from './ui/ParamTable.js'
import { paramRows } from './ui/params-table.js'
import { Rail } from './ui/Rail.js'
import { downloadText, planSave } from './ui/save.js'
import {
  componentTraces,
  errorBarLayout,
  errorBarTraces,
  errorTraces,
  flightDataLayout,
  flightDataTraces,
  lengthTraces,
  motorTraces,
  timeLayout,
  yawVsAttitudeTraces,
  yawVsExistingTraces,
  type ErrorBars,
  type PlotEntry
} from './ui/traces.js'
import './magfit.css'

type Range = [number, number]
type PlotName = 'x' | 'y' | 'z' | 'error' | 'length' | 'yawExisting' | 'yawAttitude' | 'motor'

/** A completed calculation and the inputs it used. */
interface Applied {
  readonly sourceIndex: number
  readonly range: Range
  readonly prepared: PreparedAttitude
  readonly compasses: readonly (CompassFitResult | undefined)[]
}

const ORIENTATION_DEFAULT: readonly OrientationOption[] = ['check', 'check', 'check']
const USE_DEFAULT: readonly UseOverride[] = ['noChange', 'noChange', 'noChange']
const AXES = ['x', 'y', 'z'] as const

const fullRange = (d: MagFitLog): Range => [Math.floor(d.startTime), Math.ceil(d.endTime)]

/** Calibrations of every compass with a stable plot colour each. */
function calibrationColors(compasses: readonly (readonly Calibration[] | undefined)[]): Map<CalibrationId, string>[] {
  let next = 1
  return compasses.map((cals) => new Map((cals ?? []).map((c) => [c.id, defaultColor(next++)] as const)))
}

export function App() {
  const { run } = useLoading()

  // ----- Log and analysis inputs -----
  const [data, setData] = useState<MagFitLog | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sourceIndex, setSourceIndex] = useState<number | undefined>(undefined)
  /** Editable analysis window; applied on Calculate. */
  const [timeRange, setTimeRange] = useState<Range>([0, 0])
  const [orientation, setOrientation] = useState<readonly OrientationOption[]>(ORIENTATION_DEFAULT)
  const [use, setUse] = useState<readonly UseOverride[]>(USE_DEFAULT)
  const [applied, setApplied] = useState<Applied | null>(null)
  const [selections, setSelections] = useState<readonly (CompassSelection | undefined)[]>([])
  const [dirty, setDirty] = useState(false)
  const [saveStatus, setSaveStatus] = useState<{ ok: boolean; text: string } | null>(null)

  // ----- Calculation (upstream `calculate`) -----
  const calculate = useCallback(
    (
      d: MagFitLog,
      src: number,
      range: Range,
      options: readonly OrientationOption[],
      previous: Applied | null,
      previousSelections: readonly (CompassSelection | undefined)[]
    ) => {
      try {
        if (!(range[1] > range[0])) throw new Error('The analysis window end must be after its start.')
        // The expected field only depends on the attitude source, so reuse it when that is unchanged.
        const prepared = previous?.sourceIndex === src ? previous.prepared : prepareAttitude(d, src)
        const compasses = runFits(d, prepared, { timeStart: range[0], timeEnd: range[1], orientation: options })
        setApplied({ sourceIndex: src, range, prepared, compasses })
        setSelections(compasses.map((c, i) => (c ? reconcileSelection(previousSelections[i], c) : undefined)))
        setDirty(false)
        setSaveStatus(null)
        setError(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    []
  )

  const { file, openFile } = useLogFile(async (buffer, name) => {
    await run(() => {
      try {
        const loaded = loadMagFitLog(buffer)
        const range = fullRange(loaded)
        setData(loaded)
        setFileName(name)
        setTimeRange(range)
        setSourceIndex(loaded.defaultAttitudeSource)
        setOrientation(ORIENTATION_DEFAULT)
        setUse(USE_DEFAULT)
        setApplied(null)
        setSelections([])
        setSaveStatus(null)
        setError(null)
        document.title = name ? `MAGFit: ${name}` : 'MAGFit'
        if (loaded.defaultAttitudeSource === undefined) setDirty(true)
        else calculate(loaded, loaded.defaultAttitudeSource, range, ORIENTATION_DEFAULT, null, [])
      } catch (e) {
        setData(null)
        setApplied(null)
        setError(e instanceof Error ? e.message : String(e))
      }
    }, 'Reading log')
  })

  const recalculate = (options = orientation) => {
    if (data && sourceIndex !== undefined) {
      void run(() => calculate(data, sourceIndex, timeRange, options, applied, selections), 'Calculating')
    }
  }

  // ----- Calibrations, selection and plot entries -----
  const calibrations = useMemo(() => applied?.compasses.map((c) => (c ? compassCalibrations(c) : undefined)) ?? [], [applied])
  const colors = useMemo(() => calibrationColors(calibrations), [calibrations])
  const entries = useMemo(() => {
    const out: PlotEntry[] = []
    applied?.compasses.forEach((c, i) => {
      const selection = selections[i]
      if (!c || !selection) return
      for (const cal of calibrations[i] ?? []) {
        if (!cal.valid || !selection.shown.has(cal.id)) continue
        out.push({
          compass: i,
          calibration: cal,
          time: c.prepared.compass.time,
          attitudeYaw: c.prepared.attitudeYaw,
          existingYaw: c.prepared.existingYaw,
          color: colors[i]?.get(cal.id) ?? defaultColor(0)
        })
      }
    })
    return out
  }, [applied, selections, calibrations, colors])

  const savePlan = useMemo(() => (applied ? planSave(applied.compasses, selections, use) : null), [applied, selections, use])

  // ----- Plot data -----
  const range = applied?.range ?? null
  const flightTraces = useMemo(() => flightDataTraces(data?.flight ?? null), [data])
  const flightLayout = useMemo(() => flightDataLayout(data ? timeRange : null), [data, timeRange])
  const component = useMemo(
    () => AXES.map((axis) => componentTraces(axis, applied?.prepared ?? null, entries)),
    [applied, entries]
  )
  const componentLayouts = useMemo(() => AXES.map((axis) => timeLayout(`Field ${axis} (mGauss)`, range)), [range])
  const errorData = useMemo(() => errorTraces(entries), [entries])
  const errorLayout = useMemo(() => timeLayout('Field error (mGauss)', range), [range])
  const lengthData = useMemo(
    () => lengthTraces(data ? data.earthField.intensity * 1000.0 : null, data ? [data.startTime, data.endTime] : null, entries),
    [data, entries]
  )
  const lengthLayout = useMemo(() => timeLayout('Field length (mGauss)', range), [range])
  const yawExisting = useMemo(() => yawVsExistingTraces(entries), [entries])
  const yawExistingLayout = useMemo(() => timeLayout('Heading change (deg)', range), [range])
  const yawAttitude = useMemo(() => yawVsAttitudeTraces(entries), [entries])
  const yawAttitudeLayout = useMemo(() => timeLayout('Heading difference (deg)', range), [range])
  const motorData = useMemo(() => motorTraces(data?.motorSources ?? []), [data])
  const motorLayout = useMemo(() => timeLayout('Current (A)', range), [range])
  const bars = useMemo(() => {
    const out: ErrorBars[] = []
    calibrations.forEach((cals, i) => {
      if (cals) out.push({ compass: i, bars: cals.flatMap((c) => (c.valid ? [{ label: c.label, meanError: c.meanError }] : [])) })
    })
    return errorBarTraces(out)
  }, [calibrations])
  const barLayout = useMemo(() => errorBarLayout(), [])

  // ----- Plot linking: every time plot zooms together -----
  const [plots, setPlots] = useState<Partial<Record<PlotName, PlotlyHTMLElement>>>({})
  const ready = useCallback(
    (name: PlotName) => (el: PlotlyHTMLElement) => setPlots((p) => (p[name] === el ? p : { ...p, [name]: el })),
    []
  )
  useEffect(() => {
    const elements = Object.values(plots)
    if (elements.length < 2) return
    const unlink = [linkAxisRanges(elements.map((element) => ({ element, axis: 'x' as const }))), linkAutorangeReset(elements)]
    return () => unlink.forEach((u) => u())
  }, [plots])

  const onFlightRelayout = useCallback(
    (event: PlotRelayoutEvent) => {
      if (!data) return
      const r = relayoutRange(event)
      if (r === undefined) return
      setTimeRange(r === 'autorange' ? fullRange(data) : [Math.floor(r[0]), Math.ceil(r[1])])
      setDirty(true)
    },
    [data]
  )

  const save = () => {
    if (!savePlan) return
    if (savePlan.file.ok) {
      downloadText(savePlan.file.text, 'MAGFit.param')
      setSaveStatus({ ok: true, text: savePlan.file.summary })
    } else {
      setSaveStatus({ ok: false, text: savePlan.file.error })
    }
  }

  // ----- Rendering -----
  const present = applied?.compasses.flatMap((c, i) => (c ? [{ c, i }] : [])) ?? []
  const facts: LogFact[] | null = data
    ? [
        { label: 'File', value: fileName ?? 'From another tool' },
        { label: 'Compasses', value: data.compasses.filter((c) => c !== undefined).length },
        { label: 'Duration', value: `${(data.endTime - data.startTime).toFixed(0)} s` },
        {
          label: 'Location',
          value: `${data.location.lat.toFixed(5)}, ${data.location.lon.toFixed(5)} (${data.location.source})`
        },
        { label: 'Earth field', value: `${(data.earthField.intensity * 1000).toFixed(0)} mGauss` },
        { label: 'Declination', value: `${data.earthField.declination.toFixed(1)}°` },
        { label: 'Inclination', value: `${data.earthField.inclination.toFixed(1)}°` }
      ]
    : null
  const empty = <div className="apwt-empty">Open a log to see this plot</div>
  const chart = (
    name: PlotName,
    traces: Parameters<typeof PlotlyChart>[0]['data'],
    layout: Parameters<typeof PlotlyChart>[0]['layout']
  ) =>
    applied ? <PlotlyChart className="apwt-plot apwt-plot--short" data={traces} layout={layout} onReady={ready(name)} /> : empty

  return (
    <ToolPage
      title="MAGFit"
      readmeUrl="https://github.com/ArduPilot/WebTools/blob/main/MAGFit/Readme.md"
      intro={
        <>
          In-flight compass calibration from a <code>.bin</code> log: finds the calibration parameters that best fit the measured
          magnetic field to the one expected from the World Magnetic Model. Fly figure of eights to cover as many orientations as
          possible, and a range of throttle and current if you want motor compensation.
        </>
      }
      actions={<OpenInButton file={file} messageTypes={data ? ['MAG'] : null} />}
      rail={
        <Rail
          facts={facts}
          onFile={openFile}
          sources={data?.attitudeSources ?? []}
          sourceIndex={sourceIndex}
          onSourceChange={(i) => {
            setSourceIndex(i)
            setDirty(true)
          }}
          timeRange={timeRange}
          timeLimits={data ? fullRange(data) : null}
          onTimeRangeChange={(r) => {
            setTimeRange(r)
            setDirty(true)
          }}
          calculateEnabled={data != null && sourceIndex !== undefined && dirty}
          onCalculate={() => recalculate()}
          saveEnabled={savePlan?.file.ok === true && !dirty}
          onSave={save}
        />
      }
    >
      <ErrorBanner message={error} />
      {data && sourceIndex === undefined && (
        <p className="magfit-warning">
          This log has more than one attitude source and none matches AHRS_EKF_TYPE. Choose one, then Calculate.
        </p>
      )}
      {applied && dirty && <p className="magfit-warning">Settings changed: Calculate to update the results.</p>}

      <Section title="Flight data" help="Zoom into the flying part of the log to set the analysis window, then Calculate.">
        <PlotlyChart
          className="apwt-plot apwt-plot--short"
          data={flightTraces}
          layout={flightLayout}
          onRelayout={onFlightRelayout}
        />
      </Section>

      <Section
        title="Compasses"
        help="Status and options per compass. Tick calibrations to compare them in the plots; the last one ticked is saved. Numbers are the mean error in mGauss."
      >
        {applied ? (
          <div className="magfit-compasses">
            {present.map(({ c, i }) => {
              const selection = selections[i]
              const cals = calibrations[i]
              if (!selection || !cals) return null
              return (
                <CompassCard
                  key={i}
                  index={i}
                  result={c}
                  calibrations={cals}
                  colors={colors[i] ?? new Map<CalibrationId, string>()}
                  selection={selection}
                  savedId={savedCalibration(selection, cals)?.id}
                  onToggle={(id, show) => {
                    setSelections((s) => s.map((sel, j) => (j === i && sel ? toggleCalibration(sel, id, show) : sel)))
                    setSaveStatus(null)
                  }}
                  orientation={orientation[i] ?? 'check'}
                  onOrientationChange={(o) => {
                    // Like upstream, changing the orientation option recalculates straight away.
                    const next = orientation.map((v, j) => (j === i ? o : v))
                    setOrientation(next)
                    recalculate(next)
                  }}
                  use={use[i] ?? 'noChange'}
                  onUseChange={(u) => {
                    setUse((s) => s.map((v, j) => (j === i ? u : v)))
                    setSaveStatus(null)
                  }}
                />
              )
            })}
          </div>
        ) : (
          <div className="apwt-empty">Open a log to see its compasses</div>
        )}
      </Section>

      <Section
        title="Parameters to save"
        help="What Save parameters writes for each compass, with COMPASS_MOTCT. Values that change from the log are highlighted."
      >
        {applied && savePlan ? (
          <>
            <ParamTable
              columns={present.map(({ i }) => {
                const sel = selections[i]
                const saved = sel ? savedCalibration(sel, calibrations[i] ?? []) : undefined
                return { title: `Compass ${String(i + 1)}`, calibration: saved?.label ?? 'Existing calibration (not saved)' }
              })}
              rows={paramRows(
                present.map(({ c, i }) => {
                  const sel = selections[i]
                  return {
                    names: c.prepared.compass.names,
                    existing: c.prepared.compass.params,
                    selected: sel ? savedCalibration(sel, calibrations[i] ?? [])?.params : undefined
                  }
                })
              )}
            />
            {savePlan.warnings.map((w) => (
              <p key={w} className="magfit-warning magfit-pre">
                {w}
              </p>
            ))}
            {!savePlan.file.ok && <p className="magfit-note">{savePlan.file.error}</p>}
            {saveStatus && <p className={saveStatus.ok ? 'magfit-success magfit-pre' : 'apwt-error'}>{saveStatus.text}</p>}
          </>
        ) : (
          <div className="apwt-empty">Calculate to see the parameters</div>
        )}
      </Section>

      <Section
        title="Mean field error"
        help="Weighted RMS difference between measured and expected field over the analysis window."
      >
        {applied ? <PlotlyChart className="apwt-plot apwt-plot--short" data={bars} layout={barLayout} /> : empty}
      </Section>

      <Section
        title="Expected and measured body frame field"
        help="Each axis of the measured field against the field expected from the attitude."
      >
        {AXES.map((axis, k) => (
          <div key={axis}>{chart(axis, component[k] ?? [], componentLayouts[k] ?? {})}</div>
        ))}
      </Section>

      <Section title="Field error" help="Length of the difference between measured and expected field.">
        {chart('error', errorData, errorLayout)}
      </Section>

      <Section
        title="Field length"
        help="Measured field strength; ideally it stays on the expected strength whatever the attitude."
      >
        {chart('length', lengthData, lengthLayout)}
      </Section>

      <Section title="Heading change from existing calibration" help="How much each new calibration moves the compass heading.">
        {chart('yawExisting', yawExisting, yawExistingLayout)}
      </Section>

      <Section title="Heading against attitude source" help="Compass heading minus the yaw of the selected attitude source.">
        {chart('yawAttitude', yawAttitude, yawAttitudeLayout)}
      </Section>

      {data && data.motorSources.length > 0 && (
        <Section title="Motor compensation source" help="Battery current used for the motor compensation fits.">
          {chart('motor', motorData, motorLayout)}
        </Section>
      )}
    </ToolPage>
  )
}
