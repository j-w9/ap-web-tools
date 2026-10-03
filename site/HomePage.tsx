import type { ReactNode } from 'react'
import { SiteFooter, SiteHeader } from '@apwt/tool-shell'

const LINKS = [
  { href: 'https://ardupilot.org', label: 'ardupilot.org' },
  { href: 'https://github.com/j-w9/ap-web-tools', label: 'GitHub' }
] as const

/** Landing-page frame: the same header and footer as the tools, with a larger hero. */
export function HomePage({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader links={LINKS} />
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
      <SiteFooter />
    </>
  )
}
