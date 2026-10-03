import type { Layout } from './plotly.js'

/** Colours a plot needs from the page theme. */
export interface PlotTheme {
  text: string
  muted: string
  grid: string
  line: string
  hoverBg: string
  font: string
}

function rgbVar(style: CSSStyleDeclaration, name: string, fallback: string): string {
  const v = style.getPropertyValue(name).trim()
  return v ? `rgb(${v.split(/\s+/).join(', ')})` : fallback
}

/**
 * Read plot colours from the page's CSS tokens (the `--s*` surfaces and `--g*` greys used by
 * the tool shell). Falls back to dark-theme values outside a browser.
 */
export function readPlotTheme(): PlotTheme {
  if (typeof document === 'undefined') {
    return { text: '#d1d5db', muted: '#9ca3af', grid: '#2a2a2a', line: '#4b5563', hoverBg: '#181818', font: 'sans-serif' }
  }
  const style = getComputedStyle(document.documentElement)
  return {
    text: rgbVar(style, '--g300', '#d1d5db'),
    muted: rgbVar(style, '--g400', '#9ca3af'),
    grid: rgbVar(style, '--s4', '#2a2a2a'),
    line: rgbVar(style, '--g600', '#4b5563'),
    hoverBg: rgbVar(style, '--s2', '#181818'),
    font: style.getPropertyValue('--font').trim() || 'sans-serif'
  }
}

/** Observe changes to the root element's class (the shell toggles `light` there). */
export function onRootClassChange(callback: () => void): () => void {
  if (typeof MutationObserver === 'undefined') return () => {}
  const observer = new MutationObserver(callback)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => observer.disconnect()
}

const AXIS_KEY = /^[xy]axis\d*$/

type AxisLike = Record<string, unknown> & { title?: unknown }

/**
 * Overlay theme colours onto a layout: transparent backgrounds, themed fonts, grid and axis
 * lines. Explicit colours in the layout (e.g. a coloured y axis) are kept.
 */
export function themeLayout(layout: Partial<Layout>, theme: PlotTheme): Partial<Layout> {
  const out: Record<string, unknown> = {
    ...layout,
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: theme.font, color: theme.muted, size: 12, ...(layout.font ?? {}) },
    legend: { font: { color: theme.text }, ...(layout.legend ?? {}) },
    hoverlabel: {
      bgcolor: theme.hoverBg,
      bordercolor: theme.grid,
      font: { family: theme.font, color: theme.text },
      ...(layout.hoverlabel ?? {})
    }
  }
  const axisKeys = new Set(Object.keys(layout).filter((k) => AXIS_KEY.test(k)))
  axisKeys.add('xaxis')
  axisKeys.add('yaxis')
  for (const key of axisKeys) {
    const axis = ((layout as Record<string, unknown>)[key] ?? {}) as AxisLike
    out[key] = {
      gridcolor: theme.grid,
      zerolinecolor: theme.line,
      linecolor: theme.line,
      ...axis
    }
  }
  // 3D plots keep their axes under `scene`.
  const scene = (layout as Record<string, unknown>).scene as Record<string, AxisLike | undefined> | undefined
  if (scene !== undefined) {
    const themedScene: Record<string, unknown> = { ...scene }
    for (const key of ['xaxis', 'yaxis', 'zaxis']) {
      themedScene[key] = {
        gridcolor: theme.grid,
        zerolinecolor: theme.line,
        linecolor: theme.line,
        color: theme.muted,
        backgroundcolor: 'rgba(0,0,0,0)',
        ...(scene[key] ?? {})
      }
    }
    out.scene = themedScene
  }
  return out
}
