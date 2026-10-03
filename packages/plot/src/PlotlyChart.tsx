import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  Plotly,
  DEFAULT_CONFIG,
  type Config,
  type Data,
  type Layout,
  type PlotRelayoutEvent,
  type PlotlyHTMLElement
} from './plotly.js'
import { onRootClassChange, readPlotTheme, themeLayout } from './theme.js'

export interface PlotlyChartProps {
  data: readonly Partial<Data>[]
  layout: Partial<Layout>
  config?: Partial<Config>
  style?: CSSProperties
  className?: string
  onRelayout?: (event: PlotRelayoutEvent) => void
  /** Called once, when the plot element first exists, for imperative linking. */
  onReady?: (element: PlotlyHTMLElement) => void
}

/** Keep a ref pointing at the latest value without re-running effects that read it. */
function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value)
  useEffect(() => {
    ref.current = value
  })
  return ref
}

/**
 * A Plotly chart as a React component. `data` and `layout` are the source of truth and are
 * pushed with `Plotly.react` whenever they change; the component never mutates them. The
 * layout is themed from the page's CSS tokens and re-themed when light/dark mode changes.
 */
export function PlotlyChart({ data, layout, config, style, className, onRelayout, onReady }: PlotlyChartProps) {
  const divRef = useRef<HTMLDivElement>(null)
  const [plot, setPlot] = useState<PlotlyHTMLElement | null>(null)
  const relayoutRef = useLatest(onRelayout)
  const readyRef = useLatest(onReady)

  const [theme, setTheme] = useState(readPlotTheme)
  useEffect(() => onRootClassChange(() => setTheme(readPlotTheme())), [])
  const themed = useMemo(() => themeLayout(layout, theme), [layout, theme])

  // Draw or update. Plotly.react creates the plot on first call and diffs afterwards.
  useEffect(() => {
    const el = divRef.current
    if (!el) return
    let live = true
    void Plotly.react(el, [...data] as Data[], themed, { ...DEFAULT_CONFIG, ...config }).then((element) => {
      if (live) setPlot(element)
    })
    return () => {
      live = false
    }
  }, [data, themed, config])

  // Purge on unmount.
  useEffect(() => {
    const el = divRef.current
    return () => {
      if (el) Plotly.purge(el)
    }
  }, [])

  // Wire events once the element exists.
  useEffect(() => {
    if (!plot) return
    readyRef.current?.(plot)
    const handler = (event: PlotRelayoutEvent) => relayoutRef.current?.(event)
    plot.on('plotly_relayout', handler)
    return () => plot.removeListener('plotly_relayout', handler)
  }, [plot, readyRef, relayoutRef])

  return <div ref={divRef} style={style} className={className} />
}
