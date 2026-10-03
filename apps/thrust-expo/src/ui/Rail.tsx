import { useEffect, useRef } from 'react'
import { Download, FlaskConical, RotateCcw, Sparkles } from 'lucide-react'
import { ControlGroup, LogInput, RailCard, type LogFact } from '@apwt/tool-shell'
import { INPUTS, PARAM_METADATA, type InputName } from '../analysis/params.js'
import type { ExpoSetting } from '../analysis/linearisation.js'
import type { FieldName } from '../analysis/session.js'

export interface RailProps {
  facts: readonly LogFact[] | null
  onParamFile: (file: File) => void
  /** Text each input shows. */
  display: Readonly<Record<FieldName, string>>
  /** Changes with every session event, so the inputs re-sync their text. */
  revision: number
  /** Whether the expo was kept as entered (true) or fitted at the last plot update; null without data. */
  expoSetting: ExpoSetting['kind'] | null
  onCommit: (name: FieldName, text: string) => void
  onSpinMinInput: (text: string) => void
  onRefit: () => void
  onSave: () => void
  onExample: () => void
  onReset: () => void
}

interface FieldProps {
  name: FieldName
  /** The ArduPilot parameter name, shown in mono above the label; omitted for inputs that are not parameters. */
  param?: string
  label: string
  title: string
  display: string
  revision: number
  onCommit: (name: FieldName, text: string) => void
  onInput?: (text: string) => void
  disabled?: boolean
}

/**
 * A number input that reports its value on the native `change` event (Enter, leaving the field
 * or the spinner), as upstream's handlers listen for, and optionally on every keystroke. Its
 * text follows `display` after every session event.
 */
function Field({ name, param, label, title, display, revision, onCommit, onInput, disabled = false }: FieldProps) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const input = ref.current
    if (input !== null && input.value !== display) input.value = display
  }, [display, revision])
  useEffect(() => {
    const input = ref.current
    if (input === null) return
    const commit = () => onCommit(name, input.value)
    const typed = () => onInput?.(input.value)
    input.addEventListener('change', commit)
    input.addEventListener('input', typed)
    return () => {
      input.removeEventListener('change', commit)
      input.removeEventListener('input', typed)
    }
  }, [name, onCommit, onInput])
  const spec = name === 'MOT_THST_HOVER' ? null : INPUTS[name]
  return (
    <label className="apwt-field te-field" title={title}>
      <span className="te-field__name">
        {param !== undefined && <code>{param}</code>}
        <small>{label}</small>
      </span>
      <input
        ref={ref}
        type="number"
        defaultValue={display}
        disabled={disabled}
        {...(spec ? { step: spec.step } : { placeholder: '?' })}
        {...(spec && 'min' in spec ? { min: spec.min } : {})}
        {...(spec && 'max' in spec ? { max: spec.max } : {})}
      />
    </label>
  )
}

type MotParamInput = Exclude<InputName, 'MOTOR_COUNT' | 'COPTER_AUW'> | 'MOT_THST_HOVER'

/** Short sentence-case labels; the full metadata description is each field's tooltip. */
const PARAM_LABELS: Readonly<Record<MotParamInput, string>> = {
  MOT_SPIN_ARM: 'Spin when armed',
  MOT_SPIN_MIN: 'Spin minimum',
  MOT_SPIN_MAX: 'Spin maximum',
  MOT_PWM_MIN: 'PWM output minimum',
  MOT_PWM_MAX: 'PWM output maximum',
  MOT_THST_EXPO: 'Thrust curve expo',
  MOT_THST_HOVER: 'Thrust at hover'
}

/** Label for a motor parameter input, with units when it has them. */
function paramLabel(name: MotParamInput): string {
  const meta = PARAM_METADATA[name]
  return 'units' in meta ? `${PARAM_LABELS[name]} (${meta.units})` : PARAM_LABELS[name]
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
            param={name}
            label={paramLabel(name)}
            title={PARAM_METADATA[name].description}
            display={p.display[name]}
            revision={p.revision}
            onCommit={p.onCommit}
            {...(name === 'MOT_SPIN_MIN' ? { onInput: p.onSpinMinInput } : {})}
          />
        ))}
      </ControlGroup>

      <ControlGroup label="Thrust expo">
        <Field
          name="MOT_THST_EXPO"
          param="MOT_THST_EXPO"
          label={paramLabel('MOT_THST_EXPO')}
          title={PARAM_METADATA.MOT_THST_EXPO.description}
          display={p.display.MOT_THST_EXPO}
          revision={p.revision}
          onCommit={p.onCommit}
        />
        <p className="te-note">
          {p.expoSetting === 'fixed'
            ? 'Your value. Editing any other input fits it again.'
            : 'Fitted for the most linear thrust once there is data. Type a value to try your own.'}
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
          display={p.display.MOTOR_COUNT}
          revision={p.revision}
          onCommit={p.onCommit}
        />
        <Field
          name="COPTER_AUW"
          label="All-up weight"
          title="All-up weight (AUW) including battery and payload. Must be same units as measured thrust."
          display={p.display.COPTER_AUW}
          revision={p.revision}
          onCommit={p.onCommit}
        />
        <Field
          name="MOT_THST_HOVER"
          param="MOT_THST_HOVER"
          label={paramLabel('MOT_THST_HOVER')}
          title={PARAM_METADATA.MOT_THST_HOVER.description}
          display={p.display.MOT_THST_HOVER}
          revision={p.revision}
          onCommit={p.onCommit}
          disabled
        />
        <p className="te-note">
          Optional. Prefer <code>MOT_HOVER_LEARN</code> over setting this; the learned value helps validate the thrust curve.
        </p>
      </ControlGroup>

      <div className="apwt-group">
        <button type="button" className="apwt-btn apwt-btn--primary apwt-btn--block" onClick={p.onSave}>
          <Download />
          Save parameters
        </button>
        <div className="te-buttons">
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
