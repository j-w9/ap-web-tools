import { useDeferredValue, useMemo, useState } from 'react'
import { PlotlyChart } from '@apwt/plot'
import { ErrorBanner, Section, ToolPage, type LogFact } from '@apwt/tool-shell'
import { estimateHover, linearise, type ExpoSetting } from './analysis/linearisation.js'
import { PARAM_FILE_NAME, buildParamFile, invalidSavedParams, parseParamFile, type SavedParams } from './analysis/param-file.js'
import type { InputName } from './analysis/params.js'
import {
  EXAMPLE_ALL_UP_WEIGHT,
  EXAMPLE_SAMPLES,
  emptyRows,
  rowsFromSamples,
  thrustData,
  type TableRow
} from './analysis/thrust-table.js'
import { downloadText } from './ui/download.js'
import { constrainSpinMin, defaultInputText, parseInputs, withParamFile, type InputText } from './ui/inputs.js'
import { ParamSummary } from './ui/ParamSummary.js'
import { Rail } from './ui/Rail.js'
import { ThrustTable } from './ui/ThrustTable.js'
import { EXPO_LAYOUT, expoTraces, gradientLayout, gradientTraces, pwmLayout, pwmTraces } from './ui/traces.js'

interface LoadedParamFile {
  readonly name: string
  readonly count: number
}

export function App() {
  // ----- Inputs -----
  const [inputs, setInputs] = useState<InputText>(defaultInputText)
  /** Upstream refits on every change except an edit of MOT_THST_EXPO itself, which fixes the expo. */
  const [expoKind, setExpoKind] = useState<ExpoSetting['kind']>('fit')
  const [rows, setRows] = useState<readonly TableRow[]>(() => emptyRows())
  const [paramFile, setParamFile] = useState<LoadedParamFile | null>(null)
  const [error, setError] = useState<string | null>(null)

  const onInputChange = (name: InputName, text: string) => {
    setInputs((current) => ({ ...current, [name]: text }))
    setExpoKind(name === 'MOT_THST_EXPO' ? 'fixed' : 'fit')
  }
  const onRowsChange = (next: readonly TableRow[]) => {
    setRows(next)
    setExpoKind('fit')
  }

  const reset = () => {
    setInputs(defaultInputText())
    setExpoKind('fit')
    setRows(emptyRows())
    setParamFile(null)
    setError(null)
  }

  const loadExample = () => {
    setRows(rowsFromSamples(EXAMPLE_SAMPLES))
    setInputs((current) => ({ ...current, COPTER_AUW: String(EXAMPLE_ALL_UP_WEIGHT) }))
    setExpoKind('fit')
  }

  const openParamFile = (file: File) => {
    void file.text().then((text) => {
      const parsed = parseParamFile(text)
      if (parsed.count === 0) {
        setError(`${file.name} sets none of the MOT_ parameters this tool uses. Choose a parameter file saved from your vehicle.`)
        return
      }
      setError(null)
      setInputs((current) => withParamFile(current, parsed))
      setExpoKind(parsed.expoFixed ? 'fixed' : 'fit')
      setParamFile({ name: file.name, count: parsed.count })
    })
  }

  // ----- Analysis (deferred so typing stays responsive while the expo is refitted) -----
  const values = useMemo(() => parseInputs(inputs), [inputs])
  const data = useMemo(() => thrustData(rows), [rows])
  const deferredValues = useDeferredValue(values)
  const deferredData = useDeferredValue(data)
  const deferredKind = useDeferredValue(expoKind)
  const lin = useMemo(() => {
    const v = deferredValues
    const setting: ExpoSetting = deferredKind === 'fixed' ? { kind: 'fixed', expo: v.MOT_THST_EXPO } : { kind: 'fit' }
    return linearise(
      deferredData,
      { spinMin: v.MOT_SPIN_MIN, spinMax: v.MOT_SPIN_MAX, pwmMin: v.MOT_PWM_MIN, pwmMax: v.MOT_PWM_MAX },
      setting
    )
  }, [deferredValues, deferredData, deferredKind])
  const hover = lin ? estimateHover(lin, deferredValues.COPTER_AUW, deferredValues.MOTOR_COUNT) : null

  const expoText = expoKind === 'fixed' || !lin ? inputs.MOT_THST_EXPO : lin.result.expo.toFixed(3)

  const saved: SavedParams = {
    values: {
      MOT_SPIN_ARM: values.MOT_SPIN_ARM,
      MOT_SPIN_MIN: values.MOT_SPIN_MIN,
      MOT_SPIN_MAX: values.MOT_SPIN_MAX,
      MOT_PWM_MIN: values.MOT_PWM_MIN,
      MOT_PWM_MAX: values.MOT_PWM_MAX,
      MOT_THST_EXPO: lin ? lin.result.expo : values.MOT_THST_EXPO
    },
    motThstHover: hover?.motThstHover ?? null
  }
  const invalid = invalidSavedParams(saved)
  const saveDisabledReason = invalid.length > 0 ? `Enter a number for ${invalid.join(', ')}` : null

  // ----- Plots -----
  const spin = useMemo(
    () => ({
      spinArm: values.MOT_SPIN_ARM,
      spinMin: values.MOT_SPIN_MIN,
      spinMax: values.MOT_SPIN_MAX,
      pwmMin: values.MOT_PWM_MIN,
      pwmMax: values.MOT_PWM_MAX
    }),
    [values]
  )
  const hasData = data.pwm.length > 0
  const pwmData = useMemo(() => pwmTraces(data), [data])
  const pwmPlotLayout = useMemo(() => pwmLayout(spin, hasData), [spin, hasData])
  const expoData = useMemo(() => expoTraces(lin, hover), [lin, hover])
  const gradientData = useMemo(() => gradientTraces(lin), [lin])
  const gradientPlotLayout = useMemo(() => gradientLayout(lin), [lin])

  const facts: LogFact[] | null = paramFile
    ? [
        { label: 'File', value: paramFile.name },
        { label: 'Parameters used', value: paramFile.count }
      ]
    : null

  const empty = <div className="apwt-empty">Enter or paste test stand data above, or press Example in the rail</div>

  return (
    <ToolPage
      title="Thrust Expo"
      readmeUrl="https://github.com/ArduPilot/WebTools/tree/main/ThrustExpo"
      intro={
        <>
          Fit <code>MOT_THST_EXPO</code> from thrust test stand data so thrust rises linearly with throttle. Load a parameter file
          or enter the parameters, then paste the stand data from a spreadsheet. Adjust the expo to improve the fit, but do not
          chase a perfect match at the extremes: midrange linearity matters most.
        </>
      }
      rail={
        <Rail
          facts={facts}
          onParamFile={openParamFile}
          inputs={inputs}
          expoText={expoText}
          expoSetting={expoKind}
          hover={hover}
          onInputChange={onInputChange}
          onSpinBlur={() => setInputs(constrainSpinMin)}
          onRefit={() => setExpoKind('fit')}
          saveDisabledReason={saveDisabledReason}
          onSave={() => downloadText(buildParamFile(saved), PARAM_FILE_NAME)}
          onExample={loadExample}
          onReset={reset}
        />
      }
    >
      <ErrorBanner message={error} />

      <Section
        title="Test stand data"
        help="Paste a range from a spreadsheet into any cell, or type values. Voltage and current are for reference only and are not used in the fit."
      >
        <ThrustTable rows={rows} onRowsChange={onRowsChange} />
        <p className="apwt-section__help" style={{ marginTop: 8 }}>
          {data.pwm.length} {data.pwm.length === 1 ? 'row' : 'rows'} with both an ESC signal and a thrust
        </p>
      </Section>

      <Section title="Thrust against ESC signal" help="Measured thrust over the PWM output range, with the spin points marked.">
        {hasData ? <PlotlyChart className="apwt-plot" data={pwmData} layout={pwmPlotLayout} /> : empty}
      </Section>

      <Section
        title="Thrust against throttle"
        help="Measured thrust, and thrust once ArduPilot applies the expo. The linearised line should be as straight as possible."
      >
        {hasData ? <PlotlyChart className="apwt-plot" data={expoData} layout={EXPO_LAYOUT} /> : empty}
      </Section>

      <Section
        title="Thrust gradient"
        help="Slope of the linearised thrust. A good expo keeps it close to the dashed mean; the fit minimises its standard deviation."
      >
        {hasData ? <PlotlyChart className="apwt-plot" data={gradientData} layout={gradientPlotLayout} /> : empty}
      </Section>

      <Section title="Parameters" help={`The values Save parameters writes to ${PARAM_FILE_NAME}.`}>
        <ParamSummary values={saved.values} motThstHover={saved.motThstHover} expoSetting={lin ? lin.setting : null} />
      </Section>
    </ToolPage>
  )
}
