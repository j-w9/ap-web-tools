import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { SiteFooter, SiteHeader } from './SiteChrome.js'
import { ControlGroupLabelContext } from './group-context.js'
import './tool.css'

export interface ToolPageProps {
  /** Tool name, e.g. "PID Review". */
  title: string
  /** One or two sentences on what the tool does. */
  intro: ReactNode
  /** Link to the tool's documentation. */
  readmeUrl?: string
  /** Extra header actions, e.g. the "Open in" button. */
  actions?: ReactNode
  /** Left column: log input and controls. Omit for tools without settings. */
  rail?: ReactNode
  children: ReactNode
}

const NAV = [
  { href: '../../', label: 'All tools' },
  { href: 'https://ardupilot.org', label: 'ardupilot.org' },
  { href: 'https://github.com/j-w9/ap-web-tools', label: 'GitHub' }
] as const

/**
 * Shared page frame in the CustomBuild style: sticky blurred header with the ArduPilot
 * logo (see `SiteHeader`), a title block, a sticky control rail beside the results column, and a footer.
 */
export function ToolPage({ title, intro, readmeUrl, actions, rail, children }: ToolPageProps) {
  return (
    <>
      <SiteHeader links={readmeUrl ? [...NAV, { href: readmeUrl, label: 'Help' }] : NAV} homeHref="../../" actions={actions} />

      <div className="apwt-container">
        <div className="apwt-hero">
          <h1 className="apwt-hero__title">
            {title.split(' ').length > 1 ? (
              <>
                {title.split(' ').slice(0, -1).join(' ')} <span className="apwt-logo-gradient">{title.split(' ').slice(-1)}</span>
              </>
            ) : (
              <span className="apwt-logo-gradient">{title}</span>
            )}
          </h1>
          <p className="apwt-hero__intro">{intro}</p>
        </div>

        <div className={`apwt-layout${rail ? '' : ' apwt-layout--single'}`}>
          {rail && <Rail>{rail}</Rail>}
          <main className="apwt-main">{children}</main>
        </div>
      </div>

      <SiteFooter />
    </>
  )
}

export interface SectionProps {
  title: string
  /** One-sentence explanation under the title. */
  help?: ReactNode
  /** Controls that act on this section, shown at the right of the title. */
  tools?: ReactNode
  children: ReactNode
}

/** A titled card in the results column. */
export function Section({ title, help, tools, children }: SectionProps) {
  return (
    <section className="apwt-card apwt-section">
      <div className="apwt-section__head">
        <div>
          <h2 className="apwt-section__title">{title}</h2>
          {help && <p className="apwt-section__help">{help}</p>}
        </div>
        {tools && <div className="apwt-section__tools">{tools}</div>}
      </div>
      <div className="apwt-section__body">{children}</div>
    </section>
  )
}

/**
 * The sticky rail. A rail shorter than the viewport sticks below the header; a taller one scrolls
 * with the page until its bottom is in view and then sticks there, so every control can be reached
 * by scrolling the page (no scroll box inside the rail). `--apwt-rail-h` feeds the CSS `top`.
 */
function Rail({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => el.style.setProperty('--apwt-rail-h', `${String(el.offsetHeight)}px`))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return (
    <aside ref={ref} className="apwt-rail">
      {children}
    </aside>
  )
}

export interface ControlGroupProps {
  label: string
  /** Render as a native `<details>` the user can fold away. */
  collapsible?: boolean
  /** Short state shown beside the label of a collapsible group, e.g. "On · Throttle". */
  summary?: ReactNode
  /** Whether a collapsible group starts open (default true). Later changes do not open or close it. */
  defaultOpen?: boolean
  children: ReactNode
}

/** A labelled group of controls inside the rail, optionally collapsible. */
export function ControlGroup({ label, collapsible = false, summary, defaultOpen = true, children }: ControlGroupProps) {
  const labelId = useId()
  const [initiallyOpen] = useState(defaultOpen)
  if (collapsible) {
    return (
      <details className="apwt-group apwt-group--collapsible" open={initiallyOpen}>
        <summary className="apwt-group__head">
          <span className="apwt-label" id={labelId}>
            {label}
          </span>
          {summary != null && <span className="apwt-group__summary">{summary}</span>}
          <ChevronDown className="apwt-group__chevron" aria-hidden="true" />
        </summary>
        <div className="apwt-group__body" role="group" aria-labelledby={labelId}>
          <ControlGroupLabelContext.Provider value={labelId}>{children}</ControlGroupLabelContext.Provider>
        </div>
      </details>
    )
  }
  return (
    <fieldset className="apwt-group">
      <legend>
        <span className="apwt-label" id={labelId}>
          {label}
        </span>
      </legend>
      <ControlGroupLabelContext.Provider value={labelId}>{children}</ControlGroupLabelContext.Provider>
    </fieldset>
  )
}

/** The rail's card container. Several cards in one rail are spaced apart. */
export function RailCard({ children }: { children: ReactNode }) {
  return <div className="apwt-card">{children}</div>
}
