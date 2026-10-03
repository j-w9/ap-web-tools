import { Chip, RadioChips } from '@apwt/tool-shell'
import type { CompensationAxis } from '../analysis/prepare.js'
import {
  fieldOptions,
  messageOptions,
  withMessage,
  type OutputFields,
  type PickerOptions,
  type SignalFields
} from '../analysis/setup.js'

interface SelectProps {
  label: string
  value: string
  options: readonly string[]
  disabled: boolean
  onChange: (value: string) => void
}

function Select({ label, value, options, disabled, onChange }: SelectProps) {
  return (
    <label className="apwt-field sysid-select">
      <span>{label}</span>
      <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
        {/* A value with no matching option shows as an empty selection, as upstream's select does. */}
        {!options.includes(value) && <option value={value} hidden />}
      </select>
    </label>
  )
}

export interface PickerContext {
  readonly options: PickerOptions
  readonly messages: readonly string[]
}

interface MessageFieldProps {
  context: PickerContext
  fields: SignalFields
  onChange: (fields: SignalFields) => void
}

function MessageField({ context, fields, onChange }: MessageFieldProps) {
  const messages = messageOptions(context.options, context.messages)
  return (
    <div className="sysid-picker__selects">
      <Select
        label="Message"
        value={fields.message}
        options={messages}
        disabled={messages.length === 0}
        onChange={(message) => onChange(withMessage(fields, message))}
      />
      <Select
        label="Field"
        value={fields.field}
        options={fieldOptions(context.options, fields.message)}
        disabled={!context.options.hasMessage(fields.message)}
        onChange={(field) => onChange({ ...fields, field })}
      />
    </div>
  )
}

export interface InputPickerProps {
  label: string
  context: PickerContext
  fields: SignalFields
  onChange: (fields: SignalFields) => void
}

/** Upstream "Input n": a message and one of its fields. */
export function InputPicker({ label, context, fields, onChange }: InputPickerProps) {
  return (
    <div className="sysid-picker">
      <div className="sysid-picker__label">{label}</div>
      <MessageField context={context} fields={fields} onChange={onChange} />
    </div>
  )
}

export interface OutputPickerProps {
  label: string
  context: PickerContext
  fields: OutputFields
  onChange: (fields: OutputFields) => void
}

const AXES: readonly { value: CompensationAxis; label: string }[] = [
  { value: 'Roll', label: 'Roll' },
  { value: 'Pitch', label: 'Pitch' }
]

/** Upstream "Output n": message and field, optional multiplier and gravity compensation. */
export function OutputPicker({ label, context, fields, onChange }: OutputPickerProps) {
  return (
    <div className="sysid-picker">
      <div className="sysid-picker__label">{label}</div>
      <MessageField context={context} fields={fields} onChange={(f) => onChange({ ...fields, ...f })} />
      <div className="sysid-picker__options">
        <Chip type="checkbox" checked={fields.multiplierOn} onChange={(multiplierOn) => onChange({ ...fields, multiplierOn })}>
          Multiplier
        </Chip>
        {fields.multiplierOn && (
          <input
            type="text"
            className="apwt-input"
            aria-label={`${label} multiplier`}
            value={fields.multiplier}
            onChange={(e) => onChange({ ...fields, multiplier: e.target.value })}
          />
        )}
        <Chip
          type="checkbox"
          checked={fields.compensationOn}
          onChange={(compensationOn) => onChange({ ...fields, compensationOn })}
        >
          Gravity compensation
        </Chip>
        {fields.compensationOn && (
          <RadioChips
            name={`${label}-axis`}
            options={AXES}
            value={fields.compensationAxis}
            onChange={(compensationAxis) => onChange({ ...fields, compensationAxis })}
          />
        )}
      </div>
    </div>
  )
}
