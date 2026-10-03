import { useState } from 'react'

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
 * simulation does not rerun on every keystroke. Text that is not a finite number is discarded.
 * Remount it (`key`) to show a value changed from outside.
 */
export function NumberField({ value, onCommit, min, max, step, title, ariaLabel }: NumberFieldProps) {
  const [draft, setDraft] = useState(String(value))

  const commit = () => {
    const parsed = draft.trim() === '' ? NaN : Number(draft)
    if (Number.isFinite(parsed)) {
      if (parsed !== value) onCommit(parsed)
    } else {
      setDraft(String(value))
    }
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
