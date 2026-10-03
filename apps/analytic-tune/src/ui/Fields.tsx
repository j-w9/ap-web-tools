import { useId, useState, type ReactNode } from 'react'
import { CheckChips } from '@apwt/tool-shell'
import { PARAM_METADATA, type ParamMetadata } from '../analysis/metadata.js'
import type { ParamName } from '../analysis/params.js'

/**
 * A value as an unfocused field shows it: at most 7 significant digits, the precision of the
 * float parameters ArduPilot logs, so e.g. 0.20000000298023224 reads 0.2 and fits the field.
 * Display only: the full value is used, saved and shown while the field has focus.
 */
export function displayNumber(value: number): string {
  const full = String(value)
  return full.length <= 10 ? full : String(Number(value.toPrecision(7)))
}

interface NumberInputProps {
  id?: string | undefined
  value: number
  step: number
  disabled?: boolean | undefined
  min?: number | undefined
  onChange: (value: number) => void
}

/**
 * A number input that lets the user type freely (empty, "0.", "-"), reporting numbers as they are
 * typed. Upstream reads its inputs with `parseFloat` when they change, so an input left empty (or
 * holding text the browser does not accept as a number) computes with NaN: that is reported when
 * the input loses focus. The draft lives only while the user is typing, so values set from outside
 * (a loaded log or file) always show.
 */
export function NumberInput({ id, value, step, disabled, min, onChange }: NumberInputProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const [focused, setFocused] = useState(false)
  return (
    <input
      id={id}
      type="number"
      step={step}
      min={min}
      disabled={disabled}
      value={draft ?? (Number.isNaN(value) ? '' : focused ? String(value) : displayNumber(value))}
      onFocus={() => setFocused(true)}
      onChange={(e) => {
        setDraft(e.target.value)
        const v = parseFloat(e.target.value)
        if (Number.isFinite(v)) onChange(v)
      }}
      onBlur={(e) => {
        setDraft(null)
        setFocused(false)
        if (e.target.value === '' && !Number.isNaN(value)) onChange(NaN)
      }}
    />
  )
}

function FieldName({ code, label, units }: { code?: string | undefined; label: string; units?: string | undefined }) {
  return (
    <span className="at-param__name">
      {code !== undefined && <code>{code}</code>}
      <small>
        {label}
        {units !== undefined && ` (${units})`}
      </small>
    </span>
  )
}

function describe(meta: ParamMetadata): string {
  const range = meta.range ? `\nRange: ${meta.range.low} to ${meta.range.high}` : ''
  return `${meta.displayName}\n\n${meta.description}${range}`
}

export interface ParamFieldProps {
  name: ParamName
  label: string
  value: number
  step: number
  disabled?: boolean | undefined
  onChange: (name: ParamName, value: number) => void
  /** Shorter labels for bitmask bits, by bit number. */
  bitLabels?: readonly string[]
}

/** One ArduPilot parameter, edited according to its metadata; the full description is the tooltip. */
export function ParamField({ name, label, value, step, disabled, onChange, bitLabels }: ParamFieldProps) {
  const meta = PARAM_METADATA[name]
  const id = useId()
  const set = (v: number) => onChange(name, v)

  const field = (control: ReactNode, units: string | undefined) => (
    <label className="apwt-field at-param" htmlFor={id} title={describe(meta)}>
      <FieldName code={name} label={label} units={units} />
      {control}
    </label>
  )

  switch (meta.kind) {
    case 'values': {
      // Upstream's drop-down holds only its options; a value it could not take shows empty (NaN).
      const known = meta.values.some((o) => o.value === value)
      return field(
        <select id={id} value={known ? value : ''} disabled={disabled} onChange={(e) => set(Number(e.target.value))}>
          {!known && <option value="" />}
          {meta.values.map((o) => (
            <option key={o.value} value={o.value}>
              {o.value}: {o.label}
            </option>
          ))}
        </select>,
        undefined
      )
    }
    case 'bitmask': {
      const selected = new Set(meta.bits.filter((b) => (value & (1 << b.bit)) !== 0).map((b) => String(b.bit)))
      return (
        <>
          {field(<NumberInput id={id} value={value} step={1} disabled={disabled} onChange={set} />, meta.units)}
          <div className="at-bits">
            <CheckChips
              value={selected}
              options={meta.bits.map((b) => ({
                value: String(b.bit),
                label: bitLabels?.[b.bit] ?? b.label,
                title: b.label,
                disabled: disabled ?? false
              }))}
              // Rebuild the value from the shown bits, as upstream's checkboxes do.
              onChange={(bits) => set(meta.bits.reduce((v, b) => (bits.has(String(b.bit)) ? v | (1 << b.bit) : v), 0))}
            />
          </div>
        </>
      )
    }
    case 'number':
      return field(<NumberInput id={id} value={value} step={step} disabled={disabled} onChange={set} />, meta.units)
  }
}

export interface PlainFieldProps {
  label: string
  units?: string | undefined
  help: string
  value: number
  step: number
  onChange: (value: number) => void
}

/** An input that is not an ArduPilot parameter, such as the gyro rate or an RPM. */
export function PlainField({ label, units, help, value, step, onChange }: PlainFieldProps) {
  const id = useId()
  return (
    <label className="apwt-field at-param" htmlFor={id} title={help}>
      <FieldName label={label} units={units} />
      <NumberInput id={id} value={value} step={step} onChange={onChange} />
    </label>
  )
}
