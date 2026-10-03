import type { ReactNode } from 'react'
import { ThemeToggle } from '@apwt/tool-shell'
import logoUrl from '../packages/tool-shell/src/assets/ardupilot_logo.png'

/** Landing-page frame: the same header and footer as the tools, with a larger hero. */
export function HomePage({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="apwt-header">
        <div className="apwt-header__inner">
          <img className="apwt-header__logo" src={logoUrl} alt="ArduPilot" />
          <span className="apwt-header__spacer" />
          <nav className="apwt-nav" aria-label="Site">
            <a href="https://ardupilot.org">ardupilot.org</a>
            <a href="https://github.com/j-w9/ap-web-tools">GitHub</a>
          </nav>
          <ThemeToggle />
        </div>
      </header>
      <main className="apwt-container">
        <div className="home-hero">
          <h1 className="home-hero__title">
            ArduPilot <span className="apwt-logo-gradient">Web Tools</span>
          </h1>
          <p className="home-hero__intro">
            Browser tools for ArduPilot log analysis, tuning and setup. Files are processed locally and are not uploaded.
          </p>
        </div>
        {children}
      </main>
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
