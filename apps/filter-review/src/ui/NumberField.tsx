import { useState } from 'react'

export interface NumberFieldProps {
  label: string
  value: number
  onChange: (value: number) => void
  step?: number
  min?: number
  max?: number
  disabled?: boolean
  /** Tooltip, e.g. the parameter name. */
  title?: string
}

/**
 * A labelled number input that only reports parseable values, so a field can be cleared and
 * retyped without the value snapping to zero.
 */
export function NumberField({ label, value, onChange, step, min, max, disabled, title }: NumberFieldProps) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <label className="apwt-field" title={title}>
      <span>{label}</span>
      <input
        type="number"
        step={step ?? 'any'}
        min={min}
        max={max}
        disabled={disabled}
        value={draft ?? String(value)}
        onChange={(e) => {
          setDraft(e.target.value)
          const parsed = parseFloat(e.target.value)
          if (Number.isFinite(parsed)) onChange(parsed)
        }}
        onBlur={() => setDraft(null)}
      />
    </label>
  )
}
