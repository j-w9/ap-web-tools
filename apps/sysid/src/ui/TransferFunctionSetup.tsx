import type { TransferFunctionForm } from '../analysis/setup.js'
import type { OutputFields, SignalFields } from '../analysis/setup.js'
import { InputPicker, OutputPicker, type PickerContext } from './SignalPicker.js'

export interface TransferFunctionSetupProps {
  context: PickerContext
  input: SignalFields
  output: OutputFields
  form: TransferFunctionForm
  onInputChange: (fields: SignalFields) => void
  onOutputChange: (fields: OutputFields) => void
  onFormChange: (form: TransferFunctionForm) => void
}

/** Upstream transfer function form: one input, one output, and the model as sympy expressions. */
export function TransferFunctionSetup(p: TransferFunctionSetupProps) {
  const text = (label: string, key: keyof TransferFunctionForm, placeholder: string) => (
    <label className="apwt-field sysid-wide-field">
      <span>{label}</span>
      <input
        type="text"
        value={p.form[key]}
        placeholder={placeholder}
        onChange={(e) => p.onFormChange({ ...p.form, [key]: e.target.value })}
      />
    </label>
  )
  return (
    <div className="sysid-setup">
      <div className="sysid-pickers">
        <InputPicker label="Input 1" context={p.context} fields={p.input} onChange={p.onInputChange} />
        <OutputPicker label="Output 1" context={p.context} fields={p.output} onChange={p.onOutputChange} />
      </div>
      <div className="sysid-model-fields">
        {text('Numerator', 'numerator', 'e.g. b1*s + b0')}
        {text('Denominator', 'denominator', 'e.g. a2*s**2 + a1*s + a0')}
        {text('Symbolic params', 'params', 'e.g. b1 b0 a2 a1 a0')}
      </div>
    </div>
  )
}
