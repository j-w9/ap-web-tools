import { Moon, Sun } from 'lucide-react'
import { chooseTheme } from './theme.js'
import { useTheme } from './useTheme.js'

/** Sun/moon button switching between dark and light, as on CustomBuild. */
export function ThemeToggle() {
  const theme = useTheme()
  const dark = theme === 'dark'
  return (
    <button
      type="button"
      className="apwt-icon-btn"
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      onClick={() => chooseTheme(dark ? 'light' : 'dark')}
    >
      {dark ? <Sun /> : <Moon />}
    </button>
  )
}
