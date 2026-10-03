import { useState } from 'react'
import { parseNumberInput } from '../analysis/input.js'

export interface NumberFieldProps {
  value: number
  onCommit: (value: number) => void
  min?: number | undefined
  max?: number | undefined
  step?: number | 'any' | undefined
  title?: string | undefined
  ariaLabel?: string | undefined
}

/**
 * A number input that applies its value on blur or Enter, like upstream's `onchange`, so the
 * simulation does not rerun on every keystroke. The text is parsed as upstream parses it, so an
 * empty or invalid entry commits `NaN`. Remount it (`key`) to show a value changed from outside.
 */
export function NumberField({ value, onCommit, min, max, step, title, ariaLabel }: NumberFieldProps) {
  const [draft, setDraft] = useState(Number.isNaN(value) ? '' : String(value))

  const commit = () => {
    const parsed = parseNumberInput(draft)
    if (!Object.is(parsed, value)) onCommit(parsed)
  }

  return (
    <input
      type="number"
      value={draft}
      min={min}
      max={max}
      step={step}
      title={title}
      aria-label={ariaLabel}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
      }}
    />
  )
}
