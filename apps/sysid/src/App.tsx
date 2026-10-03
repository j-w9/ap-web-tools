import { useCallback, useEffect, useMemo, useState } from 'react'
import { PlotlyChart, relayoutRange, type PlotRelayoutEvent } from '@apwt/plot'
import { ErrorBanner, OpenInButton, Section, ToolPage, useLoading, useLogFile, type LogFact } from '@apwt/tool-shell'
import { loadLog, type SysIdLog } from './analysis/log.js'
import { stateSpaceInputs, transferFunctionInputs } from './analysis/request.js'
import {
  INITIAL_SETUP,
  NO_LOG,
  generateFields,
  onLogLoaded,
  readSlot,
  selectModel,
  slotOwner,
  writeSlot,
  type OutputFields,
  type PickerOptions,
  type Setup,
  type SignalFields
} from './analysis/setup.js'
import {
  loadPython,
  runStateSpace,
  runTransferFunction,
  type PythonRuntime,
  type StateSpaceOutputs,
  type TransferFunctionOutputs
} from './python/runtime.js'
import { ConsolePanel } from './ui/ConsolePanel.js'
import { appendOutput, clearOutput } from './ui/console.js'
import { Rail, type PythonStatus } from './ui/Rail.js'
import type { PickerContext } from './ui/SignalPicker.js'
import { StateSpaceSetup } from './ui/StateSpaceSetup.js'
import {
  STATE_SPACE_LAYOUT,
  TRANSFER_FUNCTION_LAYOUT,
  flightDataLayout,
  flightDataTraces,
  stateSpaceTraces,
  transferFunctionTraces
} from './ui/traces.js'
import { TransferFunctionSetup } from './ui/TransferFunctionSetup.js'

const FLIGHT_LAYOUT = flightDataLayout()

/** Pyodide is loaded once per page, as upstream does on load. */
let pythonLoad: Promise<PythonRuntime> | null = null

function startPython(): Promise<PythonRuntime> {
  if (pythonLoad === null) {
    pythonLoad = loadPython(appendOutput)
    // Upstream's main() clears the output right after init_pyodide() has started, wiping its
    // first "Initializing Pyodide..." line.
    clearOutput()
  }
  return pythonLoad
}

/**
 * Error text for the banner. Python's own output (including tracebacks: upstream redirects
 * `sys.stderr` to the output, and Pyodide then raises with an empty message) is already in the
 * output; a traceback carried in the message is copied there too.
 */
function describe(error: unknown): string {
  const text = (error instanceof Error ? error.message : String(error)).trim()
  if (text === '') return 'Python raised an error. The traceback is in the output.'
  const lines = text.split('\n')
  if (lines.length <= 1) return text
  appendOutput(text)
  return `Python raised an error: ${lines[lines.length - 1] ?? text}. The full traceback is in the output.`
}

export function App() {
  const { run } = useLoading()
  const [sysLog, setSysLog] = useState<SysIdLog | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [setup, setSetup] = useState<Setup>(INITIAL_SETUP)
  const [error, setError] = useState<string | null>(null)
  const [alert, setAlert] = useState<string | null>(null)
  const [python, setPython] = useState<PythonRuntime | null>(null)
  const [pythonStatus, setPythonStatus] = useState<PythonStatus>('loading')
  const [tfResult, setTfResult] = useState<TransferFunctionOutputs | null>(null)
  const [ssResult, setSsResult] = useState<StateSpaceOutputs | null>(null)

  useEffect(() => {
    let live = true
    startPython().then(
      (py) => {
        if (!live) return
        setPython(py)
        setPythonStatus('ready')
      },
      (e: unknown) => {
        if (!live) return
        setPythonStatus('failed')
        setError(`Python could not be loaded: ${describe(e)} Check the network connection and reload the page.`)
      }
    )
    return () => {
      live = false
    }
  }, [])

  const options: PickerOptions = useMemo(() => {
    if (!sysLog) return NO_LOG
    const fields = new Map(sysLog.messages.map((m) => [m.name, m.fields]))
    return { loaded: true, fieldsOf: (m) => fields.get(m), hasMessage: (m) => fields.has(m) }
  }, [sysLog])
  const context: PickerContext = useMemo(
    () => ({ options, messages: sysLog?.messages.map((m) => m.name) ?? [] }),
    [options, sysLog]
  )

  const { file, openFile } = useLogFile(async (buffer, name) => {
    await run(() => {
      try {
        const loaded = loadLog(buffer)
        setError(null)
        setSysLog(loaded)
        setFileName(name)
        setSetup((s) => {
          const filled = onLogLoaded(s)
          const range = loaded.timeRange
          return range ? { ...filled, startTime: String(range[0]), endTime: String(range[1]) } : filled
        })
        if (name) document.title = `SysID: ${name}`
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    }, 'Reading log')
  })

  const onFlightRelayout = useCallback((event: PlotRelayoutEvent) => {
    const r = relayoutRange(event)
    // Upstream only follows explicit ranges; resetting the zoom leaves the times as they are.
    if (r === undefined || r === 'autorange') return
    setSetup((s) => ({ ...s, startTime: String(Math.floor(r[0])), endTime: String(Math.ceil(r[1])) }))
  }, [])

  const submit = () => {
    if (!sysLog) return
    setError(null)
    setAlert(null)
    const requirePython = (): PythonRuntime => {
      if (!python) throw new Error('Python is still loading. Wait for "Python ready" and submit again.')
      return python
    }
    switch (setup.model) {
      case null:
        return
      case 'transfer-function':
        appendOutput('File Submitted successfully. Please wait!!!!!!')
        void run(() => {
          try {
            const inputs = transferFunctionInputs(sysLog.log, setup)
            setTfResult(runTransferFunction(requirePython(), inputs))
          } catch (e) {
            setError(describe(e))
          }
        }, 'Identifying transfer function')
        return
      case 'state-space': {
        const request = (() => {
          try {
            return stateSpaceInputs(sysLog.log, setup)
          } catch (e) {
            setError(describe(e))
            return null
          }
        })()
        if (!request) return
        if (!request.ok) {
          setAlert(request.alert)
          return
        }
        void run(() => {
          try {
            setSsResult(runStateSpace(requirePython(), request.inputs))
          } catch (e) {
            setError(describe(e))
          }
        }, 'Identifying state space model')
        return
      }
    }
  }

  const generate = () => {
    setAlert(null)
    const outcome = generateFields(setup, options)
    setSetup(outcome.setup)
    setAlert(outcome.alert)
    setError(outcome.error)
  }

  const flightTraces = useMemo(() => flightDataTraces(sysLog?.flight ?? null), [sysLog])
  const tfTraces = useMemo(() => (tfResult ? transferFunctionTraces(tfResult) : []), [tfResult])
  const ssTraces = useMemo(() => (ssResult ? stateSpaceTraces(ssResult) : []), [ssResult])

  const tfSignals = setup.tfSignals
  const ssOutputCount = setup.ss.signals?.outputs.length ?? 0
  const ssInput = readSlot(setup, { kind: 'input' }) ?? null
  const ssOutputs = Array.from({ length: ssOutputCount }, (_, index) => readSlot(setup, { kind: 'output', index }) ?? null)
  const shared = setup.ss.signals !== null && slotOwner(setup, { kind: 'input' }) === 'tf'

  const facts: LogFact[] | null = sysLog
    ? [
        { label: 'File', value: fileName ?? 'From another tool' },
        { label: 'Messages', value: String(sysLog.messages.length) },
        ...(sysLog.timeRange
          ? [{ label: 'Flight data', value: `${sysLog.timeRange[0].toFixed(1)} to ${sysLog.timeRange[1].toFixed(1)} s` }]
          : [])
      ]
    : null

  return (
    <ToolPage
      title="System Identification"
      readmeUrl="https://github.com/ArduPilot/WebTools/tree/main/SysID"
      intro={
        <>
          Identify a transfer function or state space model of the vehicle from a <code>.bin</code> log of a System ID mode
          flight. The fit runs pyAircraftIden in Python in the browser; the page may freeze while it works.
        </>
      }
      actions={<OpenInButton file={file} messageTypes={sysLog?.messageTypes ?? null} />}
      rail={
        <Rail
          facts={facts}
          onFile={openFile}
          setup={setup}
          onTextChange={(key, value) => setSetup((s) => ({ ...s, [key]: value }))}
          onModelChange={(model) => setSetup((s) => selectModel(s, model, options))}
          python={pythonStatus}
          submitEnabled={sysLog !== null && setup.model !== null}
          onSubmit={submit}
        />
      }
    >
      <ErrorBanner message={error} />
      {alert && (
        <div className="sysid-alert" role="alert">
          {alert}
        </div>
      )}

      <Section title="Flight data" help="Zoom into the identification run to set the analysis time.">
        <PlotlyChart
          className="apwt-plot apwt-plot--short"
          data={flightTraces}
          layout={FLIGHT_LAYOUT}
          onRelayout={onFlightRelayout}
        />
      </Section>

      <Section title="Output" help="Progress and results printed by the Python identification.">
        <ConsolePanel />
      </Section>

      {setup.model === null && (
        <Section title="Model" help="Choose a transfer function or a state space model in the rail.">
          <div className="apwt-empty">Pick a model type to set up the identification</div>
        </Section>
      )}

      {setup.model === 'transfer-function' && tfSignals && (
        <>
          <Section title="Transfer function" help="Pick the input and output signals and write the model in s.">
            <TransferFunctionSetup
              context={context}
              input={tfSignals.input}
              output={tfSignals.output}
              form={setup.tf}
              onInputChange={(f: SignalFields) => setSetup((s) => writeSlot(s, { kind: 'input' }, (o) => ({ ...o, ...f })))}
              onOutputChange={(f: OutputFields) => setSetup((s) => writeSlot(s, { kind: 'output', index: 0 }, () => f))}
              onFormChange={(tf) => setSetup((s) => ({ ...s, tf }))}
            />
          </Section>
          <Section title="Frequency response" help="Measured and fitted response, and the coherence of the measurement.">
            {tfResult ? (
              <PlotlyChart className="apwt-plot sysid-result-plot" data={tfTraces} layout={TRANSFER_FUNCTION_LAYOUT} />
            ) : (
              <div className="apwt-empty">Submit to identify the transfer function</div>
            )}
          </Section>
        </>
      )}

      {setup.model === 'state-space' && (
        <>
          <Section title="State space" help="Choose a preset or enter the sizes, generate the fields, then fill in the matrices.">
            {shared && (
              <p className="apwt-section__help sysid-note">
                Input 1 and Output 1 are shared with the transfer function form, as in the original tool.
              </p>
            )}
            <StateSpaceSetup
              context={context}
              form={setup.ss}
              input={setup.ss.signals ? ssInput : null}
              outputs={ssOutputs}
              onFormChange={(ss) => setSetup((s) => ({ ...s, ss }))}
              onInputChange={(f) => setSetup((s) => writeSlot(s, { kind: 'input' }, (o) => ({ ...o, ...f })))}
              onOutputChange={(index, f) => setSetup((s) => writeSlot(s, { kind: 'output', index }, () => f))}
              onGenerate={generate}
            />
          </Section>
          <Section title="Frequency response" help="Measured (Hs) and estimated (Hest) response, and coherence, per output.">
            {ssResult ? (
              <PlotlyChart className="apwt-plot sysid-result-plot" data={ssTraces} layout={STATE_SPACE_LAYOUT} />
            ) : (
              <div className="apwt-empty">Submit to identify the state space model</div>
            )}
          </Section>
        </>
      )}
    </ToolPage>
  )
}
