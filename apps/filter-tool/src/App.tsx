import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { PlotlyChart } from '@apwt/plot'
import { downloadText, ErrorBanner, Section, ToolPage } from '@apwt/tool-shell'
import { gyroBode, pidBode } from './analysis/bode.js'
import { trackingSourcesShown } from './analysis/config.js'
import { formatParamFile, parseParamFile } from './analysis/param-file.js'
import type { InputName } from './analysis/params.js'
import type { BodeSettings, PidSettings, ToolState } from './analysis/settings.js'
import { attempt } from './analysis/validate.js'
import { BodeChips, FilteringChips } from './ui/BodeChips.js'
import { initialState, saveState, shareLink } from './ui/persist.js'
import { AXIS_LABELS, Rail, type FileStatus } from './ui/Rail.js'
import { gyroPlot, pidPlot } from './ui/traces.js'

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
  const gyroResult = useMemo(() => attempt(() => gyroBode(inputs, gyroSettings)), [inputs, gyroSettings])
  const gyro = gyroResult.ok ? gyroResult.value : null
  const gyroChart = useMemo(() => (gyro ? gyroPlot(gyro, gyroSettings) : null), [gyro, gyroSettings])

  // ----- Rate PID -----
  const pidResult = useMemo(
    () => attempt(() => pidBode(inputs, pidSettings.axis, pidSettings.filtering, pidSettings)),
    [inputs, pidSettings]
  )
  const pid = pidResult.ok ? pidResult.value : null
  const pidChart = useMemo(() => (pid ? pidPlot(pid, pidSettings) : null), [pid, pidSettings])

  // ----- Rail status (from the live state so it tracks typing) -----
  const trackingSources = useMemo(() => trackingSourcesShown(state.inputs), [state.inputs])

  // ----- Parameter file and link -----
  const loadFile = (file: File) => {
    void file.text().then((text) => {
      const values = parseParamFile(text)
      const count = Object.keys(values).length
      if (count === 0) {
        setError(`${file.name} sets none of this tool's inputs. Choose an ArduPilot .param file.`)
        return
      }
      setError(null)
      setState((s) => ({ ...s, inputs: { ...s.inputs, ...values } }))
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
              gyro !== null && gyro.enabledCount < 2 ? 'Shown once more than one filter is enabled.' : undefined
            }
          />
        }
      >
        {!gyroResult.ok ? (
          <div className="apwt-empty">Calculation failed: {gyroResult.message}</div>
        ) : (
          gyroChart && <PlotlyChart className="apwt-plot ft-bode" data={gyroChart.data} layout={gyroChart.layout} />
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
        {!pidResult.ok ? (
          <div className="apwt-empty">Calculation failed: {pidResult.message}</div>
        ) : (
          pidChart && <PlotlyChart className="apwt-plot ft-bode" data={pidChart.data} layout={pidChart.layout} />
        )}
      </Section>
    </ToolPage>
  )
}
