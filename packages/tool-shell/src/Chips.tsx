import type { ReactNode } from 'react'

export interface ChipProps {
  type: 'radio' | 'checkbox'
  name?: string | undefined
  checked: boolean
  disabled?: boolean | undefined
  onChange: (checked: boolean) => void
  children: ReactNode
  /** Optional colour swatch, e.g. a trace or parameter-set colour. */
  swatch?: string | undefined
  title?: string | undefined
}

/** One selectable chip: a styled radio or checkbox, highlighted in yellow when checked. */
export function Chip({ type, name, checked, disabled, onChange, children, swatch, title }: ChipProps) {
  return (
    <label className="apwt-chip" title={title}>
      <input type={type} name={name} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {swatch && <span className="apwt-chip__swatch" style={{ background: swatch }} />}
      {children}
    </label>
  )
}

export interface RadioChipsProps<T extends string> {
  name: string
  options: readonly { value: T; label: ReactNode; disabled?: boolean }[]
  value: T
  onChange: (value: T) => void
}

/** A row of mutually exclusive chips. */
export function RadioChips<T extends string>({ name, options, value, onChange }: RadioChipsProps<T>) {
  return (
    <div className="apwt-chips" role="radiogroup">
      {options.map((o) => (
        <Chip
          key={o.value}
          type="radio"
          name={name}
          checked={value === o.value}
          disabled={o.disabled ?? false}
          onChange={() => onChange(o.value)}
        >
          {o.label}
        </Chip>
      ))}
    </div>
  )
}

export interface CheckChipsProps<T extends string> {
  options: readonly { value: T; label: ReactNode; disabled?: boolean; title?: string }[]
  value: ReadonlySet<T>
  onChange: (value: ReadonlySet<T>) => void
}

/** A row of independent toggle chips over a set of values. */
export function CheckChips<T extends string>({ options, value, onChange }: CheckChipsProps<T>) {
  return (
    <div className="apwt-chips">
      {options.map((o) => (
        <Chip
          key={o.value}
          type="checkbox"
          checked={value.has(o.value)}
          disabled={o.disabled ?? false}
          title={o.title}
          onChange={(on) => {
            const next = new Set(value)
            if (on) next.add(o.value)
            else next.delete(o.value)
            onChange(next)
          }}
        >
          {o.label}
        </Chip>
      ))}
    </div>
  )
}

/** Small label introducing a chip group in a section toolbar. */
export function ChipLabel({ children }: { children: ReactNode }) {
  return <span className="apwt-chip-label">{children}</span>
}
