import { useEffect, useRef, useState } from 'react'

interface FieldProps {
  label: string
  step?: number
  min?: number
  max?: number
  disabled?: boolean
  /** Tooltip, e.g. the parameter name. */
  title?: string
}

export interface NumberFieldProps extends FieldProps {
  value: number
  /** Called with `parseFloat` of the input, as upstream reads it: NaN when the input is empty. */
  onChange: (value: number) => void
}

/**
 * A labelled number input reporting `parseFloat` of its text on every edit, NaN included, as
 * upstream reads its inputs. The typed text is kept while editing.
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
        value={draft ?? (Number.isNaN(value) ? '' : String(value))}
        onChange={(e) => {
          setDraft(e.target.value)
          onChange(parseFloat(e.target.value))
        }}
        onBlur={() => setDraft(null)}
      />
    </label>
  )
}

export interface TextNumberFieldProps extends FieldProps {
  /** The input's value string (what upstream's input holds). */
  value: string
  onChange: (value: string) => void
}

/** A number input whose value is kept as the string the browser reports, like upstream's inputs. */
export function TextNumberField({ label, value, onChange, step, min, max, disabled, title }: TextNumberFieldProps) {
  return (
    <label className="apwt-field" title={title}>
      <span>{label}</span>
      <input
        type="number"
        step={step ?? 'any'}
        min={min}
        max={max}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}

export interface CommitNumberFieldProps extends TextNumberFieldProps {
  /**
   * Called on the input's native `change` event (enter, blur or a spinner click), as upstream's
   * `onchange` handlers are. Returns the text the input then shows.
   */
  commit?: (text: string) => string
}

/** A number input that reports its value string only when the edit is committed. */
export function CommitNumberField({ label, value, onChange, commit, step, min, max, disabled, title }: CommitNumberFieldProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const handler = useRef<(text: string) => void>(() => undefined)
  useEffect(() => {
    handler.current = (text) => {
      const next = commit ? commit(text) : text
      setDraft(null)
      onChange(next)
    }
  })
  useEffect(() => {
    const el = input.current
    if (!el) return
    const listener = (): void => handler.current(el.value)
    el.addEventListener('change', listener)
    return () => el.removeEventListener('change', listener)
  }, [])
  return (
    <label className="apwt-field" title={title}>
      <span>{label}</span>
      <input
        ref={input}
        type="number"
        step={step ?? 'any'}
        min={min}
        max={max}
        disabled={disabled}
        value={draft ?? value}
        onChange={(e) => setDraft(e.target.value)}
      />
    </label>
  )
}
