import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

export interface RailGroupProps {
  label: string
  /** Short state shown beside the label, so a collapsed group still says what it holds. */
  summary?: ReactNode
  /** Whether the group starts open. Later changes do not open or close it. */
  defaultOpen?: boolean
  children: ReactNode
}

/**
 * A rail group that can be collapsed, styled like the shell's `ControlGroup`. Long parameter
 * rails stay scannable: each group's heading and state are visible with its fields folded away.
 */
export function RailGroup({ label, summary, defaultOpen = true, children }: RailGroupProps) {
  const [initiallyOpen] = useState(defaultOpen)
  return (
    <details className="apwt-group rail-group" open={initiallyOpen}>
      <summary className="rail-group__head">
        <span className="apwt-label">{label}</span>
        {summary !== undefined && <span className="rail-group__summary">{summary}</span>}
        <ChevronDown className="rail-group__chevron" aria-hidden />
      </summary>
      <div className="rail-group__body">{children}</div>
    </details>
  )
}
