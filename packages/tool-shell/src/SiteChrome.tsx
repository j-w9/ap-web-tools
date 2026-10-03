/// <reference types="vite/client" />
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Menu, X } from 'lucide-react'
import { ThemeToggle } from './ThemeToggle.js'
import logoUrl from './assets/ardupilot_logo.png'

export interface SiteLink {
  href: string
  label: string
}

export interface SiteHeaderProps {
  /** Site navigation links. Inline on wide screens, behind a menu button on narrow ones. */
  links: readonly SiteLink[]
  /** Where the logo links to; omit on the landing page itself. */
  homeHref?: string
  /** Extra header actions shown before the theme toggle, e.g. the "Open in" button. */
  actions?: ReactNode
}

/**
 * Sticky blurred header in the CustomBuild style: logo, nav links, actions and the theme toggle.
 * Below 1000 px the links move into a panel opened by a menu button, as on CustomBuild's mobile
 * header, and header actions drop their text labels so everything fits a 360 px phone.
 */
export function SiteHeader({ links, homeHref, actions }: SiteHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuId = useId()
  const headerRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const close = (e: MouseEvent) => {
      if (!headerRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', escape)
    }
  }, [menuOpen])

  const logo = <img className="apwt-header__logo" src={logoUrl} alt="ArduPilot" />

  return (
    <header className="apwt-header" ref={headerRef}>
      <div className="apwt-header__inner">
        {homeHref !== undefined ? (
          <a className="apwt-header__home" href={homeHref} aria-label="All ArduPilot web tools">
            {logo}
          </a>
        ) : (
          logo
        )}
        <span className="apwt-header__spacer" />
        <nav className="apwt-nav" aria-label="Site">
          {links.map((l) => (
            <a key={l.href} href={l.href}>
              {l.label}
            </a>
          ))}
        </nav>
        <div className="apwt-header__actions">
          {actions}
          <ThemeToggle />
          <button
            type="button"
            className="apwt-icon-btn apwt-header__menu-btn"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls={menuId}
            onClick={() => setMenuOpen((o) => !o)}
          >
            {menuOpen ? <X /> : <Menu />}
          </button>
        </div>
      </div>
      <nav id={menuId} className="apwt-header__menu" aria-label="Site" hidden={!menuOpen}>
        {links.map((l) => (
          <a key={l.href} href={l.href} onClick={() => setMenuOpen(false)}>
            {l.label}
          </a>
        ))}
      </nav>
    </header>
  )
}

/** The shared footer: site name, link to the original tools, donate and licence. */
export function SiteFooter() {
  return (
    <footer className="apwt-footer">
      <div className="apwt-container apwt-footer__inner">
        <span className="apwt-footer__name">ArduPilot Web Tools</span>
        <div className="apwt-footer__links">
          <a href="https://github.com/ArduPilot/WebTools">Original tools</a>
          <a href="https://ardupilot.org/donate" className="apwt-donate">
            <span aria-hidden="true">♥</span> Donate
          </a>
          <span>GPL-3.0</span>
        </div>
      </div>
    </footer>
  )
}
