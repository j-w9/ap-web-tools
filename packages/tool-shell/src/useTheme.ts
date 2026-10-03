import { useEffect, useState } from 'react'
import { currentTheme, onThemeChange, type Theme } from './theme.js'

/** The applied theme, re-rendering when it changes. */
export function useTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(currentTheme)
  useEffect(() => onThemeChange(setTheme), [])
  return theme
}
