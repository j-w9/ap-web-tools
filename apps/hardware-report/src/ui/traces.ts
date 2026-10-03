/**
 * Builders turning analysis results into Plotly traces and layouts (upstream `reset()` plot
 * setup plus the `load_log()` plot fills). Pure functions, so the components stay declarative.
 */
import type { Data, Layout } from '@apwt/plot'
import type { PowerFlagsData, TemperatureData, VoltageData } from '../analysis/board-health.js'
import type { ClockDrift } from '../analysis/clock-drift.js'
import type { CanRate, UartRate } from '../analysis/data-rates.js'
import type { LogStats, LoggingData } from '../analysis/log-stats.js'
import type { PerformanceData, ThreadStack } from '../analysis/performance.js'
import type { PositionOffsets } from '../analysis/position-offsets.js'
import type { Series } from '../analysis/series.js'

const TIME_LABEL = 'Time (s)'
const MARGIN = { b: 50, l: 60, r: 50, t: 20 }
const NO_LEGEND_CLICK = { itemclick: false, itemdoubleclick: false } as const

/** Layout of a time plot with the given y-axis title. */
export function timeLayout(yTitle: string, extra: Partial<Layout> = {}): Partial<Layout> {
  return {
    legend: NO_LEGEND_CLICK,
    margin: MARGIN,
    xaxis: { title: { text: TIME_LABEL } },
    yaxis: { title: { text: yTitle } },
    ...extra
  }
}

function hover(name: string, unit: string): string {
  return `<extra></extra>${name}<br>%{x:.2f} s<br>%{y:.2f}${unit === '' ? '' : ` ${unit}`}`
}

/** A line trace from a series. */
export function lineTrace(s: Series, unit: string, name = s.name): Partial<Data> {
  return { mode: 'lines', type: 'scatter', name, x: s.time, y: s.values, hovertemplate: hover(name, unit) }
}

function limitTrace(name: string, time: Float64Array, value: number, unit: string): Partial<Data> {
  const x = time.length > 0 ? [time[0] ?? 0, time[time.length - 1] ?? 0] : []
  return {
    mode: 'lines',
    type: 'scatter',
    name,
    x,
    y: x.map(() => value),
    hovertemplate: hover(name, unit),
    line: { dash: 'dot', color: '#888888' }
  }
}

// ---------- Position offsets ----------

/** 3D scatter of sensor positions with body axes arrows. */
export function offsetTraces(offsets: PositionOffsets): Partial<Data>[] {
  const traces: Partial<Data>[] = [
    {
      type: 'scatter3d',
      mode: 'markers',
      name: 'CG',
      x: [0],
      y: [0],
      z: [0],
      marker: { color: 'rgb(128,128,128)' },
      showlegend: false,
      hovertemplate: '<extra></extra>CG'
    },
    ...offsets.points.map((p): Partial<Data> => ({
      type: 'scatter3d',
      mode: 'markers',
      name: p.name,
      x: [p.pos[0]],
      y: [p.pos[1]],
      z: [p.pos[2]],
      hovertemplate: `<extra></extra>${p.name}<br>X: %{x:.2f} m<br>Y: %{y:.2f} m<br>Z: %{z:.2f} m`
    }))
  ]
  const size = 0.2
  const axes = [
    { color: 'rgb(0,0,255)', dir: [1, 0, 0] },
    { color: 'rgb(255,0,0)', dir: [0, 1, 0] },
    { color: 'rgb(0,255,0)', dir: [0, 0, 1] }
  ] as const
  for (const a of axes) {
    const [dx, dy, dz] = [a.dir[0] * size, a.dir[1] * size, a.dir[2] * size]
    // @types/plotly.js does not declare the cone attributes (u, v, w, sizemode, ...); they are
    // spread in from a widened object so the literal stays checked for the attributes it knows.
    const coneAttributes: Record<string, unknown> = {
      u: [dx],
      v: [dy],
      w: [dz],
      sizemode: 'raw',
      sizeref: size * 2,
      showscale: false,
      colorscale: [
        [0, a.color],
        [1, a.color]
      ]
    }
    const cone: Partial<Data> = { type: 'cone', x: [dx], y: [dy], z: [dz], hoverinfo: 'none', ...coneAttributes }
    traces.push(cone, {
      type: 'scatter3d',
      mode: 'lines',
      x: [0, dx],
      y: [0, dy],
      z: [0, dz],
      showlegend: false,
      hoverinfo: 'none',
      line: { color: a.color, width: 10 }
    })
  }
  return traces
}

/** Layout for the offset plot: equal ranges, Y and Z flipped so the view matches the vehicle frame. */
export function offsetLayout(maxOffset: number): Partial<Layout> {
  const axis = { zeroline: false, showline: true, mirror: true, showspikes: false } as const
  return {
    scene: {
      xaxis: { ...axis, title: { text: 'X offset, forward (m)' }, range: [-maxOffset, maxOffset] },
      yaxis: { ...axis, title: { text: 'Y offset, right (m)' }, range: [maxOffset, -maxOffset] },
      zaxis: { ...axis, title: { text: 'Z offset, down (m)' }, range: [maxOffset, -maxOffset] },
      aspectratio: { x: 0.75, y: 0.75, z: 0.75 },
      camera: { eye: { x: -1.25, y: 1.25, z: 1.25 } }
    },
    showlegend: true,
    legend: NO_LEGEND_CLICK,
    margin: { b: 20, l: 20, r: 20, t: 20 }
  }
}

// ---------- Board health ----------

/** Heater, MCU and IMU temperatures. */
export function temperatureTraces(t: TemperatureData): Partial<Data>[] {
  const out: Partial<Data>[] = []
  for (const s of [t.heaterTarget, t.heaterActual, t.mcu, ...t.imu]) if (s) out.push(lineTrace(s, '°C'))
  return out
}

/** Servo, board and MCU voltage with the MCU min/max band. */
export function voltageTraces(v: VoltageData): Partial<Data>[] {
  const out: Partial<Data>[] = []
  if (v.mcu) {
    const t = Array.from(v.mcu.voltage.time)
    out.push({
      type: 'scatter',
      x: [...t, ...[...t].reverse()],
      y: [...Array.from(v.mcu.max), ...Array.from(v.mcu.min).reverse()],
      fill: 'toself',
      line: { color: 'transparent' },
      showlegend: false,
      hoverinfo: 'none'
    })
  }
  if (v.servo) out.push(lineTrace(v.servo, 'V'))
  if (v.board) out.push(lineTrace(v.board, 'V'))
  if (v.mcu) out.push(lineTrace(v.mcu.voltage, 'V'))
  return out
}

/** Power status flags as 0/1 lines. */
export function powerFlagTraces(f: PowerFlagsData): Partial<Data>[] {
  const flags = [
    ['Primary power supply', f.brickValid],
    ['Secondary power supply', f.servoValid],
    ['USB power', f.usbConnected],
    ['Peripheral overcurrent', f.periphOvercurrent],
    ['High-power peripheral overcurrent', f.periphHipowerOvercurrent]
  ] as const
  return flags.map(([name, values]) => lineTrace({ name, time: f.time, values }, ''))
}

// ---------- Performance ----------

/** CPU load, free memory and loop-rate traces. */
export function performanceTraces(p: PerformanceData): {
  load: Partial<Data>[]
  memory: Partial<Data>[]
  loopRate: Partial<Data>[]
} {
  return {
    load: [lineTrace(p.load, '%')],
    memory: [lineTrace(p.freeMemory, 'B')],
    loopRate: [lineTrace(p.worstLoopRate, 'Hz'), ...(p.averageLoopRate ? [lineTrace(p.averageLoopRate, 'Hz')] : [])]
  }
}

/** Free stack and stack usage traces per thread. */
export function stackTraces(stacks: readonly ThreadStack[]): { free: Partial<Data>[]; used: Partial<Data>[] } {
  return {
    free: stacks.map((s) => lineTrace({ name: s.name, time: s.time, values: s.free }, 'B')),
    used: stacks.map((s) => lineTrace({ name: s.name, time: s.time, values: s.usedPercent }, '%'))
  }
}

// ---------- Data rates ----------

/** Receive/transmit byte rates with the baud limit. */
export function uartTraces(u: UartRate): Partial<Data>[] {
  const out = [
    lineTrace({ name: 'Receive', time: u.time, values: u.rx }, 'B/s'),
    lineTrace({ name: 'Transmit', time: u.time, values: u.tx }, 'B/s')
  ]
  if (u.limit !== undefined) out.push(limitTrace('Baud limit', u.time, u.limit, 'B/s'))
  return out
}

/** CAN frame rates with the worst-case limit. */
export function canTraces(c: CanRate): Partial<Data>[] {
  const out = [
    lineTrace({ name: 'Receive', time: c.time, values: c.rx }, 'f/s'),
    lineTrace({ name: 'Transmit', time: c.time, values: c.tx }, 'f/s'),
    lineTrace({ name: 'Total', time: c.time, values: c.total }, 'f/s')
  ]
  if (c.worstCaseLimit !== undefined) out.push(limitTrace('Worst case limit', c.time, c.worstCaseLimit, 'f/s'))
  return out
}

// ---------- Logging ----------

/** Dropped messages and free buffer traces. */
export function loggingTraces(l: LoggingData): { dropped: Partial<Data>[]; buffer: Partial<Data>[] } {
  return {
    dropped: l.dropped ? [lineTrace(l.dropped, '')] : [],
    buffer: [l.bufferMax, l.bufferAverage, l.bufferMin].filter((s): s is Series => s !== undefined).map((s) => lineTrace(s, 'B'))
  }
}

/** Pie of bytes per message type. */
export function logCompositionTrace(stats: LogStats): Partial<Data>[] {
  return [
    {
      type: 'pie',
      labels: stats.messages.map((m) => m.name),
      values: stats.messages.map((m) => m.bytes),
      textposition: 'inside',
      textinfo: 'label+percent',
      hovertemplate: '%{label}<br>%{value:,i} Bytes<br>%{percent}<extra></extra>'
    }
  ]
}

/** Pie layout without legend. */
export const PIE_LAYOUT: Partial<Layout> = { showlegend: false, margin: { b: 10, l: 50, r: 50, t: 10 } }

// ---------- Clock drift ----------

/** Drift traces and the layout with upstream's 1000 ppm range. */
export function clockDriftPlot(d: ClockDrift): { data: Partial<Data>[]; layout: Partial<Layout> } {
  return {
    data: d.series.map((s) => lineTrace(s, 'ms')),
    layout: timeLayout(
      'Clock drift (ms)',
      d.yRange === undefined
        ? {}
        : { yaxis: { title: { text: 'Clock drift (ms)' }, range: [-d.yRange, d.yRange], autorange: false } }
    )
  }
}
