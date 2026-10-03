import { useState, type ReactNode } from 'react'

export interface NumberFieldProps {
  label: ReactNode
  value: number
  onChange: (value: number) => void
  disabled?: boolean
  title?: string | undefined
  step?: number | undefined
  min?: number | undefined
  max?: number | undefined
  /** Shown after the input, e.g. a unit. */
  suffix?: string | null | undefined
}

/**
 * A labelled number input. It keeps the text being typed, so the field can be cleared or hold a
 * lone minus sign, and reports only finite numbers.
 */
export function NumberField({ label, value, onChange, disabled, title, step, min, max, suffix }: NumberFieldProps) {
  const [draft, setDraft] = useState<{ text: string; value: number } | null>(null)
  // Show the draft only while it still describes the current value.
  const text = draft && (draft.value === value || Number.isNaN(draft.value)) ? draft.text : String(value)
  return (
    <label className="apwt-field" title={title}>
      <span>{label}</span>
      <span className="kt-input">
        <input
          type="number"
          value={text}
          step={step ?? 'any'}
          min={min}
          max={max}
          disabled={disabled}
          onChange={(e) => {
            const parsed = e.target.value === '' ? NaN : Number(e.target.value)
            setDraft({ text: e.target.value, value: parsed })
            if (Number.isFinite(parsed)) onChange(parsed)
          }}
          onBlur={() => setDraft(null)}
        />
        {suffix && <span className="kt-unit">{suffix}</span>}
      </span>
    </label>
  )
}
