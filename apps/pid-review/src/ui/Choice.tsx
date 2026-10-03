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

/** One selectable chip: a styled radio or checkbox. */
export function Chip({ type, name, checked, disabled, onChange, children, swatch, title }: ChipProps) {
  return (
    <label className="apwt-chip" title={title}>
      <input
        type={type}
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
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
