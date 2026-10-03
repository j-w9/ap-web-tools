/**
 * Plotly traces and layouts for the three plots, built from analysis results (upstream
 * `updateThrustPwmPlot`, `updateThrustExpoPlot` and the `init*Plot` layouts).
 */
import type { Annotations, Data, Layout, Shape } from '@apwt/plot'
import {
  spinMarkers,
  type HoverEstimate,
  type Linearisation,
  type SpinMarkerKey,
  type SpinParams
} from '../analysis/linearisation.js'
import type { TableRow } from '../analysis/thrust-table.js'

// Plotly widens the right margin to fit the legend; on phones the plot puts the legend above.
const PLOT_MARGIN = { b: 50, l: 50, r: 20, t: 20 }
const AXIS_FRAME = { type: 'linear', zeroline: false, showline: true, mirror: true } as const
const LEGEND = { itemclick: false, itemdoubleclick: false } as const
const THROTTLE_AXIS = { title: { text: 'Throttle (%)' }, ...AXIS_FRAME, range: [0, 100] }

const MARKER_COLORS: Readonly<Record<SpinMarkerKey, string>> = {
  SPIN_ARM: 'orange',
  SPIN_MIN: 'green',
  SPIN_MAX: 'red'
}

// ---------- Thrust against ESC signal ----------

/** Measured thrust against ESC signal, plotting the cells' raw values as upstream does. */
export function pwmTraces(rows: readonly TableRow[]): Partial<Data>[] {
  return [{ x: rows.map((r) => r.pwm ?? null), y: rows.map((r) => r.thrust ?? null), name: 'Measured thrust', mode: 'lines' }]
}

/** PWM axis over the output range, with the spin points marked. */
export function pwmLayout(spin: SpinParams): Partial<Layout> {
  const markers = spinMarkers(spin, 'pwm')
  const shapes: Partial<Shape>[] = markers.map((m) => ({
    type: 'line',
    x0: m.x,
    x1: m.x,
    y0: 0,
    y1: 1,
    yref: 'paper',
    line: { color: MARKER_COLORS[m.key], width: 0.75, dash: 'dot' }
  }))
  const annotations: Partial<Annotations>[] = markers.map((m) => ({
    x: m.x,
    y: 1,
    yref: 'paper',
    text: m.key,
    showarrow: false,
    // @types/plotly.js types textangle as a string; Plotly coerces the numeric string.
    textangle: '-90',
    xshift: -9,
    yshift: -5
  }))
  return {
    xaxis: { title: { text: 'PWM (µs)' }, ...AXIS_FRAME, range: [spin.pwmMin, spin.pwmMax] },
    yaxis: { title: { text: 'Thrust' }, ...AXIS_FRAME },
    showlegend: true,
    legend: LEGEND,
    margin: PLOT_MARGIN,
    shapes,
    annotations
  }
}

// ---------- Thrust against throttle ----------

export function expoTraces(lin: Linearisation | null, hover: HoverEstimate | null): Partial<Data>[] {
  if (!lin) return []
  const traces: Partial<Data>[] = [
    { x: lin.throttlePct, y: lin.uncorrectedThrust, name: 'Measured thrust', mode: 'lines' },
    { x: lin.throttlePct, y: lin.result.correctedThrust, name: 'Linearised thrust', mode: 'lines' }
  ]
  if (hover) {
    traces.push({
      x: [hover.throttlePct],
      y: [hover.requiredThrust],
      name: 'THST_HOVER',
      mode: 'markers',
      marker: { size: 6, symbol: 'circle', color: 'green' }
    })
  }
  return traces
}

export const EXPO_LAYOUT: Partial<Layout> = {
  xaxis: THROTTLE_AXIS,
  yaxis: { title: { text: 'Thrust' }, ...AXIS_FRAME },
  showlegend: true,
  legend: LEGEND,
  margin: PLOT_MARGIN
}

// ---------- Thrust gradient ----------

export function gradientTraces(lin: Linearisation | null): Partial<Data>[] {
  if (!lin) return []
  return [
    {
      x: lin.gradientThrottlePct,
      y: lin.result.gradient,
      name: 'Linearised thrust<br>Std dev: ' + lin.result.stdDeviation.toFixed(3),
      mode: 'lines',
      line: { color: 'indianred' }
    }
  ]
}

/** Gradient axes with a dashed line at the mean gradient. */
export function gradientLayout(lin: Linearisation | null): Partial<Layout> {
  const mean = lin?.result.mean ?? 0
  return {
    xaxis: THROTTLE_AXIS,
    yaxis: { title: { text: 'Thrust gradient<br>(Δ thrust / Δ throttle)' }, ...AXIS_FRAME },
    showlegend: true,
    legend: LEGEND,
    margin: PLOT_MARGIN,
    shapes: [
      {
        type: 'line',
        x0: 0,
        x1: 100,
        y0: mean,
        y1: mean,
        // Upstream uses the custom dash '4px,3px', which @types/plotly.js does not allow; 'dash' is the nearest named style.
        line: { dash: 'dash', width: 1, color: 'gray' },
        visible: lin !== null
      }
    ]
  }
}
