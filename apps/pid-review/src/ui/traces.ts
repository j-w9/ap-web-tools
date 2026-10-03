/**
 * Builders turning analysis results into Plotly traces and layouts. Pure functions so the
 * React components stay declarative and the plots are easy to test.
 */
import { defaultColor, type Data, type Layout, type Shape } from '@apwt/plot'
import type { AmplitudeScale, FrequencyScale } from '@apwt/signal'
import type { FlightData, PidAxisData, PidAxisFft } from '../analysis/data.js'
import { FFT_KEYS, KEY_LABELS, type FftKey } from '../analysis/keys.js'
import { meanSpectrum } from '../analysis/spectrum.js'
import { spectrogramData } from '../analysis/spectrogram.js'
import type { SetStepResponse } from '../analysis/step-response.js'

const TIME_LABEL = 'Time (s)'
const MARGIN = { b: 50, l: 50, r: 50, t: 20 }
const NO_LEGEND_CLICK = { itemclick: false, itemdoubleclick: false } as const
const AXIS_FRAME = { zeroline: false, showline: true, mirror: true } as const

// ---------- Flight data ----------

const FLIGHT_SERIES = [
  { key: 'roll', name: 'Roll', unit: 'deg' },
  { key: 'pitch', name: 'Pitch', unit: 'deg' },
  { key: 'throttle', name: 'Throttle', unit: '' },
  { key: 'altitude', name: 'Altitude', unit: 'm' }
] as const

export function flightDataTraces(flight: FlightData | null): Partial<Data>[] {
  return FLIGHT_SERIES.map((s, i) => {
    const series = flight?.[s.key]
    return {
      mode: 'lines',
      name: s.name,
      meta: s.name,
      yaxis: i === 0 ? 'y' : `y${i + 1}`,
      hovertemplate: `<extra></extra>%{meta}<br>%{x:.2f} s<br>%{y:.2f} ${s.unit}`,
      x: series?.time ?? [],
      y: series?.values ?? []
    }
  })
}

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

// ---------- Time domain ----------

const INPUT_KEYS: readonly FftKey[] = ['Tar', 'Act', 'Err']
const OUTPUT_KEYS: readonly FftKey[] = ['P', 'I', 'D', 'FF', 'DFF', 'Out']

function concatWithGaps(data: PidAxisData, key: FftKey): { x: number[]; y: number[] } {
  const x: number[] = []
  const y: number[] = []
  for (const set of data.sets) {
    if (!set) continue
    set.forEach((batch, i) => {
      if (i > 0) {
        x.push(NaN)
        y.push(NaN)
      }
      const values = batch.signals[key]
      for (let j = 0; j < batch.time.length; j++) {
        x.push(batch.time[j] as number)
        y.push(values ? (values[j] as number) : NaN)
      }
    })
  }
  return { x, y }
}

function timeTraces(data: PidAxisData | null, keys: readonly FftKey[]): Partial<Data>[] {
  return keys.map((key) => ({
    mode: 'lines',
    name: KEY_LABELS[key],
    meta: KEY_LABELS[key],
    showlegend: true,
    hovertemplate: '<extra></extra>%{meta}<br>%{x:.2f} s<br>%{y:.2f}',
    ...(data ? concatWithGaps(data, key) : { x: [], y: [] })
  }))
}

export const timeInputTraces = (data: PidAxisData | null) => timeTraces(data, INPUT_KEYS)
export const timeOutputTraces = (data: PidAxisData | null) => timeTraces(data, OUTPUT_KEYS)

/** Shaded rectangles marking each parameter set when there is more than one. */
function paramSetShapes(data: PidAxisData | null, log: { startTime: number; endTime: number } | null): Partial<Shape>[] {
  if (!data || !log || data.paramSets.sets.length <= 1) return []
  return data.paramSets.sets.map((set, i) => ({
    type: 'rect',
    line: { width: 0 },
    yref: 'paper',
    y0: 0,
    y1: 1,
    x0: Math.max(log.startTime, set.startTime),
    x1: Math.min(log.endTime, set.endTime),
    fillcolor: defaultColor(i),
    opacity: 0.4,
    label: { text: String(i + 1), textposition: 'top left' },
    layer: 'below'
  }))
}

export function timeDomainLayout(
  yTitle: string,
  range: readonly [number, number] | null,
  data: PidAxisData | null,
  log: { startTime: number; endTime: number } | null
): Partial<Layout> {
  return {
    legend: NO_LEGEND_CLICK,
    margin: MARGIN,
    xaxis: { title: { text: TIME_LABEL }, ...(range ? { range: [...range], autorange: false } : {}) },
    yaxis: { title: { text: yTitle } },
    shapes: paramSetShapes(data, log)
  }
}

// ---------- Spectrum ----------

export interface SpectrumOptions {
  amplitude: AmplitudeScale
  frequency: FrequencyScale
  range: readonly [number, number]
  shownKeys: ReadonlySet<FftKey>
  shownSets: readonly boolean[]
}

export function spectrumTraces(fft: PidAxisFft | null, o: SpectrumOptions): Partial<Data>[] {
  if (!fft) return []
  const bins = o.frequency.transform(fft.axis.bins)
  const multi = fft.sets.length > 1
  const hover = `<extra></extra>%{meta}<br>${o.frequency.hover('x')}<br>${o.amplitude.hover('y')}`
  const traces: Partial<Data>[] = []
  fft.sets.forEach((set, i) => {
    for (const key of FFT_KEYS) {
      const y = set ? meanSpectrum(set, key, fft.axis, o.amplitude, o.range) : null
      traces.push({
        mode: 'lines',
        name: KEY_LABELS[key],
        meta: (multi ? `${i + 1} ` : '') + KEY_LABELS[key],
        hovertemplate: hover,
        x: y ? bins : [],
        y: y ?? [],
        visible: y != null && o.shownKeys.has(key) && (o.shownSets[i] ?? false),
        ...(multi ? { legendgroup: String(i), legendgrouptitle: { text: `Test ${i + 1}` } } : {})
      })
    }
  })
  return traces
}

export function spectrumLayout(amplitude: AmplitudeScale, frequency: FrequencyScale): Partial<Layout> {
  return {
    xaxis: { title: { text: frequency.label }, type: frequency.type, ...AXIS_FRAME },
    yaxis: { title: { text: amplitude.label }, ...AXIS_FRAME },
    showlegend: true,
    legend: NO_LEGEND_CLICK,
    margin: MARGIN
  }
}

// ---------- Step response ----------

export function stepTraces(steps: readonly (SetStepResponse | null)[] | null, shownSets: readonly boolean[]): Partial<Data>[] {
  if (!steps) return []
  const multi = steps.length > 1
  const visibleMeans = steps.filter((s, i) => s && (shownSets[i] ?? false)).length
  const traces: Partial<Data>[] = []
  steps.forEach((step, i) => {
    const name = `Test ${i + 1}`
    const shown = step != null && (shownSets[i] ?? false)
    // All individual estimates, joined with NaN breaks.
    const x: number[] = []
    const y: number[] = []
    for (const s of step?.all ?? []) {
      x.push(...step!.time, NaN)
      y.push(...s, NaN)
    }
    traces.push({
      mode: 'lines',
      line: { color: 'rgba(100, 100, 100, 0.2)' },
      hoverinfo: 'none',
      showlegend: false,
      x,
      y,
      // Individual estimates only when exactly one set is shown, as upstream.
      visible: shown && visibleMeans === 1
    })
    traces.push({
      mode: 'lines',
      line: { width: 4, color: defaultColor(i) },
      name,
      meta: name,
      hovertemplate: '<extra></extra>%{meta}<br>%{x:.2f} s<br>%{y:.2f}',
      showlegend: multi,
      x: step?.time ?? [],
      y: step?.mean ?? [],
      visible: shown
    })
  })
  return traces
}

export function stepLayout(): Partial<Layout> {
  return {
    xaxis: { title: { text: TIME_LABEL }, ...AXIS_FRAME },
    yaxis: { title: { text: 'Response' }, ...AXIS_FRAME, range: [0, 2], autorange: false },
    showlegend: true,
    legend: NO_LEGEND_CLICK,
    margin: MARGIN,
    shapes: [{ type: 'line', line: { dash: 'dot' }, xref: 'paper', x0: 0, x1: 1, y0: 1, y1: 1 }]
  }
}

// ---------- Spectrogram ----------

export function spectrogramTrace(
  fft: PidAxisFft | null,
  key: FftKey,
  amplitude: AmplitudeScale,
  frequency: FrequencyScale
): Partial<Data>[] {
  const data = fft ? spectrogramData(fft.sets, key, fft.axis, amplitude) : null
  const bins = fft ? frequency.transform(fft.axis.bins) : new Float64Array(0)
  return [
    {
      type: 'heatmap',
      colorbar: { title: { side: 'right', text: amplitude.label }, orientation: 'h' },
      transpose: true,
      zsmooth: 'best',
      hovertemplate: `<extra></extra>%{x:.2f} s<br>${frequency.hover('y')}<br>${amplitude.hover('z')}`,
      y: bins,
      x: data?.x ?? [],
      z: data ? data.z.map((row) => (row ? Array.from(row) : new Array<null>(bins.length).fill(null))) : []
    } as Partial<Data>
  ]
}

export function spectrogramLayout(frequency: FrequencyScale, range: readonly [number, number] | null): Partial<Layout> {
  return {
    xaxis: { title: { text: TIME_LABEL }, ...AXIS_FRAME, ...(range ? { range: [...range], autorange: false } : {}) },
    yaxis: { title: { text: frequency.label }, type: frequency.type, ...AXIS_FRAME },
    showlegend: true,
    legend: NO_LEGEND_CLICK,
    margin: MARGIN
  }
}
