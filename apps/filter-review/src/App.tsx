import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import {
  PlotlyChart,
  linkAutorangeReset,
  linkAxisRanges,
  relayoutRange,
  type PlotRelayoutEvent,
  type PlotlyHTMLElement
} from '@apwt/plot'
import { DataflashLog } from '@apwt/dataflash'
import { wrapPhase } from '@apwt/filters'
import { fftAmplitudeScale, fftFrequencyScale, type AmplitudeKind } from '@apwt/signal'
import {
  ChipLabel,
  downloadText,
  ErrorBanner,
  OpenInButton,
  RadioChips,
  Section,
  ToolPage,
  toolById,
  toolHref,
  useLoading,
  useLogFile,
  type LogFact
} from '@apwt/tool-shell'
import { analyseGyro, instanceTransfer, sensorFftInfo, type GyroAnalysis } from './analysis/analyse.js'
import { GYRO_AXES, type GyroAxis } from './analysis/fft/batch-fft.js'
import { buildFilters } from './analysis/filters/filter-set.js'
import { defaultFilterParams, type FilterParams } from './analysis/filter-params.js'
import { filterToolUrl } from './analysis/filter-tool-link.js'
import type { FilterVersion } from './analysis/filter-version.js'
import type { GyroLogType } from './analysis/gyro-data.js'
import { gyroInfoText } from './analysis/gyro-sensors.js'
import { loadFilterReviewLog, trackingContext, type FilterReviewLog } from './analysis/load.js'
import { applyParamFile, filterParamFileText } from './analysis/param-file.js'
import type { AliasMode } from './analysis/plots/alias.js'
import { bodeResponse } from './analysis/plots/bode.js'
import { loggedNotchLines, notchMarkers, notchTrackingLines } from './analysis/plots/notch-lines.js'
import type { TimeRange } from './analysis/time-index.js'
import {
  AliasChips,
  AxisChips,
  GyroChips,
  NotchChips,
  ScaleChips,
  TraceChips,
  type FrequencyScaleSettings,
  type NotchToggle
} from './ui/Controls.js'
import { Rail, type FftSettings } from './ui/Rail.js'
import {
  bodeLayout,
  bodeTraces,
  flightDataLayout,
  flightDataTraces,
  notchShapes,
  spectrogramLayout,
  spectrogramTraces,
  spectrumLayout,
  spectrumTraceKey,
  spectrumTraces,
  type AnalysedInstance,
  type NotchLineSet,
  type SpectrumKind,
  type SpectrumTraceKey
} from './ui/traces.js'

type PlotName = 'fft' | 'bode' | 'spec'
type PhaseMode = 'unwrap' | 'wrap'

const NOTCH_TOGGLES = ['notch1', 'notch2'] as const

/** Trace and plot selections that follow a newly loaded log (upstream `load()` defaults). */
interface Selections {
  shown: ReadonlySet<SpectrumTraceKey>
  bodeGyro: number
  specGyro: number
  specKind: SpectrumKind
}

function defaultSelections(log: FilterReviewLog): Selections {
  const shown = new Set<SpectrumTraceKey>()
  const primary = log.primaryGyro
  for (const g of log.gyro.instances) {
    if (g === null) continue
    // Only the EKF primary is shown by default when there is one
    const show = !log.primaryFromEkf || g.sensorNum === primary
    if (!show) continue
    for (const axis of GYRO_AXES) {
      shown.add(spectrumTraceKey(g.sensorNum, g.postFilter ? 'post' : 'pre', axis))
      // Show the estimate by default when there is no logged post-filter data
      if (log.havePre && !log.havePost) shown.add(spectrumTraceKey(g.sensorNum, 'est', axis))
    }
  }
  return { shown, bodeGyro: primary, specGyro: primary, specKind: log.havePre ? 'pre' : 'post' }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function App() {
  const { run } = useLoading()

  // ----- Log and analysis -----
  const [parsed, setParsed] = useState<{ log: DataflashLog; name: string | null } | null>(null)
  const [loaded, setLoaded] = useState<FilterReviewLog | null>(null)
  const [analysis, setAnalysis] = useState<GyroAnalysis | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [logType, setLogType] = useState<GyroLogType>('raw')
  const [fft, setFft] = useState<FftSettings>({ windowSize: 1024, windowsPerBatch: 1 })
  const [timeRange, setTimeRange] = useState<[number, number]>([0, 0])

  // ----- Filter settings -----
  const [params, setParams] = useState<FilterParams>(defaultFilterParams)
  const [filterVersion, setFilterVersion] = useState<FilterVersion>(1)
  const [paramMessage, setParamMessage] = useState<string | null>(null)

  // ----- Display -----
  const [amplitudeKind, setAmplitudeKind] = useState<AmplitudeKind>('dB')
  const [frequencySettings, setFrequencySettings] = useState<FrequencyScaleSettings>({ log: false, rpm: false })
  const [alias, setAlias] = useState<AliasMode>('none')
  const [phaseMode, setPhaseMode] = useState<PhaseMode>('unwrap')
  const [selections, setSelections] = useState<Selections>({ shown: new Set(), bodeGyro: 0, specGyro: 0, specKind: 'pre' })
  const [fftNotches, setFftNotches] = useState<ReadonlySet<NotchToggle>>(new Set())
  const [specNotches, setSpecNotches] = useState<ReadonlySet<NotchToggle>>(new Set(NOTCH_TOGGLES))
  const [specAxis, setSpecAxis] = useState<GyroAxis>('x')

  const amplitude = useMemo(
    () => fftAmplitudeScale({ dB: amplitudeKind === 'dB', psd: amplitudeKind === 'PSD' }),
    [amplitudeKind]
  )
  const frequency = useMemo(() => fftFrequencyScale(frequencySettings), [frequencySettings])

  /** Load gyro data with the chosen source and run the FFTs; errors are shown in the page. */
  const loadAndAnalyse = useCallback((log: DataflashLog, type: GyroLogType, settings: FftSettings, keepSettings: boolean) => {
    try {
      const next = loadFilterReviewLog(log, { logType: type })
      setLoaded(next)
      setLogType(next.gyro.type)
      setTimeRange([next.timeRange.start, next.timeRange.end])
      if (!keepSettings) {
        setParams(next.filterParams)
        setFilterVersion(next.filterVersion)
        setParamMessage(null)
      }
      setSelections(defaultSelections(next))
      setError(null)
      try {
        setAnalysis(analyseGyro(next.gyro, next.targets.all, settings))
      } catch (e) {
        setAnalysis(null)
        setError(errorMessage(e))
      }
    } catch (e) {
      setLoaded(null)
      setAnalysis(null)
      setError(errorMessage(e))
    }
  }, [])

  const { file, openFile } = useLogFile(async (buffer, name) => {
    await run(() => {
      let log: DataflashLog
      try {
        log = DataflashLog.parse(buffer)
      } catch (e) {
        setError(`Could not read the log: ${errorMessage(e)}`)
        return
      }
      setParsed({ log, name })
      document.title = name ? `Filter Review: ${name}` : 'Filter Review'
      loadAndAnalyse(log, logType, fft, false)
    }, 'Reading log')
  })

  const changeLogType = (type: GyroLogType) => {
    setLogType(type)
    if (parsed) void run(() => loadAndAnalyse(parsed.log, type, fft, true), 'Loading gyro data')
  }

  const changeFft = (settings: FftSettings) => {
    setFft(settings)
    if (!loaded) return
    void run(() => {
      try {
        setAnalysis(analyseGyro(loaded.gyro, loaded.targets.all, settings))
        setError(null)
      } catch (e) {
        setAnalysis(null)
        setError(errorMessage(e))
      }
    }, 'Calculating FFT')
  }

  // ----- Filter simulation; deferred so typing in the rail stays responsive -----
  const filterInput = useDeferredValue(useMemo(() => ({ params, version: filterVersion }), [params, filterVersion]))
  const filters = useMemo(
    () => (loaded ? buildFilters(filterInput.params, loaded.targets.all, filterInput.version) : null),
    [loaded, filterInput]
  )
  const instances: AnalysedInstance[] = useMemo(() => {
    if (!analysis) return []
    return analysis.instances.flatMap((a) =>
      a === null ? [] : [{ analysis: a, transfer: filters ? instanceTransfer(a, filters) : null }]
    )
  }, [analysis, filters])

  const range: TimeRange = useMemo(() => ({ start: timeRange[0], end: timeRange[1] }), [timeRange])
  const context = useMemo(() => (loaded ? trackingContext(loaded, filterInput.version) : null), [loaded, filterInput])

  // ----- Gyro choices -----
  const gyroLabel = useCallback(
    (sensor: number) => `Gyro ${sensor + 1}${loaded?.primaryFromEkf && loaded.primaryGyro === sensor ? ' (primary)' : ''}`,
    [loaded]
  )
  const sensors = useMemo(() => [...new Set(instances.map((i) => i.analysis.instance.sensorNum))].sort(), [instances])
  const gyros = sensors.map((sensor) => ({ sensor, label: gyroLabel(sensor) }))

  // ----- FFT plot -----
  const available = useMemo(() => {
    const out = new Set<SpectrumTraceKey>()
    for (const { analysis: a, transfer } of instances) {
      if (a.fft.x.length === 0) continue
      for (const axis of GYRO_AXES) {
        out.add(spectrumTraceKey(a.instance.sensorNum, a.instance.postFilter ? 'post' : 'pre', axis))
        if (transfer?.fft !== undefined) out.add(spectrumTraceKey(a.instance.sensorNum, 'est', axis))
      }
    }
    return out
  }, [instances])
  const fftData = useMemo(
    () =>
      spectrumTraces(instances, {
        amplitude,
        frequency,
        alias,
        loopRate: filterInput.params.loopRate,
        range,
        shown: selections.shown,
        quantizationNoise: loaded?.gyro.quantizationNoise ?? 0
      }),
    [instances, amplitude, frequency, alias, filterInput, range, selections.shown, loaded]
  )
  const fftLayout = useMemo(() => {
    const markers =
      filters && context
        ? filters.notches.map((n, i) => ({
            markers: notchMarkers(n, context, range),
            shown: fftNotches.has(NOTCH_TOGGLES[i] ?? 'notch1')
          }))
        : []
    return spectrumLayout(amplitude, frequency, notchShapes(markers, frequency))
  }, [filters, context, range, fftNotches, amplitude, frequency])

  // ----- Bode plot -----
  const bodeInstance = useMemo(() => {
    let found: AnalysedInstance | undefined
    for (const i of instances) {
      if (i.analysis.instance.sensorNum === selections.bodeGyro && i.analysis.bode && i.analysis.fft.x.length > 0) found = i
    }
    return found
  }, [instances, selections.bodeGyro])
  const bode = useMemo(() => {
    const transfer = bodeInstance?.transfer?.bode
    if (!bodeInstance?.analysis.bode || !transfer) return null
    return bodeResponse(bodeInstance.analysis.bode.freq, transfer, bodeInstance.analysis.fft.time, range)
  }, [bodeInstance, range])
  const bodeData = useMemo(() => {
    const phases = bode ? [bode.phaseMean, bode.phaseMax, bode.phaseMin] : null
    return bodeTraces(bode, phases && phaseMode === 'wrap' ? wrapPhase(phases) : phases, amplitude, frequency)
  }, [bode, phaseMode, amplitude, frequency])
  const bodeLayoutValue = useMemo(() => bodeLayout(amplitude, frequency, phaseMode === 'wrap'), [amplitude, frequency, phaseMode])
  const bodeGyros = gyros.map((g) => ({
    ...g,
    disabled: !instances.some((i) => i.analysis.instance.sensorNum === g.sensor && i.analysis.bode !== undefined)
  }))

  // ----- Spectrogram -----
  const specSelection = useMemo(() => {
    const post = selections.specKind === 'post'
    const match = instances.find(
      (i) =>
        i.analysis.fft.x.length > 0 &&
        i.analysis.instance.postFilter === post &&
        i.analysis.instance.sensorNum === selections.specGyro
    )
    if (!match) return null
    const transfer = match.transfer?.fft
    if (selections.specKind === 'est' && transfer === undefined) return null
    return {
      analysis: match.analysis,
      axis: specAxis,
      estimate:
        selections.specKind === 'est' && transfer !== undefined
          ? { transfer, quantizationNoise: loaded?.gyro.quantizationNoise ?? 0 }
          : null
    }
  }, [instances, selections.specKind, selections.specGyro, specAxis, loaded])
  const notchLines: NotchLineSet[] = useMemo(() => {
    if (!filters || !context || !loaded) return []
    return filters.notches.map((n, i) => {
      const logged = loaded.loggedNotches[i]
      return {
        name: n.name,
        lines: notchTrackingLines(n, context),
        logged: logged?.haveData() ? { name: logged.name, lines: loggedNotchLines(logged) } : null,
        shown: n.enabled && specNotches.has(NOTCH_TOGGLES[i] ?? 'notch1')
      }
    })
  }, [filters, context, loaded, specNotches])
  const specData = useMemo(
    () =>
      spectrogramTraces(specSelection, notchLines, specNotches.has('logged'), {
        amplitude,
        frequency,
        alias,
        loopRate: filterInput.params.loopRate
      }),
    [specSelection, notchLines, specNotches, amplitude, frequency, alias, filterInput]
  )
  const specLayout = useMemo(() => spectrogramLayout(frequency, loaded ? range : null), [frequency, loaded, range])

  // ----- Flight data -----
  const flightTraces = useMemo(() => flightDataTraces(loaded?.flight ?? null), [loaded])
  const flightLayout = useMemo(() => flightDataLayout(loaded ? timeRange : null), [loaded, timeRange])
  const onFlightRelayout = useCallback(
    (event: PlotRelayoutEvent) => {
      if (!loaded) return
      const r = relayoutRange(event)
      if (r === undefined) return
      setTimeRange(
        r === 'autorange' ? [loaded.timeRange.dataStart, loaded.timeRange.dataEnd] : [Math.floor(r[0]), Math.ceil(r[1])]
      )
    },
    [loaded]
  )

  // ----- Plot linking: every frequency axis zooms together -----
  const [plots, setPlots] = useState<Partial<Record<PlotName, PlotlyHTMLElement>>>({})
  const ready = useCallback(
    (name: PlotName) => (el: PlotlyHTMLElement) => setPlots((p) => (p[name] === el ? p : { ...p, [name]: el })),
    []
  )
  useEffect(() => {
    const { fft: fftPlot, bode: bodePlot, spec } = plots
    if (!fftPlot || !bodePlot || !spec) return
    const unlink = [
      linkAxisRanges([
        { element: fftPlot, axis: 'x' },
        { element: bodePlot, axis: 'x' },
        { element: bodePlot, axis: 'x', index: '2' },
        { element: spec, axis: 'y' }
      ]),
      linkAutorangeReset([fftPlot, bodePlot, spec])
    ]
    return () => unlink.forEach((u) => u())
  }, [plots])

  // ----- Parameters -----
  const sixteenHarmonics = loaded?.sixteenHarmonics ?? true
  const saveParams = () => downloadText('filter.param', filterParamFileText(params, sixteenHarmonics))
  const loadParams = (paramFile: File) => {
    void paramFile.text().then((text) => {
      const result = applyParamFile(text, params, sixteenHarmonics)
      setParams(result.params)
      setParamMessage(
        result.applied.length > 0
          ? `Applied ${result.applied.length} parameters from ${paramFile.name}.`
          : `No filter parameters found in ${paramFile.name}.`
      )
    })
  }
  const availableModes = useMemo(() => {
    const out = new Set<number>()
    if (!loaded) return out
    for (const t of loaded.targets.all) {
      if (t.modeValue !== null && t.haveData(undefined, filterVersion)) out.add(t.modeValue)
    }
    return out
  }, [loaded, filterVersion])

  const filterToolHref = useMemo(() => {
    if (!loaded) return null
    const gyro = loaded.gyro.instances.find((g) => g !== null && g.sensorNum === selections.bodeGyro)
    const t = loaded.targets
    const escRpm = t.esc.mean(range)
    return filterToolUrl(toolHref(toolById('filter-tool'), 'tool'), params, sixteenHarmonics, {
      gyroSampleRate: gyro?.gyroRate,
      throttle: t.throttle.mean(range),
      rpm1: t.rpm1.mean(range),
      escRpm,
      numMotors: t.esc.numMotors,
      rpm2: t.rpm2.mean(range)
    })
  }, [loaded, selections.bodeGyro, range, params, sixteenHarmonics])

  // ----- Warnings (upstream alerts) -----
  const warnings = useMemo(() => {
    const all = [
      ...(loaded?.warnings ?? []),
      ...(analysis?.warning ? [analysis.warning] : []),
      ...(filters?.notches.flatMap((n) => n.warnings) ?? [])
    ]
    return [...new Set(all)]
  }, [loaded, analysis, filters])

  // ----- Facts -----
  const fftInfo = useMemo(() => (analysis ? sensorFftInfo(analysis) : []), [analysis])
  const facts: LogFact[] | null = loaded
    ? [
        { label: 'File', value: parsed?.name ?? 'From another tool' },
        { label: 'Gyro data', value: loaded.gyro.type === 'raw' ? 'Raw IMU' : 'Batch sampling' },
        { label: 'Duration', value: `${(loaded.gyro.endTime - loaded.gyro.startTime).toFixed(0)} s` },
        ...loaded.sensors.map((s) => {
          const info = fftInfo[s.index]
          return {
            label: gyroLabel(s.index),
            value: (
              <>
                {gyroInfoText(s)}
                {info && (
                  <>
                    <br />
                    FFT {info.sampleRate.toFixed(2)} Hz, {info.resolution.toFixed(2)} Hz/bin
                  </>
                )}
              </>
            )
          }
        })
      ]
    : null

  const empty = <div className="apwt-empty">Open a log to see this plot</div>
  const notchEnabled: readonly [boolean, boolean] = [filters?.notches[0]?.enabled ?? false, filters?.notches[1]?.enabled ?? false]
  const loggedAvailable = loaded?.loggedNotches.some((l) => l.haveData()) ?? false
  const timeLimits: [number, number] | null = loaded ? [loaded.timeRange.dataStart, loaded.timeRange.dataEnd] : null

  return (
    <ToolPage
      title="Filter Review"
      readmeUrl="https://github.com/ArduPilot/WebTools/blob/main/FilterReview/Readme.md"
      intro={
        <>
          Gyro noise before and after the filters, from raw IMU or batch sampling logs. Change the low-pass and harmonic notch
          settings to see their effect without flying again.
        </>
      }
      actions={<OpenInButton file={file} messageTypes={parsed ? [...parsed.log.messageTypes().keys()] : null} />}
      rail={
        <Rail
          facts={facts}
          onFile={openFile}
          available={loaded?.available ?? null}
          logType={logType}
          onLogTypeChange={changeLogType}
          fft={fft}
          onFftChange={changeFft}
          timeRange={timeRange}
          timeLimits={timeLimits}
          onTimeRangeChange={setTimeRange}
          filterVersion={filterVersion}
          onFilterVersionChange={setFilterVersion}
          params={params}
          onParamsChange={setParams}
          harmonicCount={sixteenHarmonics ? 16 : 8}
          availableModes={availableModes}
          onSaveParams={saveParams}
          onLoadParams={loadParams}
          paramMessage={paramMessage}
          filterToolHref={filterToolHref}
        />
      }
    >
      <ErrorBanner message={error} />
      {warnings.length > 0 && (
        <ul className="fr-warnings" role="status">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      <Section title="Flight data" help="Zoom into part of the flight to set the analysis window.">
        <PlotlyChart
          className="apwt-plot apwt-plot--short"
          data={flightTraces}
          layout={flightLayout}
          onRelayout={onFlightRelayout}
        />
      </Section>

      <Section
        title="Gyro spectrum"
        help="Mean noise spectrum over the analysis window: logged before and after the filters, and estimated from the settings in the rail."
        tools={
          <>
            <ScaleChips
              amplitude={amplitudeKind}
              onAmplitudeChange={setAmplitudeKind}
              frequency={frequencySettings}
              onFrequencyChange={setFrequencySettings}
            />
            <AliasChips value={alias} onChange={setAlias} />
          </>
        }
      >
        {loaded ? (
          <>
            <TraceChips
              gyros={gyros}
              available={available}
              shown={selections.shown}
              onShownChange={(shown) => setSelections((s) => ({ ...s, shown }))}
            />
            <div className="fr-trace-row">
              <NotchChips value={fftNotches} onChange={setFftNotches} enabled={notchEnabled} />
            </div>
            <PlotlyChart className="apwt-plot" data={fftData} layout={fftLayout} onReady={ready('fft')} />
          </>
        ) : (
          empty
        )}
      </Section>

      <Section
        title="Filter response"
        help="Magnitude and phase of the configured filters, averaged over the analysis window; the band shows the range as notches track."
        tools={
          <>
            <ChipLabel>Gyro</ChipLabel>
            <GyroChips
              name="bode-gyro"
              gyros={bodeGyros}
              value={selections.bodeGyro}
              onChange={(bodeGyro) => setSelections((s) => ({ ...s, bodeGyro }))}
            />
            <ChipLabel>Phase</ChipLabel>
            <RadioChips
              name="phase"
              value={phaseMode}
              onChange={setPhaseMode}
              options={[
                { value: 'unwrap', label: 'Unwrapped' },
                { value: 'wrap', label: 'Wrapped' }
              ]}
            />
          </>
        }
      >
        {loaded ? (
          <PlotlyChart className="apwt-plot fr-plot--tall" data={bodeData} layout={bodeLayoutValue} onReady={ready('bode')} />
        ) : (
          empty
        )}
      </Section>

      <Section
        title="Spectrogram"
        help="How the noise changes through the analysis window, with the notch frequencies overlaid."
        tools={
          <>
            <ChipLabel>Gyro</ChipLabel>
            <GyroChips
              name="spec-gyro"
              gyros={gyros}
              value={selections.specGyro}
              onChange={(specGyro) => setSelections((s) => ({ ...s, specGyro }))}
            />
            <RadioChips
              name="spec-kind"
              value={selections.specKind}
              onChange={(specKind) => setSelections((s) => ({ ...s, specKind }))}
              options={[
                { value: 'pre', label: 'Pre-filter', disabled: !(loaded?.havePre ?? false) },
                { value: 'post', label: 'Post-filter', disabled: !(loaded?.havePost ?? false) },
                { value: 'est', label: 'Estimated post', disabled: !(loaded?.havePre ?? false) }
              ]}
            />
            <ChipLabel>Axis</ChipLabel>
            <AxisChips value={specAxis} onChange={setSpecAxis} />
            <NotchChips
              value={specNotches}
              onChange={setSpecNotches}
              enabled={notchEnabled}
              logged={{ available: loggedAvailable }}
            />
          </>
        }
      >
        {loaded ? (
          <>
            {!specSelection && <p className="fr-hint">No data for this gyro and source.</p>}
            <PlotlyChart className="apwt-plot" data={specData} layout={specLayout} onReady={ready('spec')} />
          </>
        ) : (
          empty
        )}
      </Section>
    </ToolPage>
  )
}
