import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { linkAutorangeReset, linkAxisRanges, relayoutRange, type PlotRelayoutEvent, type PlotlyHTMLElement } from '@apwt/plot'
import { DataflashLog } from '@apwt/dataflash'
import { wrapPhase } from '@apwt/filters'
import { fftAmplitudeScale, fftFrequencyScale, type AmplitudeKind } from '@apwt/signal'
import {
  downloadText,
  ErrorBanner,
  OpenInButton,
  RadioChips,
  Section,
  ToolPage,
  toolById,
  toolHref,
  useLatest,
  useLoading,
  useLogFile,
  type LogFact
} from '@apwt/tool-shell'
import { instanceTransfer, sensorFftInfo } from './analysis/analyse.js'
import { GYRO_AXES, type GyroAxis } from './analysis/fft/batch-fft.js'
import { buildFilters } from './analysis/filters/filter-set.js'
import { filterToolUrl, filterToolValues } from './analysis/filter-tool-link.js'
import type { FilterVersion } from './analysis/filter-version.js'
import type { GyroLogType } from './analysis/gyro-data.js'
import { gyroInfoText } from './analysis/gyro-sensors.js'
import { trackingContext, type FilterReviewLog } from './analysis/load.js'
import {
  defaultPageValues,
  filterParamsFromPage,
  withPageValue,
  type FilterParamName,
  type PageValues
} from './analysis/page-values.js'
import { applyParamFile, filterParamFileText } from './analysis/param-file.js'
import type { AliasMode } from './analysis/plots/alias.js'
import { bodeResponse } from './analysis/plots/bode.js'
import { loggedNotchLines, notchMarkers, notchTrackingLines } from './analysis/plots/notch-lines.js'
import type { Selections } from './analysis/selections.js'
import { calculate, loadIntoPage, windowSizeAfter, type AnalysisResult } from './analysis/session.js'
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
import { Chart, compactFlightLayout, withEmptyNote } from './ui/Chart.js'
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
  type SpectrumTraceKey
} from './ui/traces.js'

type PlotName = 'fft' | 'bode' | 'spec'
type PhaseMode = 'unwrap' | 'wrap'

const NOTCH_TOGGLES = ['notch1', 'notch2'] as const

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function App() {
  const { run } = useLoading()

  // ----- Log and analysis -----
  const [parsed, setParsed] = useState<{ log: DataflashLog; name: string | null } | null>(null)
  const [loaded, setLoaded] = useState<FilterReviewLog | null>(null)
  // "Batch" / "Raw sensor" radios: chosen before loading, then set to the type the log used
  const [logTypeChoice, setLogTypeChoice] = useState<GyroLogType>('raw')
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Page inputs kept as the strings upstream's inputs hold; they carry over to the next log
  const [fft, setFft] = useState<FftSettings>({ windowSize: '1024', windowsPerBatch: '1' })
  const [values, setValues] = useState<PageValues>(defaultPageValues)
  const [timeRange, setTimeRange] = useState<[number, number]>([0, 0])

  // ----- Filter settings -----
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
  const analysis = result?.analysis ?? null

  const inputs = useLatest({ values, ...fft })
  const logTypeChosen = useLatest(logTypeChoice)
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
      try {
        const page = loadIntoPage(inputs.current, log, logTypeChosen.current === 'batch')
        setLoaded(page.log)
        setLogTypeChoice(page.log.gyro.type)
        setResult(page.result)
        setValues(page.inputs.values)
        setFft({ windowSize: page.inputs.windowSize, windowsPerBatch: page.inputs.windowsPerBatch })
        setTimeRange([page.timeRange[0], page.timeRange[1]])
        setSelections(page.selections)
        setFilterVersion(page.log.filterVersion)
        setParamMessage(null)
        setError(null)
      } catch (e) {
        setLoaded(null)
        setLogTypeChoice('raw')
        setResult(null)
        setError(errorMessage(e))
      }
    }, 'Reading log')
  })

  /** Changing an FFT input recalculates (upstream clears the FFTs and waits for Calculate). */
  const changeFft = (settings: FftSettings) => {
    setFft(settings)
    if (!loaded) return
    void run(() => {
      const next = calculate(loaded, settings)
      setResult(next)
      setFft({ ...settings, windowSize: windowSizeAfter(next, settings.windowSize) })
    }, 'Calculating FFT')
  }

  // ----- Filter simulation; deferred so typing in the rail stays responsive -----
  const sixteenHarmonics = loaded?.sixteenHarmonics ?? true
  const params = useMemo(() => filterParamsFromPage(values, sixteenHarmonics), [values, sixteenHarmonics])
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
    (sensor: number) => `Gyro ${sensor + 1}${loaded?.ekfPrimary === sensor ? ' (primary)' : ''}`,
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
  // Upstream throws (and stops drawing) when aliasing meets an unusable loop rate; shown here
  const [fftData, plotError] = useMemo((): [ReturnType<typeof spectrumTraces>, string | null] => {
    try {
      return [
        spectrumTraces(instances, {
          amplitude,
          frequency,
          alias,
          loopRate: filterInput.params.loopRate,
          range,
          shown: selections.shown,
          quantizationNoise: loaded?.gyro.quantizationNoise ?? 0
        }),
        null
      ]
    } catch (e) {
      return [[], errorMessage(e)]
    }
  }, [instances, amplitude, frequency, alias, filterInput, range, selections.shown, loaded])
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
  const specData = useMemo(() => {
    try {
      return spectrogramTraces(specSelection, notchLines, specNotches.has('logged'), {
        amplitude,
        frequency,
        alias,
        loopRate: filterInput.params.loopRate
      })
    } catch {
      return spectrogramTraces(null, notchLines, specNotches.has('logged'), {
        amplitude,
        frequency,
        alias: 'none',
        loopRate: filterInput.params.loopRate
      })
    }
  }, [specSelection, notchLines, specNotches, amplitude, frequency, alias, filterInput])
  const specLayout = useMemo(() => spectrogramLayout(frequency, loaded ? range : null), [frequency, loaded, range])

  // ----- Flight data -----
  const flightTraces = useMemo(() => flightDataTraces(loaded?.flight ?? null), [loaded])
  const flightLayout = useMemo(
    () =>
      withEmptyNote(
        flightDataLayout(loaded ? timeRange : null),
        loaded && Object.keys(loaded.flight).length === 0 ? 'No attitude, throttle or altitude in this log.' : null
      ),
    [loaded, timeRange]
  )
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
  const changeValue = (name: FilterParamName, value: string | number) => setValues((v) => withPageValue(v, name, value))
  const saveParams = () => downloadText('filter.param', filterParamFileText(values))
  const loadParams = (paramFile: File) => {
    void paramFile.text().then((text) => {
      const { assignments, skipped } = applyParamFile(text)
      let next = values
      for (const a of assignments) {
        if (a.kind === 'param') {
          next = { ...next, [a.name]: a.value }
          continue
        }
        // Inputs looked up by id like the parameters; window sizes take effect at the next calculation
        switch (a.name) {
          case 'TimeStart':
            setTimeRange((r) => [parseFloat(a.value), r[1]])
            break
          case 'TimeEnd':
            setTimeRange((r) => [r[0], parseFloat(a.value)])
            break
          case 'FFTWindow_size':
            setFft((f) => ({ ...f, windowSize: a.value }))
            break
          case 'FFTWindow_per_batch':
            setFft((f) => ({ ...f, windowsPerBatch: a.value }))
            break
        }
      }
      setValues(next)
      const skippedNote = skipped.length > 0 ? ` Skipped (file inputs cannot be set): ${skipped.join('; ')}.` : ''
      setParamMessage(`Applied ${assignments.length} lines from ${paramFile.name}.${skippedNote}`)
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

  const filterToolHref = useMemo(
    () =>
      loaded
        ? filterToolUrl(toolHref(toolById('filter-tool'), 'tool'), values, filterToolValues(loaded, selections.bodeGyro, range))
        : null,
    [loaded, selections.bodeGyro, range, values]
  )

  // ----- Warnings (upstream alerts) -----
  const warnings = useMemo(() => {
    const all = [
      ...(loaded?.warnings ?? []),
      ...(result?.error ? [result.error] : []),
      ...(analysis?.warning ? [analysis.warning] : []),
      ...(filters?.notches.flatMap((n) => n.warnings) ?? [])
    ]
    return [...new Set(all)]
  }, [loaded, result, analysis, filters])

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
          logType={loaded?.gyro.type ?? null}
          logTypeChoice={logTypeChoice}
          onLogTypeChange={setLogTypeChoice}
          fft={fft}
          onFftChange={changeFft}
          timeRange={timeRange}
          timeLimits={timeLimits}
          onTimeRangeChange={setTimeRange}
          filterVersion={filterVersion}
          onFilterVersionChange={setFilterVersion}
          values={values}
          onValueChange={changeValue}
          sixteenHarmonics={sixteenHarmonics}
          availableModes={availableModes}
          onSaveParams={saveParams}
          onLoadParams={loadParams}
          paramMessage={paramMessage}
          filterToolHref={filterToolHref}
        />
      }
    >
      <ErrorBanner message={error ?? plotError} />
      {warnings.length > 0 && (
        <ul className="fr-warnings" role="status">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      <Section title="Flight data" help="Zoom into part of the flight to set the analysis window.">
        <Chart
          className="apwt-plot apwt-plot--short"
          data={flightTraces}
          layout={flightLayout}
          compact={compactFlightLayout}
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
            <Chart className="apwt-plot" data={fftData} layout={fftLayout} onReady={ready('fft')} />
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
            <GyroChips
              name="bode-gyro"
              label="Gyro"
              gyros={bodeGyros}
              value={selections.bodeGyro}
              onChange={(bodeGyro) => setSelections((s) => ({ ...s, bodeGyro }))}
            />
            <RadioChips
              name="phase"
              label="Phase"
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
          <Chart className="apwt-plot fr-plot--tall" data={bodeData} layout={bodeLayoutValue} onReady={ready('bode')} />
        ) : (
          empty
        )}
      </Section>

      <Section
        title="Spectrogram"
        help="How the noise changes through the analysis window, with the notch frequencies overlaid."
        tools={
          <>
            <GyroChips
              name="spec-gyro"
              label="Gyro"
              gyros={gyros}
              value={selections.specGyro}
              onChange={(specGyro) => setSelections((s) => ({ ...s, specGyro }))}
            />
            <RadioChips
              name="spec-kind"
              label="Source"
              value={selections.specKind}
              onChange={(specKind) => setSelections((s) => ({ ...s, specKind }))}
              options={[
                { value: 'pre', label: 'Pre-filter', disabled: !(loaded?.havePre ?? false) },
                { value: 'post', label: 'Post-filter', disabled: !(loaded?.havePost ?? false) },
                { value: 'est', label: 'Estimated post', disabled: !(loaded?.havePre ?? false) }
              ]}
            />
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
            <Chart className="apwt-plot" data={specData} layout={specLayout} onReady={ready('spec')} />
          </>
        ) : (
          empty
        )}
      </Section>
    </ToolPage>
  )
}
