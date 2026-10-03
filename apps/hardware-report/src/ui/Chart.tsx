// A PlotlyChart that rearranges its layout on phone-width screens, where a legend beside the plot
// or extra y axes would squeeze the plotting area to a sliver.
import { useMemo, useSyncExternalStore } from 'react'
import { PlotlyChart, type Layout, type PlotlyChartProps } from '@apwt/plot'

const NARROW = '(max-width: 640px)'

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const query = window.matchMedia(NARROW)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

function narrowNow(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(NARROW).matches
}

/** True on phone-width screens. */
export function useNarrow(): boolean {
  return useSyncExternalStore(subscribe, narrowNow, () => false)
}

/**
 * Default phone layout: the legend moves above the plot and runs horizontally, and the right
 * margin the legend no longer needs goes to the plot.
 */
export function compactLayout(layout: Partial<Layout>): Partial<Layout> {
  const margin = { ...layout.margin, r: 16 }
  if (layout.showlegend === false) return { ...layout, margin }
  return {
    ...layout,
    margin,
    legend: { ...layout.legend, orientation: 'h', x: 0, xanchor: 'left', y: 1.02, yanchor: 'bottom' }
  }
}

export interface ChartProps extends PlotlyChartProps {
  /** Phone layout; defaults to {@link compactLayout}. */
  compact?: (layout: Partial<Layout>) => Partial<Layout>
}

/** {@link PlotlyChart} with a phone layout. */
export function Chart({ layout, compact = compactLayout, ...rest }: ChartProps) {
  const narrow = useNarrow()
  const shown = useMemo(() => (narrow ? compact(layout) : layout), [narrow, compact, layout])
  return <PlotlyChart layout={shown} {...rest} />
}
