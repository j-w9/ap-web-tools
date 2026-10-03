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

/** Upstream reads every input with `parseFloat(input.value)`; an empty or invalid field gives NaN. */
function parseInput(text: string): number {
  return parseFloat(text)
}

/**
 * A labelled number input. As a convenience, finite values apply while typing; anything else
 * (an empty field, a lone minus sign) applies as NaN when the edit is committed (blur or Enter),
 * which is when upstream's `onchange` would have read it.
 */
export function NumberField({ label, value, onChange, disabled, title, step, min, max, suffix }: NumberFieldProps) {
  const [draft, setDraft] = useState<{ text: string; value: number } | null>(null)
  // Show the draft only while it still describes the current value.
  const text =
    draft && (Object.is(draft.value, value) || !Number.isFinite(draft.value))
      ? draft.text
      : Number.isNaN(value)
        ? ''
        : String(value)
  const commit = (raw: string) => {
    const parsed = parseInput(raw)
    if (!Object.is(parsed, value)) onChange(parsed)
  }
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
            const parsed = parseInput(e.target.value)
            setDraft({ text: e.target.value, value: parsed })
            if (Number.isFinite(parsed)) onChange(parsed)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit(e.currentTarget.value)
          }}
          onBlur={(e) => {
            commit(e.currentTarget.value)
            setDraft(null)
          }}
        />
        {suffix && <span className="kt-unit">{suffix}</span>}
      </span>
    </label>
  )
}
