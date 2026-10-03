/**
 * Builders turning MAGFit results into Plotly traces and layouts (upstream `setup_plots` and
 * `redraw`). Pure functions so the React components stay declarative.
 */
import { defaultColor, type Data, type Layout } from '@apwt/plot'
import { yawChangeDeg } from '../analysis/expected.js'
import type { FlightData } from '../analysis/flight-data.js'
import type { MotorSource } from '../analysis/motor.js'
import type { PreparedAttitude } from '../analysis/magfit.js'
import { vec3Magnitude, type Vec3Series } from '../analysis/vector.js'
import type { ValidCalibration } from './calibrations.js'

const TIME_LABEL = 'Time (s)'
const MARGIN = { b: 50, l: 60, r: 30, t: 20 }
const NO_LEGEND_CLICK = { itemclick: false, itemdoubleclick: false } as const
const AXIS_FRAME = { zeroline: false, showline: true, mirror: true } as const
const GAUSS_HOVER = '<extra></extra>%{meta}<br>%{x:.2f} s<br>%{y:.2f} mGauss'
const DEG_HOVER = '<extra></extra>%{meta}<br>%{x:.2f} s<br>%{y:.2f} deg'
/** The expected field is drawn wide in a neutral grey that reads on both themes. */
export const EXPECTED_COLOR = '#9ca3af'

// ---------- Flight data ----------

const FLIGHT_SERIES = [
  { key: 'roll', name: 'Roll', unit: 'deg' },
  { key: 'pitch', name: 'Pitch', unit: 'deg' },
  { key: 'throttle', name: 'Throttle', unit: '' },
  { key: 'altitude', name: 'Altitude', unit: 'm' }
] as const

/** Roll, pitch, throttle and altitude on four y axes (upstream "Flight Data" plot). */
export function flightDataTraces(flight: FlightData | null): Partial<Data>[] {
  return FLIGHT_SERIES.map((s, i) => {
    const series = flight?.[s.key]
    return {
      mode: 'lines',
      name: s.name,
      meta: s.name,
      yaxis: i === 0 ? 'y' : `y${String(i + 1)}`,
      hovertemplate: `<extra></extra>%{meta}<br>%{x:.2f} s<br>%{y:.2f} ${s.unit}`,
      x: series?.time ?? [],
      y: series?.values ?? []
    }
  })
}

/** Layout for {@link flightDataTraces}, zoomed to the analysis window when one is given. */
export function flightDataLayout(range: readonly [number, number] | null): Partial<Layout> {
  const positions = [0, 0.06, 0.94, 1]
  const layout: Partial<Layout> & Record<string, unknown> = {
    xaxis: {
      title: { text: TIME_LABEL },
      domain: [0.07, 0.93],
      type: 'linear',
      ...AXIS_FRAME,
      rangeslider: {},
      ...(range ? { range: [...range], autorange: false } : {})
    },
    showlegend: false,
    margin: { b: 50, l: 50, r: 50, t: 20 }
  }
  FLIGHT_SERIES.forEach((s, i) => {
    layout[i === 0 ? 'yaxis' : `yaxis${String(i + 1)}`] = {
      title: { text: s.name },
      ...AXIS_FRAME,
      side: i < 2 ? 'left' : 'right',
      position: positions[i],
      color: defaultColor(i),
      ...(i > 0 ? { overlaying: 'y' } : {})
    }
  })
  return layout
}

// ---------- Time plots of calibrations ----------

/** One calibration of one compass to draw, with its colour and time base. */
export interface PlotEntry {
  /** 0-based compass index. */
  readonly compass: number
  readonly calibration: ValidCalibration
  readonly time: Float64Array
  /** Attitude yaw at the compass samples, radians. */
  readonly attitudeYaw: Float64Array
  /** Heading from the existing calibration, radians. */
  readonly existingYaw: Float64Array
  readonly color: string
}

function entryTrace(e: PlotEntry, y: Float64Array, hover: string): Partial<Data> {
  const name = `Mag ${String(e.compass + 1)}`
  return {
    mode: 'lines',
    name,
    meta: `${name}, ${e.calibration.label}`,
    legendgroup: e.calibration.label,
    legendgrouptitle: { text: e.calibration.label },
    line: { color: e.color, width: 1.5 },
    hovertemplate: hover,
    x: e.time,
    y
  }
}

/** Body-frame field component: expected (from the attitude source) and each calibration. */
export function componentTraces(axis: keyof Vec3Series, attitude: PreparedAttitude | null, entries: readonly PlotEntry[]) {
  const traces: Partial<Data>[] = []
  if (attitude) {
    traces.push({
      mode: 'lines',
      name: 'Expected',
      meta: 'Expected',
      line: { width: 4, color: EXPECTED_COLOR },
      hovertemplate: GAUSS_HOVER,
      x: attitude.source.time,
      y: attitude.expected[axis]
    })
  }
  for (const e of entries) traces.push(entryTrace(e, e.calibration.field[axis], GAUSS_HOVER))
  return traces
}

/** Distance between each calibrated field and the expected field. */
export function errorTraces(entries: readonly PlotEntry[]): Partial<Data>[] {
  return entries.map((e) => entryTrace(e, e.calibration.error, GAUSS_HOVER))
}

/** Length of each calibrated field, with the expected earth field strength as a reference line. */
export function lengthTraces(
  intensityMilliGauss: number | null,
  range: readonly [number, number] | null,
  entries: readonly PlotEntry[]
) {
  const traces: Partial<Data>[] = []
  if (intensityMilliGauss !== null && range) {
    traces.push({
      mode: 'lines',
      name: 'Expected',
      meta: 'Expected',
      line: { width: 4, color: EXPECTED_COLOR },
      hovertemplate: GAUSS_HOVER,
      x: [...range],
      y: [intensityMilliGauss, intensityMilliGauss]
    })
  }
  for (const e of entries) traces.push(entryTrace(e, vec3Magnitude(e.calibration.field), GAUSS_HOVER))
  return traces
}

/** Heading change of each fit relative to the existing calibration (existing itself is omitted). */
export function yawVsExistingTraces(entries: readonly PlotEntry[]): Partial<Data>[] {
  return entries
    .filter((e) => e.calibration.id !== 'existing')
    .map((e) => entryTrace(e, yawChangeDeg(e.calibration.yaw, e.existingYaw), DEG_HOVER))
}

/** Heading of each calibration relative to the attitude source's yaw. */
export function yawVsAttitudeTraces(entries: readonly PlotEntry[]): Partial<Data>[] {
  return entries.map((e) => entryTrace(e, yawChangeDeg(e.calibration.yaw, e.attitudeYaw), DEG_HOVER))
}

/** Interference sources used for motor compensation (battery current). */
export function motorTraces(sources: readonly MotorSource[]): Partial<Data>[] {
  return sources.map((s) => ({
    mode: 'lines',
    name: s.name,
    meta: s.name,
    hovertemplate: '<extra></extra>%{meta}<br>%{x:.2f} s<br>%{y:.2f} A',
    x: s.time,
    y: s.value
  }))
}

/** Layout for a time plot, zoomed to the analysis window. */
export function timeLayout(yTitle: string, range: readonly [number, number] | null): Partial<Layout> {
  return {
    showlegend: true,
    legend: NO_LEGEND_CLICK,
    margin: MARGIN,
    xaxis: { title: { text: TIME_LABEL }, ...AXIS_FRAME, ...(range ? { range: [...range], autorange: false } : {}) },
    yaxis: { title: { text: yTitle }, ...AXIS_FRAME }
  }
}

// ---------- Mean error bars ----------

/** One compass's bars: label and mean error of the existing calibration and every valid fit. */
export interface ErrorBars {
  readonly compass: number
  readonly bars: readonly { readonly label: string; readonly meanError: number }[]
}

/** Grouped bars of mean error per calibration, one colour per compass (upstream error bar plot). */
export function errorBarTraces(compasses: readonly ErrorBars[]): Partial<Data>[] {
  return compasses.map((c) => {
    const name = `Mag ${String(c.compass + 1)}`
    return {
      type: 'bar',
      name,
      meta: name,
      marker: { color: defaultColor(c.compass + 1) },
      hovertemplate: '<extra></extra>%{meta}<br>%{x}<br>%{y:.2f} mGauss',
      x: c.bars.map((b) => b.label.replace(', ', '<br>')),
      y: c.bars.map((b) => b.meanError)
    }
  })
}

/** Layout for {@link errorBarTraces}. */
export function errorBarLayout(): Partial<Layout> {
  return {
    barmode: 'group',
    legend: NO_LEGEND_CLICK,
    margin: { b: 80, l: 60, r: 30, t: 20 },
    xaxis: { ...AXIS_FRAME },
    yaxis: { title: { text: 'Mean field error (mGauss)' }, ...AXIS_FRAME }
  }
}
