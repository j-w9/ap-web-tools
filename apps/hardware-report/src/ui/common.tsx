/**
 * Small presentational helpers shared by the report sections: status badges, yes/no cells,
 * number formatting and download buttons.
 */
import type { ReactNode } from 'react'

/** Status tone of a badge. */
export type Tone = 'good' | 'bad' | 'neutral' | 'accent'

const TONE_STYLE: Readonly<Record<Tone, { className: string; color?: string }>> = {
  good: { className: 'apwt-badge apwt-badge--gray', color: 'var(--green-text)' },
  bad: { className: 'apwt-badge apwt-badge--gray', color: 'var(--red-text)' },
  neutral: { className: 'apwt-badge apwt-badge--gray' },
  accent: { className: 'apwt-badge' }
}

/** A `.apwt-badge` with a status colour. */
export function Badge({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  const style = TONE_STYLE[tone]
  return (
    <span className={style.className} style={style.color === undefined ? undefined : { color: style.color }} title={title}>
      {children}
    </span>
  )
}

/** Yes/no badge; `undefined` renders a dash (not known, e.g. no log data). */
export function YesNo({ value, good = true }: { value: boolean | undefined; good?: boolean }) {
  if (value === undefined) return <span>–</span>
  return <Badge tone={value === good ? 'good' : 'bad'}>{value ? 'Yes' : 'No'}</Badge>
}

/** Health badge: Healthy / Unhealthy, or a dash without log data. */
export function Health({ value }: { value: boolean | undefined }) {
  if (value === undefined) return <span>–</span>
  return <Badge tone={value ? 'good' : 'bad'}>{value ? 'Healthy' : 'Unhealthy'}</Badge>
}

/** Badge for an error counter that should be zero. */
export function Count({ value }: { value: number | undefined }) {
  if (value === undefined) return <span>–</span>
  return <Badge tone={value === 0 ? 'good' : 'bad'}>{value}</Badge>
}

/** `0x`-prefixed lowercase hex of an unsigned 32-bit value. */
export function hex(value: number): string {
  return `0x${(value >>> 0).toString(16)}`
}

/** A number with a fixed number of decimals, or a dash. */
export function fixed(value: number | undefined, digits: number): string {
  return value === undefined || Number.isNaN(value) ? '–' : value.toFixed(digits)
}

/** Byte count with a binary unit, e.g. `12.3 KiB`. */
export function bytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
  return `${(value / (1024 * 1024)).toFixed(2)} MiB`
}

/** A button that downloads something when clicked. */
export function DownloadButton({ onClick, children, title }: { onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button type="button" className="apwt-btn" onClick={onClick} title={title}>
      {children}
    </button>
  )
}

/** A scrolling `.apwt-table`. */
export function Table({ head, children }: { head: readonly ReactNode[]; children: ReactNode }) {
  return (
    <div className="apwt-table-wrap">
      <table className="apwt-table">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

/** A small heading inside a section body. */
export function SubHeading({ children }: { children: ReactNode }) {
  return <h3 style={{ margin: '18px 0 8px', fontSize: 15, fontWeight: 600 }}>{children}</h3>
}

/** True when any slot of a sparse sensor list is filled. */
export function anyPresent(list: readonly unknown[]): boolean {
  return list.some((x) => x !== undefined)
}
