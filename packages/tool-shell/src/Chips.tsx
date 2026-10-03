import { useContext, useId, type ReactNode } from 'react'
import { ControlGroupLabelContext } from './group-context.js'

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
  /** Optional label shown before the chips and kept with them when a toolbar wraps. */
  label?: ReactNode
  options: readonly { value: T; label: ReactNode; disabled?: boolean }[]
  value: T
  onChange: (value: T) => void
}

/**
 * A row of mutually exclusive chips. Named by `label`, else by the enclosing `ControlGroup`.
 */
export function RadioChips<T extends string>({ name, label, options, value, onChange }: RadioChipsProps<T>) {
  const labelId = useId()
  const groupLabelId = useContext(ControlGroupLabelContext)
  return (
    <div
      className={label != null ? 'apwt-chips apwt-chip-group' : 'apwt-chips'}
      role="radiogroup"
      aria-labelledby={label != null ? labelId : groupLabelId}
    >
      {label != null && <ChipLabel id={labelId}>{label}</ChipLabel>}
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
  /** Optional label shown before the chips and kept with them when a toolbar wraps. */
  label?: ReactNode
  options: readonly { value: T; label: ReactNode; disabled?: boolean; title?: string }[]
  value: ReadonlySet<T>
  onChange: (value: ReadonlySet<T>) => void
}

/**
 * A row of independent toggle chips over a set of values. Named by `label`, else by the
 * enclosing `ControlGroup`.
 */
export function CheckChips<T extends string>({ label, options, value, onChange }: CheckChipsProps<T>) {
  const labelId = useId()
  const groupLabelId = useContext(ControlGroupLabelContext)
  const name = label != null ? labelId : groupLabelId
  return (
    <div
      className={label != null ? 'apwt-chips apwt-chip-group' : 'apwt-chips'}
      role={name !== undefined ? 'group' : undefined}
      aria-labelledby={name}
    >
      {label != null && <ChipLabel id={labelId}>{label}</ChipLabel>}
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

/** Small label introducing a chip group in a section toolbar. Prefer `ChipGroup` or the `label` prop. */
export function ChipLabel({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <span id={id} className="apwt-chip-label">
      {children}
    </span>
  )
}

export interface ChipGroupProps {
  label: ReactNode
  children: ReactNode
}

/**
 * A labelled cluster of chips for a section toolbar. The label and its chips form one unit, so
 * when the toolbar wraps on a narrow screen the label never ends up separated from its chips.
 */
export function ChipGroup({ label, children }: ChipGroupProps) {
  const labelId = useId()
  return (
    <div className="apwt-chip-group" role="group" aria-labelledby={labelId}>
      <ChipLabel id={labelId}>{label}</ChipLabel>
      {children}
    </div>
  )
}
