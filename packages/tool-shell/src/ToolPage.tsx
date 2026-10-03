import type { ReactNode } from 'react'
import './tool.css'

export interface ToolPageProps {
  /** Page heading, e.g. "ArduPilot PID Review Tool". Also used as the document title. */
  title: string
  /** Short description shown under the heading. */
  intro: ReactNode
  /** Link to the tool's readme. */
  readmeUrl?: string
  children: ReactNode
}

const REPO_URL = 'https://github.com/ArduPilot/WebTools'

/** Shared page chrome: ArduPilot banner, GitHub links, title and intro paragraph. */
export function ToolPage({ title, intro, readmeUrl, children }: ToolPageProps) {
  return (
    <div className="apwt-page">
      <header className="apwt-header">
        <a href="https://ardupilot.org">
          <img src="/images/ArduPilot.png" alt="ArduPilot" />
        </a>
        <a className="apwt-header__github" href={REPO_URL}>
          <img src="/images/github-mark.png" alt="" />
          <img src="/images/GitHub_Logo.png" alt="GitHub" />
        </a>
      </header>
      <h1 className="apwt-title">
        <a href="">{title}</a>
      </h1>
      <p className="apwt-intro">
        {intro}
        {readmeUrl && (
          <>
            {' '}
            Here are <a href={readmeUrl}>more details about this tool and how to use it</a>.
          </>
        )}
      </p>
      {children}
    </div>
  )
}

export interface SectionTitleProps {
  children: ReactNode
  /** Tooltip explaining the section. */
  help?: string
}

/** Centred `<h2>` with an optional help icon, matching upstream's section headers. */
export function SectionTitle({ children, help }: SectionTitleProps) {
  return (
    <h2 className="apwt-section-title">
      {children}
      {help && <img className="apwt-help" src="/images/question-circle.svg" alt="?" title={help} />}
    </h2>
  )
}
