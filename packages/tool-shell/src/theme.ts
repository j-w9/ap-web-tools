/**
 * Dark-first theme, as on CustomBuild: dark unless the OS prefers light or the user picked
 * light. Light mode is a `light` class on <html>. The choice is remembered per browser.
 */
export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'apwt-theme'
const EVENT = 'apwt-themechange'

function storedTheme(): Theme | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'light' || v === 'dark' ? v : null
  } catch {
    return null
  }
}

/** Theme to use on first paint: the stored choice, else the OS preference. */
export function initialTheme(): Theme {
  return storedTheme() ?? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
}

/** Apply a theme to the page without remembering it. */
export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('light', theme === 'light')
  window.dispatchEvent(new Event(EVENT))
}

/** Apply a theme and remember it as the user's choice. */
export function chooseTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // Storage blocked: the choice still applies to this page view.
  }
  applyTheme(theme)
}

/** The theme currently applied to the page. */
export function currentTheme(): Theme {
  return document.documentElement.classList.contains('light') ? 'light' : 'dark'
}

/**
 * Follow the OS preference until the user picks a theme, and notify `listener` on every
 * change. Returns an unsubscribe function.
 */
export function onThemeChange(listener: (theme: Theme) => void): () => void {
  const media = window.matchMedia('(prefers-color-scheme: light)')
  const onMedia = () => {
    if (storedTheme() == null) applyTheme(media.matches ? 'light' : 'dark')
  }
  const notify = () => listener(currentTheme())
  media.addEventListener('change', onMedia)
  window.addEventListener(EVENT, notify)
  return () => {
    media.removeEventListener('change', onMedia)
    window.removeEventListener(EVENT, notify)
  }
}

/** Read a CSS custom property from the root element. */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}
