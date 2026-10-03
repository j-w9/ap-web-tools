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
import { NARROW_PLOT_WIDTH, onRootClassChange, readPlotTheme, themeLayout } from './theme.js'

export interface PlotlyChartProps {
  data: readonly Partial<Data>[]
  layout: Partial<Layout>
  config?: Partial<Config>
  style?: CSSProperties
  className?: string
  onRelayout?: (event: PlotRelayoutEvent) => void
  /** Called once, when the plot element first exists, for imperative linking. */
  onReady?: (element: PlotlyHTMLElement) => void
  /**
   * Extra phone layout for this chart, applied before theming while the chart is narrower than
   * `NARROW_PLOT_WIDTH` (e.g. hide secondary y axes). The shared legend and margin adjustments
   * apply either way. Keep the function stable (module level or memoised).
   */
  compact?: (layout: Partial<Layout>) => Partial<Layout>
}

/** Keep a ref pointing at the latest value without re-running effects that read it. */
function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value)
  useEffect(() => {
    ref.current = value
  })
  return ref
}

/** Whether the element is narrower than `NARROW_PLOT_WIDTH`, tracked with a ResizeObserver. */
function useNarrow(ref: { readonly current: HTMLElement | null }): boolean {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const update = () => setNarrow(el.clientWidth > 0 && el.clientWidth < NARROW_PLOT_WIDTH)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return narrow
}

/**
 * A Plotly chart as a React component. `data` and `layout` are the source of truth and are
 * pushed with `Plotly.react` whenever they change; the component never mutates them. The
 * layout is themed from the page's CSS tokens and re-themed when light/dark mode changes, and
 * switches to a phone layout (legend below, tight margins) when the chart is narrow.
 */
export function PlotlyChart({ data, layout, config, style, className, onRelayout, onReady, compact }: PlotlyChartProps) {
  const divRef = useRef<HTMLDivElement>(null)
  const [plot, setPlot] = useState<PlotlyHTMLElement | null>(null)
  const relayoutRef = useLatest(onRelayout)
  const readyRef = useLatest(onReady)

  const [theme, setTheme] = useState(readPlotTheme)
  useEffect(() => onRootClassChange(() => setTheme(readPlotTheme())), [])
  const narrow = useNarrow(divRef)
  const themed = useMemo(
    () => themeLayout(narrow && compact ? compact(layout) : layout, theme, { narrow }),
    [layout, theme, narrow, compact]
  )

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

  // Wire events once the element exists.
  useEffect(() => {
    if (!plot) return
    readyRef.current?.(plot)
    const handler = (event: PlotRelayoutEvent) => relayoutRef.current?.(event)
    plot.on('plotly_relayout', handler)
    return () => plot.removeListener('plotly_relayout', handler)
  }, [plot, readyRef, relayoutRef])

  // Purge on unmount. Declared after the listener effect so React runs its cleanup later:
  // purging deletes the element's emitter methods, so listeners must be removed first.
  useEffect(() => {
    const el = divRef.current
    return () => {
      if (el) Plotly.purge(el)
    }
  }, [])

  return <div ref={divRef} style={style} className={className} />
}
