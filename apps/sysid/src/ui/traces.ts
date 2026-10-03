/** Plotly traces and layouts, as upstream `setup_flight_data_plot`, `run_transfer_function_ID` and `run_SS_ID` draw them. */
import { defaultColor, type Data, type Layout } from '@apwt/plot'
import type { FlightData } from '../analysis/log.js'
import type { StateSpaceOutputs, TransferFunctionOutputs } from '../python/runtime.js'

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

export function flightDataLayout(): Partial<Layout> {
  const positions = [0, 0.06, 0.94, 1]
  const layout: Partial<Layout> & Record<string, unknown> = {
    xaxis: { title: { text: 'Time (s)' }, domain: [0.07, 0.93], type: 'linear', ...AXIS_FRAME, rangeslider: {} },
    showlegend: false,
    margin: { b: 50, l: 50, r: 50, t: 20 }
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

// ---------- Frequency response results ----------

type Row = 1 | 2 | 3

function line(x: Float64Array, y: Float64Array, name: string, row: Row): Partial<Data> {
  return { x, y, type: 'scatter', mode: 'lines', name, xaxis: `x${row}`, yaxis: `y${row}` }
}

function resultLayout(title: string, yTitles: readonly [string, string, string]): Partial<Layout> {
  const freqAxis = { type: 'log', title: { text: 'Frequency (rad/sec)' } } as const
  return {
    title: { text: title },
    grid: { rows: 3, columns: 1, pattern: 'independent' },
    xaxis: freqAxis,
    yaxis: { title: { text: yTitles[0] } },
    xaxis2: freqAxis,
    yaxis2: { title: { text: yTitles[1] } },
    xaxis3: freqAxis,
    yaxis3: { title: { text: yTitles[2] } },
    // Above the plots rather than over the amplitude curves (upstream: inside, top right).
    legend: { orientation: 'h', x: 0, xanchor: 'left', y: 1, yanchor: 'bottom' },
    margin: { t: 110, l: 60, r: 20, b: 50 }
  }
}

export function transferFunctionTraces(r: TransferFunctionOutputs): Partial<Data>[] {
  return [
    line(r.freq, r.hAmp, 'source H Amp', 1),
    line(r.freq, r.mag, 'fit H Amp', 1),
    line(r.freq, r.hPhase, 'source H Phase', 2),
    line(r.freq, r.phase, 'fit H Phase', 2),
    line(r.freq, r.coherence, 'Coherence of xy', 3)
  ]
}

export const TRANSFER_FUNCTION_LAYOUT = resultLayout('Frequency Response Data', ['H Amp', 'H Phase', 'Coherence'])

export function stateSpaceTraces(r: StateSpaceOutputs): Partial<Data>[] {
  const empty = new Float64Array(0)
  return r.hsAmp.flatMap((hsAmp, i) => [
    line(r.freq, hsAmp, `Hs Amp ${i}`, 1),
    line(r.freq, r.hestAmp[i] ?? empty, `Hest Amp ${i}`, 1),
    line(r.freq, r.hsPha[i] ?? empty, `Hs Pha ${i}`, 2),
    line(r.freq, r.hestPha[i] ?? empty, `Hest Pha ${i}`, 2),
    line(r.freq, r.coherence[i] ?? empty, `Coherence ${i}`, 3)
  ])
}

export const STATE_SPACE_LAYOUT = resultLayout('State Space Frequency Response Data', ['Amplitude', 'Phase', 'Coherence'])
