/**
 * Builders turning the loaded log and fit results into Plotly traces and layouts (upstream
 * `build_flight_data_plot` and the `redraw_*` functions). Pure, so the components stay declarative.
 */
import { defaultColor, type Data, type Layout, type PlotData } from '@apwt/plot'
import type { CombinedFit } from '../analysis/core.js'
import type { SensorSeries } from '../analysis/fit.js'
import type { AirspeedLog } from '../analysis/load.js'

const AXIS_FRAME = { zeroline: false, showline: true, mirror: true } as const

/** Airspeed sensor colours on the flight data plot: sensor 1 blue, later ones lighter blue. */
const AIRSPEED_COLORS = ['#1f77b4', '#6baed6', '#9ecae1', '#c6dbef'] as const
/** Per-sensor line colours on the result plots. */
const SENSOR_COLORS = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728'] as const

function pick(colors: readonly [string, ...string[]], i: number): string {
  return colors[Math.min(i, colors.length - 1)] ?? colors[0]
}

export const airspeedColor = (i: number): string => pick(AIRSPEED_COLORS, i)
export const sensorColor = (i: number): string => pick(SENSOR_COLORS, i)

const sensorLabel = (instance: number): string => `Sensor ${instance + 1}`

// ---------- Flight data ----------

function line(
  name: string,
  yaxis: string,
  color: string,
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  unit: string,
  dp: number
): Partial<Data> {
  return {
    mode: 'lines',
    name,
    meta: name,
    yaxis,
    line: { color },
    hovertemplate: `<extra></extra>%{meta}<br>%{x:.2f} s<br>%{y:.${dp}f} ${unit}`,
    x: Array.from(x),
    y: Array.from(y)
  }
}

/** Reported airspeed per sensor, ground speed of the first source, altitude and roll. */
export function flightDataTraces(log: AirspeedLog | null, groundSpeed: Float64Array | null): Partial<Data>[] {
  if (!log) return []
  const traces = log.sensors.map((s, i) =>
    line(`Airspeed ${s.instance + 1}`, 'y', airspeedColor(i), s.time, s.airspeed, 'm/s', 2)
  )
  if (groundSpeed) traces.push(line('Ground speed', 'y2', defaultColor(2), log.sources[0].time, groundSpeed, 'm/s', 2))
  traces.push(line('Altitude', 'y3', defaultColor(3), log.pos.time, log.pos.relAlt, 'm', 1))
  if (log.att) traces.push(line('Roll', 'y4', defaultColor(4), log.att.time, log.att.roll, 'deg', 1))
  return traces
}

export function flightDataLayout(range: readonly [number, number] | null): Partial<Layout> {
  return {
    xaxis: {
      title: { text: 'Time (s)' },
      domain: [0.07, 0.93],
      type: 'linear',
      ...AXIS_FRAME,
      rangeslider: {},
      ...(range ? { range: [...range], autorange: false } : {})
    },
    yaxis: { title: { text: 'Airspeed (m/s)' }, ...AXIS_FRAME, side: 'left', position: 0, color: airspeedColor(0) },
    yaxis2: {
      title: { text: 'Ground speed (m/s)' },
      ...AXIS_FRAME,
      side: 'left',
      position: 0.06,
      color: defaultColor(2),
      overlaying: 'y'
    },
    yaxis3: {
      title: { text: 'Altitude (m)' },
      ...AXIS_FRAME,
      side: 'right',
      position: 1,
      color: defaultColor(3),
      overlaying: 'y'
    },
    yaxis4: {
      title: { text: 'Roll (deg)' },
      ...AXIS_FRAME,
      side: 'right',
      position: 0.94,
      color: defaultColor(4),
      overlaying: 'y'
    },
    showlegend: true,
    legend: { itemclick: false, itemdoubleclick: false, orientation: 'h', x: 0.07, y: 1.02, yanchor: 'bottom' },
    margin: { b: 50, l: 50, r: 50, t: 40 }
  }
}

// ---------- Results ----------

/** One sensor's series for the result plots. */
export interface SensorPlotSeries {
  readonly instance: number
  readonly series: SensorSeries
}

const HOVER_SPEED = '<extra></extra>%{y:.2f} m/s at %{x:.1f} s'
const TOGGLE_LEGEND = { itemclick: 'toggle', itemdoubleclick: 'toggleothers', groupclick: 'toggleitem' } as const

/** Time from the start of the fitted window. */
function windowTime(model: CombinedFit): number[] {
  const t0 = model.t[0] ?? 0
  return Array.from(model.t, (x) => x - t0)
}

function beforeAfter(
  x: number[],
  sensors: readonly SensorPlotSeries[],
  value: (s: SensorSeries['after']) => Float64Array,
  widths: { before: number; after: number }
): Partial<Data>[] {
  return sensors.flatMap(({ instance, series }, i) => {
    const color = sensorColor(i)
    const group = { legendgroup: `s${i}`, legendgrouptitle: { text: sensorLabel(instance) } }
    const traces: Partial<Data>[] = []
    if (series.before) {
      traces.push({
        mode: 'lines',
        name: 'before',
        ...group,
        line: { color, width: widths.before, dash: 'dot' },
        opacity: 0.7,
        hovertemplate: HOVER_SPEED,
        x,
        y: Array.from(value(series.before))
      })
    }
    traces.push({
      mode: 'lines',
      name: 'after',
      ...group,
      line: { color, width: widths.after },
      hovertemplate: HOVER_SPEED,
      x,
      y: Array.from(value(series.after))
    })
    return traces
  })
}

/**
 * Expected (truth) airspeed and each sensor's calibrated airspeed before (dotted) and after
 * (solid). The truth is drawn last, in the theme's text colour, so it sits on top.
 */
export function airspeedTraces(model: CombinedFit, sensors: readonly SensorPlotSeries[], truthColor: string): Partial<Data>[] {
  const x = windowTime(model)
  return [
    ...beforeAfter(x, sensors, (s) => s.predicted, { before: 1, after: 1.2 }),
    {
      mode: 'lines',
      name: 'Expected',
      line: { color: truthColor, width: 1.5 },
      hovertemplate: HOVER_SPEED,
      x,
      y: Array.from(model.truth)
    }
  ]
}

const RESULT_MARGIN = { b: 50, l: 60, r: 30, t: 20 }
const WINDOW_AXIS = { title: { text: 'Time in window (s)' }, ...AXIS_FRAME }

export const AIRSPEED_LAYOUT: Partial<Layout> = {
  xaxis: WINDOW_AXIS,
  yaxis: { title: { text: 'True airspeed (m/s)' }, ...AXIS_FRAME },
  showlegend: true,
  legend: TOGGLE_LEGEND,
  margin: RESULT_MARGIN
}

/** Residuals (truth minus calibrated) before and after, per sensor. */
export function residualTraces(model: CombinedFit, sensors: readonly SensorPlotSeries[]): Partial<Data>[] {
  return beforeAfter(windowTime(model), sensors, (s) => s.residual, { before: 0.8, after: 0.9 })
}

export const RESIDUAL_LAYOUT: Partial<Layout> = {
  xaxis: WINDOW_AXIS,
  yaxis: { title: { text: 'Residual (m/s)' }, ...AXIS_FRAME, zeroline: true },
  showlegend: true,
  legend: TOGGLE_LEGEND,
  margin: RESULT_MARGIN
}

/** Bar attributes missing from the Plotly typings. */
type GroupedBar = Partial<PlotData> & { offsetgroup: string; alignmentgroup: string }

const fmt = (v: number | null): string => (v === null || !isFinite(v) ? 'n/a' : v.toFixed(2))

/**
 * RMS error before ("Existing") and after ("Fitted") per sensor, with a narrow dark bar on top
 * showing the magnitude of the mean error (bias), which the fit drives to about zero.
 */
export function rmsBarTraces(sensors: readonly SensorPlotSeries[], biasColor: string): Partial<Data>[] {
  const categories = ['Existing', 'Fitted']
  const rms: GroupedBar[] = []
  const bias: GroupedBar[] = []
  sensors.forEach(({ instance, series }, i) => {
    const offsetgroup = `s${i}`
    const values = [series.before?.rms ?? NaN, series.after.rms]
    const signed = [series.before?.mean ?? NaN, series.after.mean]
    rms.push({
      type: 'bar',
      name: sensorLabel(instance),
      offsetgroup,
      alignmentgroup: 'g',
      marker: { color: sensorColor(i), opacity: 0.55 },
      hovertemplate: '<extra></extra>RMS %{y:.2f} m/s',
      x: categories,
      y: values,
      text: values.map(fmt),
      textposition: 'outside',
      cliponaxis: false
    })
    bias.push({
      type: 'bar',
      name: 'mean error',
      legendgroup: 'mean',
      offsetgroup,
      alignmentgroup: 'g',
      width: 0.16,
      showlegend: i === 0,
      marker: { color: biasColor },
      customdata: signed,
      hovertemplate: '<extra></extra>mean error %{customdata:.2f} m/s',
      x: categories,
      y: signed.map(Math.abs)
    })
  })
  return [...rms, ...bias]
}

export const RMS_LAYOUT: Partial<Layout> = {
  barmode: 'group',
  xaxis: { showline: true, mirror: true },
  yaxis: { title: { text: 'Residual error (m/s)' }, ...AXIS_FRAME, zeroline: true, rangemode: 'tozero' },
  showlegend: true,
  margin: { b: 40, l: 60, r: 30, t: 20 }
}

/** Smoothed wind with one-sigma bands, plus the onboard EKF wind when logged. */
export function windTraces(
  model: CombinedFit,
  ekf: { readonly north: Float64Array; readonly east: Float64Array } | null
): Partial<Data>[] {
  const x = windowTime(model)
  const back = [...x].reverse()
  const band = (mean: Float64Array, sigma: Float64Array, fillcolor: string): Partial<Data> => ({
    x: [...x, ...back],
    y: [...Array.from(mean, (v, i) => v + sigma[i]!), ...Array.from(mean, (v, i) => v - sigma[i]!).reverse()],
    fill: 'toself',
    fillcolor,
    line: { width: 0 },
    hoverinfo: 'skip',
    showlegend: false
  })
  const north = defaultColor(0)
  const east = defaultColor(1)
  const traces: Partial<Data>[] = [
    band(model.windNorth, model.windSigmaNorth, 'rgba(31,119,180,0.15)'),
    band(model.windEast, model.windSigmaEast, 'rgba(255,127,14,0.15)'),
    {
      mode: 'lines',
      name: 'Wn (North)',
      line: { color: north, width: 2 },
      hovertemplate: '<extra></extra>Wn %{y:.2f} m/s',
      x,
      y: Array.from(model.windNorth)
    },
    {
      mode: 'lines',
      name: 'We (East)',
      line: { color: east, width: 2 },
      hovertemplate: '<extra></extra>We %{y:.2f} m/s',
      x,
      y: Array.from(model.windEast)
    }
  ]
  if (ekf) {
    for (const [name, color, y] of [
      ['EKF Wn', north, ekf.north],
      ['EKF We', east, ekf.east]
    ] as const) {
      traces.push({
        mode: 'lines',
        name,
        line: { color, width: 1, dash: 'dot' },
        opacity: 0.6,
        hovertemplate: `<extra></extra>${name} %{y:.2f} m/s`,
        x,
        y: Array.from(y)
      })
    }
  }
  return traces
}

export function windLayout(drift: number): Partial<Layout> {
  return {
    title: { text: `Estimated wind vs onboard EKF wind (drift ${fmt(drift)} m/s)` },
    xaxis: WINDOW_AXIS,
    yaxis: { title: { text: 'Wind component (m/s)' }, ...AXIS_FRAME, zeroline: true },
    showlegend: true,
    legend: { itemclick: 'toggle', itemdoubleclick: 'toggleothers', orientation: 'h' },
    margin: { b: 50, l: 60, r: 30, t: 40 }
  }
}
