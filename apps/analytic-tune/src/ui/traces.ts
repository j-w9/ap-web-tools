/**
 * Builders turning analysis results into Plotly traces and layouts, following upstream
 * `setup_plots` and `redraw_freq_resp`. Pure functions so the components stay declarative.
 */
import { defaultColor, type Data, type Layout } from '@apwt/plot'
import {
  frequencyHover,
  frequencyIn,
  frequencyLabel,
  gainHover,
  gainLabel,
  gainOf,
  phaseOf,
  type DisplaySettings,
  type LoopComparison
} from '../analysis/display.js'
import type { SidFlightData } from '../analysis/load.js'

const MARGIN = { b: 50, l: 50, r: 50, t: 20 }
const AXIS_FRAME = { zeroline: false, showline: true, mirror: true } as const
const NO_LEGEND_CLICK = { itemclick: false, itemdoubleclick: false } as const

// ---------- Flight data ----------

const FLIGHT_SERIES = [
  { key: 'target', name: 'Targ', unit: 'deg' },
  { key: 'gyroX', name: 'Roll', unit: 'deg/s' },
  { key: 'gyroY', name: 'Pitch', unit: 'deg/s' },
  { key: 'gyroZ', name: 'Yaw', unit: 'deg/s' }
] as const

export function flightDataTraces(flight: SidFlightData | null): Partial<Data>[] {
  return FLIGHT_SERIES.map((s, i) => ({
    mode: 'lines',
    name: s.name,
    meta: s.name,
    yaxis: i === 0 ? 'y' : `y${i + 1}`,
    hovertemplate: `<extra></extra>%{meta}<br>%{x:.2f} s<br>%{y:.2f} ${s.unit}`,
    x: flight ? flight.time : [],
    y: flight ? Array.from(flight[s.key]) : []
  }))
}

export function flightDataLayout(range: readonly [number, number] | null): Partial<Layout> {
  const positions = [0, 0.06, 0.94, 1]
  const layout: Partial<Layout> & Record<string, unknown> = {
    xaxis: {
      title: { text: 'Time (s)' },
      domain: [0.07, 0.93],
      type: 'linear',
      ...AXIS_FRAME,
      rangeslider: {},
      ...(range ? { range: [...range], autorange: false } : {})
    },
    showlegend: false,
    margin: MARGIN
  }
  FLIGHT_SERIES.forEach((s, i) => {
    layout[i === 0 ? 'yaxis' : `yaxis${i + 1}`] = {
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

// ---------- Calculated vs predicted ----------

export interface ComparisonPlots {
  readonly magnitude: Partial<Data>[]
  readonly phase: Partial<Data>[]
  readonly coherence: Partial<Data>[]
}

type Settings = Pick<DisplaySettings, 'gain' | 'phase' | 'frequencyUnit'>

const SERIES = [
  { key: 'calculated', name: 'Calculated' },
  { key: 'predicted', name: 'Predicted' }
] as const

/** Magnitude, phase and coherence traces of the calculated (measured) and predicted responses. */
export function comparisonTraces(comparison: LoopComparison | null, freqHz: Float64Array | null, s: Settings): ComparisonPlots {
  const x = freqHz ? Array.from(frequencyIn(freqHz, s.frequencyUnit)) : []
  const xHover = frequencyHover(s.frequencyUnit, 'x')
  const trace = (i: number, y: ArrayLike<number> | null, visible: boolean, hover: string): Partial<Data> => ({
    mode: 'lines',
    name: SERIES[i]!.name,
    meta: `Closed Loop Rate ${SERIES[i]!.name}`,
    hovertemplate: `<extra></extra>%{meta}<br>${xHover}<br>${hover}`,
    line: { color: defaultColor(i) },
    x,
    y: y ? Array.from(y) : [],
    visible
  })
  const build = (make: (r: LoopComparison['calculated']) => ArrayLike<number>, hover: string) =>
    SERIES.map((series, i) => {
      const r = comparison?.[series.key]
      return trace(i, r ? make(r) : null, r?.visible ?? true, hover)
    })
  return {
    magnitude: build((r) => gainOf(r.H, s.gain), gainHover(s.gain, 'y')),
    phase: build((r) => phaseOf(r.H, s.phase), '%{y:.2f} deg'),
    coherence: build((r) => r.coherence, '%{y:.2f}')
  }
}

function frequencyLayout(yTitle: string, s: Pick<DisplaySettings, 'frequencyAxis' | 'frequencyUnit'>): Partial<Layout> {
  return {
    xaxis: { title: { text: frequencyLabel(s.frequencyUnit) }, type: s.frequencyAxis, ...AXIS_FRAME },
    yaxis: { title: { text: yTitle }, ...AXIS_FRAME },
    showlegend: true,
    legend: NO_LEGEND_CLICK,
    margin: MARGIN
  }
}

export const magnitudeLayout = (s: DisplaySettings) => frequencyLayout(gainLabel(s.gain), s)
export const phaseLayout = (s: DisplaySettings) => frequencyLayout('Phase (deg)', s)
export const coherenceLayout = (s: DisplaySettings) => frequencyLayout('Coherence', s)
