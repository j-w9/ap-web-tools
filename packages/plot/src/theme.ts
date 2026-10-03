import type { Layout } from './plotly.js'

/** Colours a plot needs from the page theme. */
export interface PlotTheme {
  text: string
  muted: string
  grid: string
  line: string
  hoverBg: string
  /** Colour of the active modebar button (the shell's accent text colour). */
  accent: string
  font: string
}

/** Plot width (px) below which the phone layout is used: legend below the plot, tight margins. */
export const NARROW_PLOT_WIDTH = 560

export interface ThemeLayoutOptions {
  /** The plot is narrower than `NARROW_PLOT_WIDTH`. */
  narrow?: boolean
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
    return {
      text: '#d1d5db',
      muted: '#9ca3af',
      grid: '#2a2a2a',
      line: '#4b5563',
      hoverBg: '#181818',
      accent: '#facc15',
      font: 'sans-serif'
    }
  }
  const style = getComputedStyle(document.documentElement)
  return {
    text: rgbVar(style, '--g300', '#d1d5db'),
    muted: rgbVar(style, '--g400', '#9ca3af'),
    grid: rgbVar(style, '--s4', '#2a2a2a'),
    line: rgbVar(style, '--g600', '#4b5563'),
    hoverBg: rgbVar(style, '--s2', '#181818'),
    accent: style.getPropertyValue('--yellow-text').trim() || '#facc15',
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

/** True when the layout positions its legend itself. */
function legendPlaced(legend: unknown): boolean {
  if (legend === undefined || legend === null || typeof legend !== 'object') return false
  const l = legend as Record<string, unknown>
  return l.x !== undefined || l.y !== undefined || l.orientation !== undefined
}

/** True when any 2D axis in the layout sits on the right, so the plot needs a right margin. */
function hasRightAxis(layout: Record<string, unknown>): boolean {
  return Object.keys(layout).some((k) => {
    if (!AXIS_KEY.test(k)) return false
    const axis = layout[k] as AxisLike | undefined
    return axis?.side === 'right' || (typeof axis?.position === 'number' && axis.position > 0.5)
  })
}

/** True when the layout turns off automargin on an axis, so its margins must be left alone. */
function fixedMargins(layout: Record<string, unknown>): boolean {
  return Object.keys(layout).some((k) => AXIS_KEY.test(k) && (layout[k] as AxisLike | undefined)?.automargin === false)
}

/** A range slider on a transparent background with a themed border (Plotly defaults to white). */
function themedRangeslider(slider: unknown, theme: PlotTheme): { rangeslider?: Record<string, unknown> } {
  if (slider === undefined || slider === null || slider === false) return {}
  const own = typeof slider === 'object' ? (slider as Record<string, unknown>) : {}
  if (own.visible === false) return {}
  return { rangeslider: { bgcolor: 'rgba(0,0,0,0)', bordercolor: theme.grid, borderwidth: 1, ...own } }
}

/** Plotly's default margins, used where a layout leaves a side unset. */
const PLOTLY_MARGIN = { l: 80, r: 80, t: 100, b: 80 } as const

/**
 * Phone margins: each side is capped (never grown), and the axes' automargin adds back whatever
 * tick labels and titles need. A right axis keeps room on the right; a title keeps room on top.
 */
function narrowMargin(layout: Partial<Layout>, raw: Record<string, unknown>): Partial<Layout['margin']> {
  const m = (layout.margin ?? {}) as Partial<Record<'l' | 'r' | 't' | 'b', number>>
  const side = (k: 'l' | 'r' | 't' | 'b', cap: number) => Math.min(m[k] ?? PLOTLY_MARGIN[k], cap)
  return {
    ...layout.margin,
    l: side('l', 48),
    r: side('r', hasRightAxis(raw) ? 48 : 16),
    t: side('t', layout.title !== undefined ? 56 : 24),
    b: side('b', 40)
  }
}

/**
 * Overlay theme colours onto a layout: transparent backgrounds, themed fonts, grid and axis
 * lines, range sliders, a modebar in the page colours, and axes that grow their margin to fit tick labels and
 * titles. Explicit settings in the layout (e.g. a coloured y axis) are kept.
 *
 * With `narrow`, a legend the layout does not position itself goes horizontally along the bottom
 * of the figure (below the x axis title, clear of colorbars, which tools place above the plot)
 * instead of taking a third of a phone's width on the right, and margins are capped to phone
 * sizes (the axes' automargin still makes room for labels), unless the layout turns automargin off.
 */
export function themeLayout(layout: Partial<Layout>, theme: PlotTheme, options: ThemeLayoutOptions = {}): Partial<Layout> {
  const raw = layout as Record<string, unknown>
  const narrowLegend =
    options.narrow === true && !legendPlaced(layout.legend)
      ? { orientation: 'h', x: 0, xanchor: 'left', yref: 'container', y: 0, yanchor: 'bottom' }
      : {}
  const out: Record<string, unknown> = {
    ...layout,
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: theme.font, color: theme.muted, size: 12, ...(layout.font ?? {}) },
    legend: { font: { color: theme.text }, ...narrowLegend, ...(layout.legend ?? {}) },
    hoverlabel: {
      bgcolor: theme.hoverBg,
      bordercolor: theme.grid,
      font: { family: theme.font, color: theme.text },
      ...(layout.hoverlabel ?? {})
    },
    modebar: {
      bgcolor: 'rgba(0,0,0,0)',
      color: theme.muted,
      activecolor: theme.accent,
      ...((raw.modebar ?? {}) as Record<string, unknown>)
    }
  }
  if (options.narrow === true && !fixedMargins(raw)) out.margin = narrowMargin(layout, raw)
  const axisKeys = new Set(Object.keys(layout).filter((k) => AXIS_KEY.test(k)))
  axisKeys.add('xaxis')
  axisKeys.add('yaxis')
  for (const key of axisKeys) {
    const axis = (raw[key] ?? {}) as AxisLike
    out[key] = {
      gridcolor: theme.grid,
      zerolinecolor: theme.line,
      linecolor: theme.line,
      automargin: true,
      ...axis,
      ...themedRangeslider(axis.rangeslider, theme)
    }
  }
  // 3D plots keep their axes under `scene`.
  const scene = raw.scene as Record<string, AxisLike | undefined> | undefined
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
