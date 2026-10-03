/**
 * Plotly traces and layouts for the Bode plots: magnitude on top, phase below, sharing a
 * frequency axis (upstream `load()` plot setup and the trace updates in `calculate_*`).
 */
import { arrayScale } from '@apwt/signal'
import { defaultColor, type Data, type Layout } from '@apwt/plot'
import type { Bode } from '../analysis/bode.js'
import type { BodeSettings } from '../analysis/settings.js'

/** One response to plot. */
export interface BodeSeries {
  readonly name: string
  readonly bode: Bode | null
  readonly visible: boolean
}

const AXIS_FRAME = { zeroline: false, showline: true, mirror: true } as const

/** Two traces (magnitude, phase) per series, coloured by position as upstream. */
export function bodeTraces(
  freqHz: Float64Array,
  series: readonly BodeSeries[],
  s: BodeSettings,
  legend: boolean
): Partial<Data>[] {
  const rpm = s.frequencyUnit === 'RPM'
  const x = rpm ? arrayScale(freqHz, 60.0) : freqHz
  const meta = legend ? '%{meta}<br>' : ''
  const freqHover = `%{x:.2f} ${rpm ? 'RPM' : 'Hz'}`
  const ampTemplate = `<extra></extra>${meta}${freqHover}<br>%{y:.2f} ${s.magnitude === 'dB' ? 'dB' : ''}`
  const phaseTemplate = `<extra></extra>${meta}${freqHover}<br>%{y:.2f} deg`

  return series.flatMap((item, i): Partial<Data>[] => {
    const common = {
      mode: 'lines' as const,
      line: { color: defaultColor(i) },
      name: item.name,
      meta: item.name,
      visible: item.visible && item.bode !== null,
      x: item.bode ? x : []
    }
    return [
      { ...common, hovertemplate: ampTemplate, y: item.bode?.magnitude ?? [] },
      { ...common, showlegend: false, xaxis: 'x2', yaxis: 'y2', hovertemplate: phaseTemplate, y: item.bode?.phase ?? [] }
    ]
  })
}

export function bodeLayout(s: BodeSettings, magnitudeName: 'Magnitude' | 'Gain', legend: boolean): Partial<Layout> {
  const type = s.frequencyAxis === 'log' ? 'log' : 'linear'
  const wrapped = s.phase === 'wrapped'
  return {
    // Keep the user's zoom while parameters change; reset it when an axis changes meaning.
    uirevision: `${s.frequencyAxis}-${s.frequencyUnit}-${s.magnitude}-${s.phase}`,
    xaxis: { type, ...AXIS_FRAME },
    xaxis2: {
      title: { text: s.frequencyUnit === 'RPM' ? 'Frequency (RPM)' : 'Frequency (Hz)' },
      type,
      matches: 'x',
      ...AXIS_FRAME
    },
    yaxis: { title: { text: s.magnitude === 'dB' ? `${magnitudeName} (dB)` : magnitudeName }, domain: [0.52, 1], ...AXIS_FRAME },
    yaxis2: {
      title: { text: 'Phase (deg)' },
      domain: [0.0, 0.48],
      ...AXIS_FRAME,
      ...(wrapped ? { range: [-180, 180], autorange: false, fixedrange: true } : { autorange: true, fixedrange: false })
    },
    showlegend: legend,
    legend: { itemclick: false, itemdoubleclick: false },
    margin: { b: 50, l: 60, r: 30, t: 20 },
    grid: { rows: 2, columns: 1, pattern: 'independent' }
  }
}
