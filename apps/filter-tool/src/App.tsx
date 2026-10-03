import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { PlotlyChart } from '@apwt/plot'
import { downloadText, ErrorBanner, Section, ToolPage } from '@apwt/tool-shell'
import { gyroBode, gyroFilters, pidBode, type GyroComponentKey } from './analysis/bode.js'
import { trackingSourcesInUse } from './analysis/config.js'
import { formatParamFile, parseParamFile } from './analysis/param-file.js'
import type { InputName } from './analysis/params.js'
import type { BodeSettings, PidSettings, ToolState } from './analysis/settings.js'
import { notchStatus } from './analysis/summary.js'
import { gyroRateProblem, loopRateProblem } from './analysis/validate.js'
import { BodeChips, FilteringChips } from './ui/BodeChips.js'
import { initialState, saveState, shareLink } from './ui/persist.js'
import { AXIS_LABELS, Rail, type FileStatus } from './ui/Rail.js'
import { bodeLayout, bodeTraces, type BodeSeries } from './ui/traces.js'

const COMPONENT_NAMES: Readonly<Record<GyroComponentKey, string>> = {
  INS_HNTCH: 'Notch 1',
  INS_HNTC2: 'Notch 2',
  lowPass: 'Gyro low pass'
}

// The clipboard API only exists on secure (https or localhost) pages.
const canCopy = 'clipboard' in navigator

export function App() {
  const [state, setState] = useState<ToolState>(initialState)
  const [fileStatus, setFileStatus] = useState<FileStatus>({ kind: 'idle' })
  const [error, setError] = useState<string | null>(null)
  const [linkCopied, setLinkCopied] = useState(false)

  // Remember the setup in this browser, as upstream did with cookies.
  useEffect(() => saveState(state), [state])

  const setInput = useCallback(
    (name: InputName, value: number) => setState((s) => ({ ...s, inputs: { ...s.inputs, [name]: value } })),
    []
  )
  const setGyroSettings = useCallback((gyro: BodeSettings) => setState((s) => ({ ...s, gyro })), [])
  const setPidSettings = useCallback((pid: PidSettings) => setState((s) => ({ ...s, pid })), [])

  // Plots follow the inputs without blocking typing.
  const shown = useDeferredValue(state)
  const { inputs, gyro: gyroSettings, pid: pidSettings } = shown

  // ----- Gyro filters -----
  const gyroProblem = gyroRateProblem(inputs)
  const gyro = useMemo(() => (gyroProblem === null ? gyroBode(inputs, gyroSettings) : null), [inputs, gyroSettings, gyroProblem])
  // Upstream only offers components when more than one filter is active.
  const gyroLegend = gyroSettings.showComponents && gyro !== null && gyro.enabledCount > 1
  const gyroTraces = useMemo(() => {
    if (!gyro) return []
    const series: BodeSeries[] = [
      { name: 'Combined', bode: gyro.total, visible: true },
      ...gyro.components.map((c) => ({ name: COMPONENT_NAMES[c.key], bode: c.bode, visible: gyroLegend && c.enabled }))
    ]
    return bodeTraces(gyro.freq, series, gyroSettings, gyroLegend)
  }, [gyro, gyroSettings, gyroLegend])
  const gyroLayout = useMemo(() => bodeLayout(gyroSettings, 'Magnitude', gyroLegend), [gyroSettings, gyroLegend])

  // ----- Rate PID -----
  const pidProblem = loopRateProblem(inputs, pidSettings.filtering === 'post')
  const pid = useMemo(
    () => (pidProblem === null ? pidBode(inputs, pidSettings.axis, pidSettings.filtering, pidSettings) : null),
    [inputs, pidSettings, pidProblem]
  )
  const pidLegend = pidSettings.showComponents
  const pidTraces = useMemo(() => {
    if (!pid) return []
    const series: BodeSeries[] = [
      { name: 'Combined', bode: pid.total, visible: true },
      { name: 'Gyro filters', bode: pid.gyro, visible: pidLegend },
      { name: 'Proportional', bode: pid.p, visible: pidLegend },
      { name: 'Integral', bode: pid.i, visible: pidLegend },
      { name: 'Derivative', bode: pid.d, visible: pidLegend }
    ]
    return bodeTraces(pid.freq, series, pidSettings, pidLegend)
  }, [pid, pidSettings, pidLegend])
  const pidLayout = useMemo(() => bodeLayout(pidSettings, 'Gain', pidLegend), [pidSettings, pidLegend])

  // ----- Rail status (from the live state so it tracks typing) -----
  const notchStatuses = useMemo(() => {
    const { notches } = gyroFilters(state.inputs, state.inputs.GyroSampleRate)
    return { INS_HNTCH: notchStatus(notches.INS_HNTCH), INS_HNTC2: notchStatus(notches.INS_HNTC2) }
  }, [state.inputs])
  const trackingSources = useMemo(() => trackingSourcesInUse(state.inputs), [state.inputs])

  // ----- Parameter file and link -----
  const loadFile = (file: File) => {
    void file.text().then((text) => {
      const parsed = parseParamFile(text)
      const count = Object.keys(parsed.values).length
      if (count === 0) {
        setError(`${file.name} has no filter or rate controller parameters. Choose an ArduPilot .param file.`)
        return
      }
      setError(null)
      setState((s) => ({ ...s, inputs: { ...s.inputs, ...parsed.values } }))
      setFileStatus({ kind: 'loaded', name: file.name, count })
    })
  }

  const copyLink = () => {
    void navigator.clipboard.writeText(shareLink(state)).then(() => {
      setLinkCopied(true)
      window.setTimeout(() => setLinkCopied(false), 2000)
    })
  }

  return (
    <ToolPage
      title="Filter Tool"
      readmeUrl="https://github.com/ArduPilot/WebTools/blob/main/FilterTool/Readme.md"
      intro={
        <>
          Attenuation and phase lag of an ArduPilot gyro filter setup, the low-pass and both harmonic notches, computed from
          parameter values without a log. Type values or load a <code>.param</code> file; hover any field for its full
          description.
        </>
      }
      rail={
        <Rail
          inputs={state.inputs}
          onInput={setInput}
          notchStatus={notchStatuses}
          trackingSources={trackingSources}
          axis={state.pid.axis}
          onAxis={(axis) => setPidSettings({ ...state.pid, axis })}
          fileStatus={fileStatus}
          onLoadFile={loadFile}
          onSaveFile={() => downloadText('filter.param', formatParamFile(state.inputs))}
          linkCopied={linkCopied}
          onCopyLink={canCopy ? copyLink : null}
        />
      }
    >
      <ErrorBanner message={error} />

      <Section
        title="Gyro filters"
        help="Combined response of the gyro low-pass and harmonic notches. Phase lag at your control frequencies costs stability."
        tools={
          <BodeChips
            id="gyro"
            settings={state.gyro}
            onChange={setGyroSettings}
            componentsLabel="Individual filters"
            componentsUnavailable={
              gyro !== null && gyro.enabledCount < 2 ? 'Enable more than one filter to compare them.' : undefined
            }
          />
        }
      >
        {gyroProblem !== null ? (
          <div className="apwt-empty">{gyroProblem}</div>
        ) : (
          <PlotlyChart className="apwt-plot ft-bode" data={gyroTraces} layout={gyroLayout} />
        )}
      </Section>

      <Section
        title={`Rate controller: ${AXIS_LABELS[state.pid.axis]}`}
        help="Gain and phase of the rate PID at the main loop rate, optionally including the gyro filters in front of it."
        tools={
          <>
            <FilteringChips settings={state.pid} onChange={setPidSettings} />
            <BodeChips id="pid" settings={state.pid} onChange={setPidSettings} componentsLabel="Individual terms" />
          </>
        }
      >
        {pidProblem !== null ? (
          <div className="apwt-empty">{pidProblem}</div>
        ) : (
          <PlotlyChart className="apwt-plot ft-bode" data={pidTraces} layout={pidLayout} />
        )}
      </Section>
    </ToolPage>
  )
}
