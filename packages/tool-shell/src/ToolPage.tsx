import type { ReactNode } from 'react'
import { ThemeToggle } from './ThemeToggle.js'
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
  { href: '../', label: 'All tools' },
  { href: 'https://ardupilot.org', label: 'ardupilot.org' },
  { href: 'https://github.com/j-w9/ap-web-tools', label: 'GitHub' }
] as const

/**
 * Shared page frame in the CustomBuild style: sticky blurred header with the ArduPilot
 * logo, a title block, a sticky control rail beside the results column, and a footer.
 */
export function ToolPage({ title, intro, readmeUrl, actions, rail, children }: ToolPageProps) {
  return (
    <>
      <header className="apwt-header">
        <div className="apwt-header__inner">
          <a href="../" aria-label="All ArduPilot web tools">
            <img className="apwt-header__logo" src="/images/ardupilot_logo.png" alt="ArduPilot" />
          </a>
          <span className="apwt-header__spacer" />
          <nav className="apwt-nav" aria-label="Site">
            {NAV.map((l) => (
              <a key={l.href} href={l.href}>
                {l.label}
              </a>
            ))}
            {readmeUrl && <a href={readmeUrl}>Help</a>}
          </nav>
          {actions}
          <ThemeToggle />
        </div>
      </header>

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
          {rail && <aside className="apwt-rail">{rail}</aside>}
          <main className="apwt-main">{children}</main>
        </div>
      </div>

      <footer className="apwt-footer">
        <div className="apwt-container apwt-footer__inner">
          <span className="apwt-footer__name">ArduPilot Web Tools</span>
          <div className="apwt-footer__links">
            <a href="https://github.com/ArduPilot/WebTools">Original tools</a>
            <a href="https://ardupilot.org/donate" className="apwt-donate">
              ♥ Donate
            </a>
            <span>GPL-3.0</span>
          </div>
        </div>
      </footer>
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

export interface ControlGroupProps {
  label: string
  children: ReactNode
}

/** A labelled group of controls inside the rail. */
export function ControlGroup({ label, children }: ControlGroupProps) {
  return (
    <fieldset className="apwt-group">
      <legend>
        <span className="apwt-label">{label}</span>
      </legend>
      {children}
    </fieldset>
  )
}

/** The rail's card container. */
export function RailCard({ children }: { children: ReactNode }) {
  return <div className="apwt-card">{children}</div>
}
