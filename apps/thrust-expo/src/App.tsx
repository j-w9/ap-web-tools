import { useCallback, useMemo, useState } from 'react'
import { PlotlyChart } from '@apwt/plot'
import { downloadText, ErrorBanner, Section, ToolPage, type LogFact } from '@apwt/tool-shell'
import {
  PARAM_FILE_NAME,
  commitInput,
  createSession,
  loadExample,
  loadParamFile,
  paramFileText,
  refit,
  reset,
  savedParams,
  setRows,
  typeSpinMin,
  type FieldName
} from './analysis/session.js'
import type { TableRow } from './analysis/thrust-table.js'
import { ParamSummary } from './ui/ParamSummary.js'
import { Rail } from './ui/Rail.js'
import { ThrustTable } from './ui/ThrustTable.js'
import { EXPO_LAYOUT, expoTraces, gradientLayout, gradientTraces, pwmLayout, pwmTraces } from './ui/traces.js'

export function App() {
  const [session, setSession] = useState(createSession)
  const [paramFileName, setParamFileName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const onCommit = useCallback((name: FieldName, text: string) => setSession((s) => commitInput(s, name, text)), [])
  const onSpinMinInput = useCallback((text: string) => setSession((s) => typeSpinMin(s, text)), [])
  const onRowsChange = (rows: readonly TableRow[]) => setSession((s) => setRows(s, rows))

  const onReset = () => {
    setSession(reset)
    setParamFileName(null)
    setError(null)
  }

  const openParamFile = (file: File) => {
    void file.text().then((text) => {
      setParamFileName(file.name)
      setSession((s) => loadParamFile(s, text))
    })
  }

  const onSave = () => {
    try {
      downloadText(PARAM_FILE_NAME, paramFileText(session))
      setError(null)
    } catch (e) {
      // Upstream's param_to_string throws for a value that is not a number; no file is written.
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const { plot } = session
  const lin = plot.kind === 'data' ? plot.lin : null
  const hover = plot.kind === 'data' ? plot.hover : null
  const pwmData = useMemo(() => (plot.kind === 'data' ? pwmTraces(plot.rows) : []), [plot])
  const pwmPlotLayout = useMemo(() => (plot.kind === 'data' ? pwmLayout(plot.spin) : null), [plot])
  const expoData = useMemo(() => expoTraces(lin, hover), [lin, hover])
  const gradientData = useMemo(() => gradientTraces(lin), [lin])
  const gradientPlotLayout = useMemo(() => gradientLayout(lin), [lin])

  const facts: LogFact[] | null = paramFileName ? [{ label: 'File', value: paramFileName }] : null
  const usableCount = plot.kind === 'data' ? plot.rows.length : 0

  const empty = <div className="apwt-empty">Enter or paste test stand data above, or press Example in the rail</div>

  return (
    <ToolPage
      title="Thrust Expo"
      readmeUrl="https://github.com/ArduPilot/WebTools/tree/main/ThrustExpo"
      intro={
        <>
          Fit <code>MOT_THST_EXPO</code> from thrust test stand data so thrust rises linearly with throttle. Load a parameter file
          or enter the parameters, then paste the stand data from a spreadsheet. Current data is optional (for reference only, not
          used in the calculation). Adjust the expo to improve the fit, but do not chase a perfect match at the extremes: midrange
          linearity matters most.
        </>
      }
      rail={
        <Rail
          facts={facts}
          onParamFile={openParamFile}
          display={session.display}
          revision={session.revision}
          expoSetting={lin ? lin.setting : null}
          onCommit={onCommit}
          onSpinMinInput={onSpinMinInput}
          onRefit={() => setSession(refit)}
          onSave={onSave}
          onExample={() => setSession(loadExample)}
          onReset={onReset}
        />
      }
    >
      <ErrorBanner message={session.error ?? error} />

      <Section
        title="Test stand data"
        help="Select cells and paste a range from a spreadsheet, or double-click (or press Enter) to edit a cell. Delete clears the selection; Ctrl+C copies it. Voltage and current are for reference only and are not used in the fit."
      >
        <ThrustTable rows={session.rows} onRowsChange={onRowsChange} />
        <p className="apwt-section__help" style={{ marginTop: 8 }}>
          {usableCount} {usableCount === 1 ? 'row' : 'rows'} used
        </p>
      </Section>

      <Section title="Thrust against ESC signal" help="Measured thrust over the PWM output range, with the spin points marked.">
        {pwmPlotLayout ? <PlotlyChart className="apwt-plot" data={pwmData} layout={pwmPlotLayout} /> : empty}
      </Section>

      <Section
        title="Thrust against throttle"
        help="Measured thrust, and thrust once ArduPilot applies the expo. The linearised line should be as straight as possible."
      >
        {lin ? <PlotlyChart className="apwt-plot" data={expoData} layout={EXPO_LAYOUT} /> : empty}
      </Section>

      <Section
        title="Thrust gradient"
        help="Slope of the linearised thrust. A good expo keeps it close to the dashed mean; the fit minimises its standard deviation."
      >
        {lin ? <PlotlyChart className="apwt-plot" data={gradientData} layout={gradientPlotLayout} /> : empty}
      </Section>

      <Section title="Parameters" help={`The values Save parameters writes to ${PARAM_FILE_NAME}.`}>
        <ParamSummary saved={savedParams(session)} expoSetting={lin ? lin.setting : null} />
      </Section>
    </ToolPage>
  )
}
