/**
 * Builders turning Filter Review analysis results into Plotly traces and layouts. Pure
 * functions, so the React components stay declarative.
 */
import { defaultColor, type Data, type Layout, type Shape } from '@apwt/plot'
import type { AmplitudeScale, ComplexArray, FrequencyScale } from '@apwt/signal'
import type { InstanceAnalysis, InstanceTransfer } from '../analysis/analyse.js'
import { MAX_GYROS, MAX_NUM_HARMONICS } from '../analysis/constants.js'
import { GYRO_AXES, type GyroAxis } from '../analysis/fft/batch-fft.js'
import type { FlightData } from '../analysis/flight-data.js'
import { aliasHelper, type AliasMode } from '../analysis/plots/alias.js'
import type { BodeResponse } from '../analysis/plots/bode.js'
import type { HarmonicMarker, TrackingLine } from '../analysis/plots/notch-lines.js'
import { spectrogramData } from '../analysis/plots/spectrogram.js'
import { estimatedPostSpectrum, meanSpectrum } from '../analysis/plots/spectrum.js'
import type { TimeRange } from '../analysis/time-index.js'
import {
  SPECTRUM_KINDS,
  SPECTRUM_LABELS,
  spectrumTraceKey,
  type SpectrumKind,
  type SpectrumTraceKey
} from '../analysis/selections.js'

const TIME_LABEL = 'Time (s)'
const MARGIN = { b: 50, l: 50, r: 50, t: 20 }
const NO_LEGEND_CLICK = { itemclick: false, itemdoubleclick: false } as const
const AXIS_FRAME = { zeroline: false, showline: true, mirror: true } as const

export {
  SPECTRUM_KINDS,
  SPECTRUM_LABELS,
  spectrumTraceKey,
  type SpectrumKind,
  type SpectrumTraceKey
} from '../analysis/selections.js'

/** One analysed gyro instance and its simulated filter response. */
export interface AnalysedInstance {
  readonly analysis: InstanceAnalysis
  readonly transfer: InstanceTransfer | null
}

// ---------- Flight data ----------

const FLIGHT_SERIES = [
  { key: 'roll', name: 'Roll', unit: 'deg' },
  { key: 'pitch', name: 'Pitch', unit: 'deg' },
  { key: 'throttle', name: 'Throttle', unit: '' },
  { key: 'altitude', name: 'Altitude', unit: 'm' }
] as const

/** Roll, pitch, throttle and altitude on four y axes. */
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
      y: series?.value ?? []
    }
  })
}

/** Flight data layout; `range` is the selected analysis window. */
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

// ---------- Spectrum ----------

/** Settings shared by the spectrum, Bode and spectrogram builders. */
export interface ScaleSettings {
  readonly amplitude: AmplitudeScale
  readonly frequency: FrequencyScale
  readonly alias: AliasMode
  /** `SCHED_LOOP_RATE`, the rate frequencies alias against. */
  readonly loopRate: number
}

/** Options for {@link spectrumTraces}. */
export interface SpectrumOptions extends ScaleSettings {
  readonly range: TimeRange
  readonly shown: ReadonlySet<SpectrumTraceKey>
  readonly quantizationNoise: number
}

interface Line {
  x: Float64Array
  y: Float64Array
}

/**
 * The 27 FFT lines (3 gyros x pre / post / estimate x 3 axes), in the upstream order so the
 * colours match. Lines without data are present but hidden.
 */
export function spectrumTraces(instances: readonly AnalysedInstance[], o: SpectrumOptions): Partial<Data>[] {
  const lines = new Map<SpectrumTraceKey, Line>()
  for (const { analysis, transfer } of instances) {
    const { fft, instance } = analysis
    if (fft.x.length === 0) continue
    const alias = aliasHelper(fft, o.alias, o.loopRate)
    const x = o.frequency.transform(alias.bins)
    const kind: SpectrumKind = instance.postFilter ? 'post' : 'pre'
    for (const axis of GYRO_AXES) {
      const mean = meanSpectrum(fft, axis, o.amplitude, o.range)
      if (mean) lines.set(spectrumTraceKey(instance.sensorNum, kind, axis), { x, y: o.amplitude.scale(alias.apply(mean)) })
      const h = transfer?.fft
      if (h === undefined) continue
      const est = estimatedPostSpectrum(fft, axis, o.amplitude, o.range, h, o.quantizationNoise)
      if (est) lines.set(spectrumTraceKey(instance.sensorNum, 'est', axis), { x, y: o.amplitude.scale(alias.apply(est)) })
    }
  }

  const hover = `<extra></extra>%{meta}<br>${o.frequency.hover('x')}<br>${o.amplitude.hover('y')}`
  const traces: Partial<Data>[] = []
  for (let sensor = 0; sensor < MAX_GYROS; sensor++) {
    for (const kind of SPECTRUM_KINDS) {
      for (const axis of GYRO_AXES) {
        const key = spectrumTraceKey(sensor, kind, axis)
        const line = lines.get(key)
        const name = `${axis.toUpperCase()} ${SPECTRUM_LABELS[kind]}`
        traces.push({
          mode: 'lines',
          name,
          meta: `${sensor + 1} ${name}`,
          legendgroup: String(sensor),
          legendgrouptitle: { text: `Gyro ${sensor + 1}` },
          hovertemplate: hover,
          x: line?.x ?? [],
          y: line?.y ?? [],
          visible: line !== undefined && o.shown.has(key)
        })
      }
    }
  }
  return traces
}

/** Notch markers of one harmonic notch: a line at the mean and a band over the range. */
export interface NotchMarkerSet {
  readonly markers: readonly HarmonicMarker[]
  readonly shown: boolean
}

/** Vertical lines and shaded bands for the notch frequencies over the analysis window. */
export function notchShapes(notches: readonly NotchMarkerSet[], frequency: FrequencyScale): Partial<Shape>[] {
  const shapes: Partial<Shape>[] = []
  notches.forEach((notch, i) => {
    if (!notch.shown) return
    const dash = i === 0 ? 'solid' : 'dot'
    for (const m of notch.markers) {
      const scaled = frequency.transform([m.mean, m.min, m.max])
      const mean = scaled[0] ?? NaN
      const min = scaled[1] ?? NaN
      const max = scaled[2] ?? NaN
      // Mid grey reads on both the light and dark plot themes
      shapes.push({ type: 'line', line: { dash, color: 'rgb(140, 140, 140)' }, yref: 'paper', y0: 0, y1: 1, x0: mean, x1: mean })
      shapes.push({
        type: 'rect',
        line: { width: 0 },
        yref: 'paper',
        y0: 0,
        y1: 1,
        x0: min,
        x1: max,
        fillcolor: '#d3d3d3',
        opacity: 0.4
      })
    }
  })
  return shapes
}

/** FFT plot layout. */
export function spectrumLayout(amplitude: AmplitudeScale, frequency: FrequencyScale, shapes: Partial<Shape>[]): Partial<Layout> {
  return {
    xaxis: { title: { text: frequency.label }, type: frequency.type, ...AXIS_FRAME },
    yaxis: { title: { text: amplitude.label }, ...AXIS_FRAME },
    showlegend: true,
    legend: NO_LEGEND_CLICK,
    margin: MARGIN,
    shapes
  }
}

// ---------- Bode ----------

/** Amplitude band, phase band, mean amplitude and mean phase of the simulated filters. */
export function bodeTraces(
  bode: BodeResponse | null,
  phase: readonly Float64Array[] | null,
  amplitude: AmplitudeScale,
  frequency: FrequencyScale
): Partial<Data>[] {
  const band = { line: { color: 'transparent' }, fill: 'toself', type: 'scatter', showlegend: false, hoverinfo: 'none' } as const
  if (!bode || !phase) {
    return [
      band,
      { ...band, xaxis: 'x2', yaxis: 'y2' },
      { mode: 'lines', showlegend: false },
      { mode: 'lines', showlegend: false, xaxis: 'x2', yaxis: 'y2' }
    ]
  }
  const [phaseMean, phaseMax, phaseMin] = phase
  const freq = Array.from(frequency.transform(bode.freq))
  const areaFreq = [...freq, ...freq.slice().reverse()]
  const reversed = (a: Float64Array | undefined): number[] => (a ? Array.from(a).reverse() : [])
  return [
    { ...band, x: areaFreq, y: [...amplitude.scale(bode.ampMax), ...reversed(amplitude.scale(bode.ampMin))] },
    { ...band, xaxis: 'x2', yaxis: 'y2', x: areaFreq, y: [...(phaseMax ?? []), ...reversed(phaseMin)] },
    {
      mode: 'lines',
      showlegend: false,
      hovertemplate: `<extra></extra>${frequency.hover('x')}<br>${amplitude.hover('y')}`,
      x: freq,
      y: amplitude.scale(bode.ampMean)
    },
    {
      mode: 'lines',
      showlegend: false,
      xaxis: 'x2',
      yaxis: 'y2',
      hovertemplate: `<extra></extra>${frequency.hover('x')}<br>%{y:.2f} deg`,
      x: freq,
      y: phaseMean ?? []
    }
  ]
}

/** Bode layout: magnitude above phase; `wrap` fixes the phase axis to +-180 deg. */
export function bodeLayout(amplitude: AmplitudeScale, frequency: FrequencyScale, wrap: boolean): Partial<Layout> {
  return {
    xaxis: { type: frequency.type, ...AXIS_FRAME },
    xaxis2: { title: { text: frequency.label }, type: frequency.type, ...AXIS_FRAME },
    yaxis: { title: { text: amplitude.label }, ...AXIS_FRAME, domain: [0.52, 1] },
    yaxis2: {
      title: { text: 'Phase (deg)' },
      ...AXIS_FRAME,
      domain: [0.0, 0.48],
      ...(wrap ? { range: [-180, 180], autorange: false, fixedrange: true } : { autorange: true, fixedrange: false })
    },
    showlegend: true,
    legend: NO_LEGEND_CLICK,
    margin: MARGIN,
    grid: { rows: 2, columns: 1, pattern: 'independent' }
  }
}

// ---------- Spectrogram ----------

/** What the spectrogram shows. */
export interface SpectrogramSelection {
  readonly analysis: InstanceAnalysis
  readonly axis: GyroAxis
  /** Filter response per window to show the estimated post-filter spectrum. */
  readonly estimate: { readonly transfer: readonly ComplexArray[]; readonly quantizationNoise: number } | null
}

/** Notch tracking lines on the spectrogram for one harmonic notch. */
export interface NotchLineSet {
  readonly name: string
  readonly lines: readonly TrackingLine[]
  readonly logged: { readonly name: string; readonly lines: readonly TrackingLine[] } | null
  readonly shown: boolean
}

/**
 * Heatmap plus 2 x 16 simulated and 2 x 16 logged notch tracking lines, in upstream order so
 * the line colours match.
 */
export function spectrogramTraces(
  selection: SpectrogramSelection | null,
  notches: readonly NotchLineSet[],
  showLogged: boolean,
  s: ScaleSettings
): Partial<Data>[] {
  const heat = selection
    ? spectrogramData(selection.analysis.fft, {
        axis: selection.axis,
        scale: s.amplitude,
        alias: aliasHelper(selection.analysis.fft, s.alias, s.loopRate),
        ...(selection.estimate ? { estimate: selection.estimate } : {})
      })
    : null
  const freq = heat ? s.frequency.transform(heat.freq) : new Float64Array(0)
  const traces: Partial<Data>[] = [
    {
      type: 'heatmap',
      colorbar: { title: { side: 'right', text: s.amplitude.label }, orientation: 'h' },
      transpose: true,
      zsmooth: 'best',
      hovertemplate: `<extra></extra>%{x:.2f} s<br>${s.frequency.hover('y')}<br>${s.amplitude.hover('z')}`,
      x: heat?.time ?? [],
      y: freq,
      z: heat ? heat.z.map((row) => (row ? Array.from(row) : new Array<null>(freq.length).fill(null))) : []
    }
  ]

  const hover = `<extra></extra>%{meta}<br>%{x:.2f} s<br>${s.frequency.hover('y')}`
  const lineTrace = (group: string, legendGroup: number, line: TrackingLine | undefined, harmonic: number, visible: boolean) => {
    const name = harmonic === 1 ? 'Fundamental' : `Harmonic ${harmonic}`
    return {
      type: 'scatter' as const,
      mode: 'lines' as const,
      line: { width: 2, dash: legendGroup % 2 === 0 ? ('solid' as const) : ('dot' as const) },
      name,
      meta: `${group}<br>${name}`,
      legendgroup: String(legendGroup),
      legendgrouptitle: { text: group },
      hovertemplate: hover,
      x: line?.time ?? [],
      y: line ? s.frequency.transform(line.freq) : [],
      visible: line !== undefined && visible
    }
  }
  for (const logged of [false, true]) {
    for (let i = 0; i < 2; i++) {
      const notch = notches[i]
      const set = logged ? notch?.logged : notch
      for (let h = 1; h <= MAX_NUM_HARMONICS; h++) {
        const line = set?.lines.find((l) => l.harmonic === h)
        const shown = (notch?.shown ?? false) && (!logged || showLogged)
        traces.push(lineTrace(`Notch ${i + 1}: ${set?.name ?? ''}`, logged ? i + 2 : i, line, h, shown))
      }
    }
  }
  return traces
}

/** Spectrogram layout; the time axis follows the analysis window. */
export function spectrogramLayout(frequency: FrequencyScale, range: TimeRange | null): Partial<Layout> {
  return {
    xaxis: {
      title: { text: TIME_LABEL },
      ...AXIS_FRAME,
      ...(range ? { range: [range.start, range.end], autorange: false } : {})
    },
    yaxis: { title: { text: frequency.label }, type: frequency.type, ...AXIS_FRAME },
    showlegend: true,
    legend: NO_LEGEND_CLICK,
    margin: MARGIN
  }
}
