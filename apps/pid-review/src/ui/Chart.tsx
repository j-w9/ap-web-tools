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

/** `text` broken into lines of at most about `width` characters, joined with `<br>` for Plotly. */
function wrapText(text: string, width = 36): string {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    if (line !== '' && line.length + 1 + word.length > width) {
      lines.push(line)
      line = word
    } else {
      line = line === '' ? word : `${line} ${word}`
    }
  }
  lines.push(line)
  return lines.join('<br>')
}

/** A note centred on an empty plot, saying why it is empty or what to do. */
export function withEmptyNote(layout: Partial<Layout>, text: string | null): Partial<Layout> {
  if (text === null) return layout
  return {
    ...layout,
    annotations: [
      ...(layout.annotations ?? []),
      { text: wrapText(text), xref: 'paper', yref: 'paper', x: 0.5, y: 0.5, showarrow: false, font: { size: 14 } }
    ]
  }
}

/**
 * Phone layout of the flight data plot (roll, pitch, throttle and altitude on four y axes): only
 * the roll and throttle axes keep their ticks, and a legend names the colours.
 */
export function compactFlightLayout(layout: Partial<Layout>): Partial<Layout> {
  const axis = (key: 'yaxis' | 'yaxis2' | 'yaxis3' | 'yaxis4') => layout[key] ?? {}
  return {
    ...compactLayout({ ...layout, showlegend: true }),
    xaxis: { ...layout.xaxis, domain: [0, 1] },
    yaxis: { ...axis('yaxis'), title: { text: '' }, position: 0 },
    yaxis2: { ...axis('yaxis2'), visible: false },
    yaxis3: { ...axis('yaxis3'), title: { text: '' }, position: 1 },
    yaxis4: { ...axis('yaxis4'), visible: false },
    margin: { ...layout.margin, l: 40, r: 40 }
  }
}
