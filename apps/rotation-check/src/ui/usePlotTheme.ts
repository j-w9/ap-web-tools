import { useEffect, useState } from 'react'
import { onRootClassChange, readPlotTheme, type PlotTheme } from '@apwt/plot'

/**
 * Plot colours from the page theme, updated on light/dark switches. `PlotlyChart` themes 2D axes
 * itself but not 3D `scene` axes, so the scene layout reads the colours through this.
 */
export function usePlotTheme(): PlotTheme {
  const [theme, setTheme] = useState(readPlotTheme)
  useEffect(() => onRootClassChange(() => setTheme(readPlotTheme())), [])
  return theme
}
