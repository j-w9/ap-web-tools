/**
 * Builders turning simulation results into Plotly traces and layouts, one plot per quantity.
 * Pure functions so the React components stay declarative.
 */
import { defaultColor, type Data, type Layout, type Shape } from '@apwt/plot'
import type { SimulationResult } from '../analysis/simulate.js'
import type { MethodResult } from '../analysis/trajectory.js'

export const QUANTITIES = ['pos', 'vel', 'accel', 'jerk'] as const
export type Quantity = (typeof QUANTITIES)[number]

interface QuantityInfo {
  title: string
  axisTitle: string
  unit: string
  help: string
}

export const QUANTITY_INFO: Readonly<Record<Quantity, QuantityInfo>> = {
  pos: {
    title: 'Angle',
    axisTitle: 'Angle (deg)',
    unit: 'deg',
    help: 'The shaped attitude target. The dotted line is the desired angle.'
  },
  vel: {
    title: 'Angular velocity',
    axisTitle: 'Angular velocity (deg/s)',
    unit: 'deg/s',
    help: 'The shaped rate target, held within the rate limit. The dotted line is the desired rate.'
  },
  accel: {
    title: 'Angular acceleration',
    axisTitle: 'Angular acceleration (deg/s²)',
    unit: 'deg/s²',
    help: 'The shaped acceleration, held within the acceleration limit.'
  },
  jerk: {
    title: 'Jerk',
    axisTitle: 'Jerk (deg/s³)',
    unit: 'deg/s³',
    help: 'Rate of change of acceleration. Only the jerk-limited methods are shown; the others would swamp the scale.'
  }
}

/** One shaping method as the plots show it. Its index fixes its colour on every plot. */
interface MethodSeries {
  name: string
  result: MethodResult | null
}

export function methodSeries(result: SimulationResult): readonly MethodSeries[] {
  switch (result.vehicle) {
    case 'copter':
      return [
        { name: 'Sqrt (pre 4.7)', result: result.sqrt },
        { name: 'SCurve (4.7+)', result: result.scurve },
        { name: 'Minimum time', result: result.minimumTime.ok ? result.minimumTime.result : null }
      ]
    case 'plane':
      return [
        { name: 'Pre 4.8', result: result.pre48 },
        { name: 'Input shaping 4.8+', result: result.inputShaping },
        { name: 'Error 4.8+', result: result.error }
      ]
  }
}

function seriesData(result: MethodResult, quantity: Quantity): { x: Float64Array; y: Float64Array } | null {
  const t = result.trajectory
  switch (quantity) {
    case 'pos':
      return { x: t.time, y: t.pos }
    case 'vel':
      return { x: t.time, y: t.vel }
    case 'accel':
      return { x: t.time, y: t.accel }
    case 'jerk':
      return result.jerk ? { x: result.jerk.time, y: result.jerk.jerk } : null
  }
}

export function quantityTraces(result: SimulationResult | null, quantity: Quantity): Partial<Data>[] {
  if (!result) return []
  const unit = QUANTITY_INFO[quantity].unit
  const traces: Partial<Data>[] = []
  methodSeries(result).forEach((method, i) => {
    const data = method.result && seriesData(method.result, quantity)
    if (!data) return
    traces.push({
      mode: 'lines',
      name: method.name,
      line: { color: defaultColor(i) },
      hovertemplate: `<extra></extra>%{x:.2f} s<br>%{y:.2f} ${unit}`,
      x: data.x,
      y: data.y
    })
  })
  return traces
}

function targetFor(result: SimulationResult | null, quantity: Quantity): number | null {
  if (!result) return null
  switch (quantity) {
    case 'pos':
      return result.targets.angle
    case 'vel':
      return result.targets.rate
    case 'accel':
    case 'jerk':
      return null
  }
}

export function quantityLayout(result: SimulationResult | null, quantity: Quantity): Partial<Layout> {
  const target = targetFor(result, quantity)
  const shapes: Partial<Shape>[] =
    target === null
      ? []
      : [
          {
            type: 'line',
            line: { dash: 'dot', color: 'rgb(140, 140, 140)' },
            xref: 'paper',
            x0: 0,
            x1: 1,
            y0: target,
            y1: target
          }
        ]
  return {
    legend: { itemclick: false, itemdoubleclick: false },
    margin: { b: 50, l: 60, r: 50, t: 20 },
    xaxis: { title: { text: 'Time (s)' } },
    yaxis: { title: { text: QUANTITY_INFO[quantity].axisTitle } },
    shapes
  }
}

export interface QuantityPlot {
  data: Partial<Data>[]
  layout: Partial<Layout>
}

export function quantityPlots(result: SimulationResult | null): Readonly<Record<Quantity, QuantityPlot>> {
  const plot = (q: Quantity): QuantityPlot => ({ data: quantityTraces(result, q), layout: quantityLayout(result, q) })
  return { pos: plot('pos'), vel: plot('vel'), accel: plot('accel'), jerk: plot('jerk') }
}
