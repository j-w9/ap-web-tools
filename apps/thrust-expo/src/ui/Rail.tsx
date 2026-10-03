import { Download, FlaskConical, RotateCcw, Sparkles } from 'lucide-react'
import { ControlGroup, LogInput, RailCard, type LogFact } from '@apwt/tool-shell'
import { INPUTS, PARAM_METADATA, type InputName } from '../analysis/params.js'
import type { ExpoSetting, HoverEstimate } from '../analysis/linearisation.js'
import type { InputText } from './inputs.js'

export interface RailProps {
  facts: readonly LogFact[] | null
  onParamFile: (file: File) => void
  inputs: InputText
  /** What the expo input shows: the user's text, or the fitted value. */
  expoText: string
  expoSetting: ExpoSetting['kind']
  hover: HoverEstimate | null
  onInputChange: (name: InputName, text: string) => void
  /** Apply the MOT_SPIN_MIN constraint when a spin input loses focus. */
  onSpinBlur: () => void
  onRefit: () => void
  saveDisabledReason: string | null
  onSave: () => void
  onExample: () => void
  onReset: () => void
}

interface FieldProps {
  name: InputName
  label: string
  title: string
  value: string
  onChange: (name: InputName, text: string) => void
  onBlur?: () => void
}

function Field({ name, label, title, value, onChange, onBlur }: FieldProps) {
  const spec = INPUTS[name]
  return (
    <label className="apwt-field" title={title}>
      <span>{label}</span>
      <input
        type="number"
        step={spec.step}
        min={'min' in spec ? spec.min : undefined}
        max={'max' in spec ? spec.max : undefined}
        value={value}
        onChange={(e) => onChange(name, e.target.value)}
        onBlur={onBlur}
      />
    </label>
  )
}

type MotParamInput = Exclude<InputName, 'MOTOR_COUNT' | 'COPTER_AUW'>

/** Label for a motor parameter input: the name, with units when it has them. */
function paramLabel(name: MotParamInput): string {
  const meta = PARAM_METADATA[name]
  return 'units' in meta ? `${name} (${meta.units})` : name
}

const OUTPUT_PARAMS = [
  'MOT_SPIN_ARM',
  'MOT_SPIN_MIN',
  'MOT_SPIN_MAX',
  'MOT_PWM_MIN',
  'MOT_PWM_MAX'
] as const satisfies readonly MotParamInput[]

/** The control rail: parameter file, motor parameters, expo, hover inputs and actions. */
export function Rail(p: RailProps) {
  return (
    <RailCard>
      <ControlGroup label="Parameter file">
        <LogInput
          changeLabel="Open another parameter file"
          facts={p.facts}
          onFile={p.onParamFile}
          accept=".param,.parm,.txt"
          title="Open a parameter file"
          hint="Optional: or enter the parameters below"
        />
      </ControlGroup>

      <ControlGroup label="Motor output">
        {OUTPUT_PARAMS.map((name) => (
          <Field
            key={name}
            name={name}
            label={paramLabel(name)}
            title={PARAM_METADATA[name].description}
            value={p.inputs[name]}
            onChange={p.onInputChange}
            {...(name === 'MOT_SPIN_ARM' || name === 'MOT_SPIN_MIN' ? { onBlur: p.onSpinBlur } : {})}
          />
        ))}
      </ControlGroup>

      <ControlGroup label="Thrust expo">
        <Field
          name="MOT_THST_EXPO"
          label="MOT_THST_EXPO"
          title={PARAM_METADATA.MOT_THST_EXPO.description}
          value={p.expoText}
          onChange={p.onInputChange}
        />
        <p className="apwt-section__help" style={{ fontSize: 13 }}>
          {p.expoSetting === 'fit'
            ? 'Fitted for the most linear thrust. Type a value to try your own.'
            : 'Your value. Editing any other input fits it again.'}
        </p>
        {p.expoSetting === 'fixed' && (
          <button type="button" className="apwt-btn apwt-btn--ghost apwt-btn--block" onClick={p.onRefit}>
            <Sparkles />
            Fit to data
          </button>
        )}
      </ControlGroup>

      <ControlGroup label="Hover thrust estimate">
        <Field
          name="MOTOR_COUNT"
          label="Number of motors"
          title="Number of thrust producing motors."
          value={p.inputs.MOTOR_COUNT}
          onChange={p.onInputChange}
        />
        <Field
          name="COPTER_AUW"
          label="All-up weight"
          title="All-up weight (AUW) including battery and payload. Must be same units as measured thrust."
          value={p.inputs.COPTER_AUW}
          onChange={p.onInputChange}
        />
        <label className="apwt-field" title={PARAM_METADATA.MOT_THST_HOVER.description}>
          <span>MOT_THST_HOVER</span>
          <input type="number" disabled placeholder="?" value={p.hover ? p.hover.motThstHover.toFixed(3) : ''} readOnly />
        </label>
        <p className="apwt-section__help" style={{ fontSize: 13 }}>
          Optional. Prefer <code>MOT_HOVER_LEARN</code> over setting this; the learned value helps validate the thrust curve.
        </p>
      </ControlGroup>

      <div className="apwt-group">
        <button
          type="button"
          className="apwt-btn apwt-btn--primary apwt-btn--block"
          disabled={p.saveDisabledReason !== null}
          title={p.saveDisabledReason ?? undefined}
          onClick={p.onSave}
        >
          <Download />
          Save parameters
        </button>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button
            type="button"
            className="apwt-btn apwt-btn--block"
            title="Show example data (replaces the table)"
            onClick={p.onExample}
          >
            <FlaskConical />
            Example
          </button>
          <button
            type="button"
            className="apwt-btn apwt-btn--block"
            title="Clear the data and reset every input"
            onClick={p.onReset}
          >
            <RotateCcw />
            Reset
          </button>
        </div>
      </div>
    </RailCard>
  )
}
