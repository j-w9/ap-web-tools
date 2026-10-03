import { useId, useState, type ReactNode } from 'react'
import { CheckChips } from '@apwt/tool-shell'
import { hasBit } from '../analysis/config.js'
import { PARAM_METADATA, type ParamMetadata } from '../analysis/metadata.js'
import type { ParamName } from '../analysis/params.js'

interface NumberInputProps {
  id?: string | undefined
  value: number
  step: number
  disabled?: boolean | undefined
  title?: string | undefined
  list?: string | undefined
  onChange: (value: number) => void
}

/**
 * A number input that lets the user type freely (empty, "0.", "-") and only reports finite
 * numbers. The draft lives only while the user is typing, so values set from outside (a loaded
 * file) always show.
 */
export function NumberInput({ id, value, step, disabled, title, list, onChange }: NumberInputProps) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <input
      id={id}
      type="number"
      step={step}
      disabled={disabled}
      title={title}
      list={list}
      value={draft ?? String(value)}
      onChange={(e) => {
        setDraft(e.target.value)
        const v = parseFloat(e.target.value)
        if (Number.isFinite(v)) onChange(v)
      }}
      onBlur={() => setDraft(null)}
    />
  )
}

function FieldName({ code, label, units }: { code?: string | undefined; label: string; units?: string | undefined }) {
  return (
    <span className="ft-param__name">
      {code !== undefined && <code>{code}</code>}
      <small>
        {label}
        {units !== undefined && ` (${units})`}
      </small>
    </span>
  )
}

export interface ParamFieldProps {
  name: ParamName
  label: string
  value: number
  step: number
  disabled?: boolean | undefined
  onChange: (name: ParamName, value: number) => void
  /** Show enumerated values as suggestions on a free number input instead of a list. */
  freeValues?: boolean
  /** Shorter labels for bitmask bits, by bit number. */
  bitLabels?: readonly string[]
}

function describe(meta: ParamMetadata): string {
  const range = meta.range ? `\nRange: ${meta.range.low} to ${meta.range.high}` : ''
  return `${meta.displayName}\n\n${meta.description}${range}`
}

/** One ArduPilot parameter, edited according to its metadata. */
export function ParamField({ name, label, value, step, disabled, onChange, freeValues, bitLabels }: ParamFieldProps) {
  const meta = PARAM_METADATA[name]
  const id = useId()
  const title = describe(meta)
  const set = (v: number) => onChange(name, v)
  const units = meta.kind === 'values' && !freeValues ? undefined : meta.units

  const field = (control: ReactNode) => (
    <label className="apwt-field ft-param" htmlFor={id} title={title}>
      <FieldName code={name} label={label} units={units} />
      {control}
    </label>
  )

  switch (meta.kind) {
    case 'values': {
      if (freeValues) {
        const listId = `${id}-values`
        return (
          <>
            {field(<NumberInput id={id} value={value} step={step} disabled={disabled} list={listId} onChange={set} />)}
            <datalist id={listId}>
              {meta.values.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </datalist>
          </>
        )
      }
      const known = meta.values.some((o) => o.value === value)
      return field(
        <select id={id} value={value} disabled={disabled} onChange={(e) => set(Number(e.target.value))}>
          {!known && <option value={value}>{value}: other</option>}
          {meta.values.map((o) => (
            <option key={o.value} value={o.value}>
              {o.value}: {o.label}
            </option>
          ))}
        </select>
      )
    }
    case 'bitmask': {
      const selected = new Set(meta.bits.filter((b) => hasBit(value, b.bit)).map((b) => String(b.bit)))
      return (
        <>
          {field(<NumberInput id={id} value={value} step={1} disabled={disabled} onChange={set} />)}
          <div className="ft-bits">
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
      return field(<NumberInput id={id} value={value} step={step} disabled={disabled} onChange={set} />)
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

/** An input that is not an ArduPilot parameter, such as the gyro rate or a simulated RPM. */
export function PlainField({ label, units, help, value, step, onChange }: PlainFieldProps) {
  const id = useId()
  return (
    <label className="apwt-field ft-param" htmlFor={id} title={help}>
      <FieldName label={label} units={units} />
      <NumberInput id={id} value={value} step={step} onChange={onChange} />
    </label>
  )
}
