import { useSyncExternalStore } from 'react'
import type { Layout } from './plotly.js'
import { NARROW_PLOT_WIDTH } from './theme.js'

const NARROW_QUERY = `(max-width: ${String(NARROW_PLOT_WIDTH)}px)`

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const query = window.matchMedia(NARROW_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

function narrowNow(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(NARROW_QUERY).matches
}

/**
 * True on phone-width screens (at most `NARROW_PLOT_WIDTH` px), for layout choices made outside
 * `PlotlyChart`, e.g. a 3D camera distance. `PlotlyChart` itself reacts to its own width.
 */
export function useNarrowScreen(): boolean {
  return useSyncExternalStore(subscribe, narrowNow, () => false)
}

/** A note centred on an empty plot, saying why it is empty or what to do. `null` adds nothing. */
export function withEmptyNote(layout: Partial<Layout>, text: string | null): Partial<Layout> {
  if (text === null) return layout
  return {
    ...layout,
    annotations: [
      ...(layout.annotations ?? []),
      { text, xref: 'paper', yref: 'paper', x: 0.5, y: 0.5, showarrow: false, font: { size: 14 } }
    ]
  }
}
