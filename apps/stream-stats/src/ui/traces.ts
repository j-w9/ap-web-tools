/**
 * Builders turning Stream Stats results into Plotly traces and layouts (upstream `reset`,
 * `plot_tlog` and `plot_log` plot setup).
 */
import type { Data, Layout } from '@apwt/plot'
import type { LogFormat } from '../analysis/load.js'
import type { RateUnit, StreamStats } from '../analysis/stats.js'

/** Axis and hover labels for each unit (upstream `rate_plot`). */
export const RATE_LABELS = {
  bits: {
    hover: '%{x:.2f} s<br>%{y:.2f} bps',
    yAxis: 'bits per second',
    pieHover: '%{label}<br>%{value:,i} bits<br>%{percent}<extra></extra>'
  },
  messages: {
    hover: '%{x:.2f} s<br>%{y:.2f} messages',
    yAxis: 'messages per second',
    pieHover: '%{label}<br>%{value:,i} messages<br>%{percent}<extra></extra>'
  }
} as const satisfies Record<RateUnit, { hover: string; yAxis: string; pieHover: string }>

/**
 * Hover text naming the series. Upstream passes the name through `meta`; it is written into the
 * template instead because `@types/plotly.js` does not declare `meta` (message names are plain).
 */
function rateHover(unit: RateUnit, name: string): string {
  return `<extra></extra>${name}<br>${RATE_LABELS[unit].hover}`
}

const MARGIN = { b: 50, l: 60, r: 50, t: 20 }

/** One line per message stream. Upstream draws tlog streams with SVG and DataFlash ones with WebGL. */
export function rateTraces(stats: StreamStats, format: LogFormat, unit: RateUnit): Partial<Data>[] {
  return stats.rates.map((r) => ({
    type: format === 'bin' ? 'scattergl' : 'scatter',
    mode: 'lines',
    x: r.time,
    y: r.rate,
    name: r.name,
    hovertemplate: rateHover(unit, r.name)
  }))
}

/** The total rate as a single line. */
export function totalTraces(stats: StreamStats, unit: RateUnit): Partial<Data>[] {
  return [
    {
      type: 'scattergl',
      mode: 'lines',
      x: stats.total?.time ?? [],
      y: stats.total?.rate ?? [],
      name: 'Total',
      hovertemplate: rateHover(unit, 'Total')
    }
  ]
}

export function rateLayout(unit: RateUnit): Partial<Layout> {
  return {
    showlegend: false,
    margin: MARGIN,
    xaxis: { title: { text: 'Time (s)' } },
    yaxis: { title: { text: RATE_LABELS[unit].yAxis } }
  }
}

/** Share of each stream in the log. */
export function compositionTraces(stats: StreamStats, unit: RateUnit): Partial<Data>[] {
  return [
    {
      type: 'pie',
      textposition: 'inside',
      textinfo: 'label+percent',
      labels: stats.composition.map((c) => c.label),
      values: stats.composition.map((c) => c.value),
      hovertemplate: RATE_LABELS[unit].pieHover
    }
  ]
}

export const COMPOSITION_LAYOUT: Partial<Layout> = {
  showlegend: false,
  margin: { b: 10, l: 50, r: 50, t: 10 }
}
