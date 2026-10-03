import { useEffect, useImperativeHandle, useRef, forwardRef, type CSSProperties } from 'react'
import {
  Plotly,
  DEFAULT_CONFIG,
  type Config,
  type Data,
  type Layout,
  type PlotRelayoutEvent,
  type PlotlyHTMLElement
} from './plotly.js'

export interface PlotlyChartProps {
  data: readonly Partial<Data>[]
  layout: Partial<Layout>
  config?: Partial<Config>
  style?: CSSProperties
  className?: string
  onRelayout?: (event: PlotRelayoutEvent) => void
  /** Called once the plot element exists, for imperative linking. */
  onReady?: (element: PlotlyHTMLElement) => void
}

/**
 * A Plotly chart as a React component. `data` and `layout` are treated as the source
 * of truth and pushed to Plotly with `Plotly.react` whenever they change; the component
 * never mutates them. Pass the same object references when nothing changed to avoid
 * redundant redraws.
 */
export const PlotlyChart = forwardRef<PlotlyHTMLElement, PlotlyChartProps>(function PlotlyChart(
  { data, layout, config, style, className, onRelayout, onReady },
  ref
) {
  const divRef = useRef<HTMLDivElement>(null)
  const relayoutRef = useRef(onRelayout)
  relayoutRef.current = onRelayout

  useImperativeHandle(ref, () => divRef.current as unknown as PlotlyHTMLElement, [])

  // Create once, purge on unmount.
  useEffect(() => {
    const el = divRef.current
    if (!el) return
    const plot = el as unknown as PlotlyHTMLElement
    let cancelled = false
    void Plotly.newPlot(el, data as Data[], layout as Partial<Layout>, { ...DEFAULT_CONFIG, ...config }).then(() => {
      if (cancelled) return
      plot.on('plotly_relayout', (event) => relayoutRef.current?.(event))
      onReady?.(plot)
    })
    return () => {
      cancelled = true
      Plotly.purge(el)
    }
    // Initial render only; updates go through Plotly.react below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Push updates. Plotly.react diffs internally, so this is cheap when nothing changed.
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const el = divRef.current
    if (!el) return
    void Plotly.react(el, data as Data[], layout as Partial<Layout>, { ...DEFAULT_CONFIG, ...config })
  }, [data, layout, config])

  return <div ref={divRef} style={style} className={className} />
})
