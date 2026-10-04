// Test-only: the text upstream `load_params()` renders in each sensor section (`load_ins`,
// `load_compass`, `load_baro`, `load_airspeed`, `load_gps`) rebuilt from the port's report in
// upstream's wording, and the sensor position plot traces. Shared by the oracle tests and the
// real-log test.
import { expect } from 'vitest'
import { deviceLines } from '../analysis/device.js'
import { insParamNames } from '../analysis/ins.js'
import { paramArray, paramArrayConfigured } from '../analysis/param-arrays.js'
import type { HardwareReport } from '../analysis/report.js'
import type { UpstreamHardwareReport } from './upstream.js'

const mark = (v: unknown): string => (v ? '✅' : '❌')

/**
 * Upstream's "Accel calibration" for IMU `index` (proven bug, fixed in the port): the scale check
 * reads the accel *offset* names again and compares them with 1.0.
 */
function upstreamAccelCalibrated(r: HardwareReport, index: number): boolean {
  const offsets = paramArray(r.params.values, insParamNames(index).accel.offset)
  return paramArrayConfigured(offsets, 0) || paramArrayConfigured(offsets, 1)
}

/**
 * The IMU section text upstream renders, rebuilt from the port's report. Three proven upstream
 * bugs are fixed in the port (docs/bug-proofs/hardware-report.md), so upstream's values are derived
 * here: "Accel calibration" from the offsets compared with 1.0, "Gyro temperature calibration" from
 * the accel coefficients (upstream reads the ACC names for the gyro, so it equals the port's accel
 * temperature calibration), and the two health lines swapped. Everything else is the port's value.
 */
function insText(r: HardwareReport): string {
  let out = ''
  for (const [index, s] of r.sensors.ins.entries()) {
    if (s === undefined) continue
    out += `IMU ${s.number}`
    out += s.combined
      ? deviceLines(s.gyro).join('')
      : 'Gyro: ' + deviceLines(s.gyro).join('') + 'Accel: ' + deviceLines(s.accel).join('')
    out += 'Use: ' + mark(s.use)
    out += 'Accel calibration: ' + mark(upstreamAccelCalibrated(r, index))
    out += 'Gyro calibration: ' + mark(s.gyroCalibrated)
    out += 'Accel temperature calibration: ' + mark(s.accelTempCalibrated)
    out += 'Gyro temperature calibration: ' + mark(s.accelTempCalibrated)
    out += 'Position offset: ' + mark(s.posSet)
    if (s.gyroHealthy !== undefined) out += 'Accel health: ' + mark(s.gyroHealthy)
    if (s.accelHealthy !== undefined) out += 'Gyro health: ' + mark(s.accelHealthy)
  }
  return out
}

function compassText(r: HardwareReport): string {
  let out = 'Enabled: ' + mark(r.sensors.compass.enabled)
  for (const s of r.sensors.compass.sensors) {
    if (s === undefined) continue
    out += `Compass ${s.number}` + deviceLines(s.device).join('')
    const c = s.calibration
    if (c === undefined) continue
    out += 'Use: ' + mark(c.use) + 'External: ' + mark(c.external) + 'Calibrated: ' + mark(c.offsetsSet)
    out += 'Iron calibration: ' + mark(c.matrixSet) + 'Motor calibration: ' + mark(c.motorSet)
    if (s.healthy !== undefined) out += 'Health: ' + mark(s.healthy)
  }
  return out
}

function baroText(r: HardwareReport): string {
  let out = 'Primary: ' + String(r.sensors.baro.primary ?? NaN)
  for (const s of r.sensors.baro.sensors) {
    if (s === undefined) continue
    out += `Barometer ${s.number}` + deviceLines(s.device).join('') + 'Wind compensation: ' + mark(s.windCompensation)
    if (s.healthy !== undefined) out += 'Health: ' + mark(s.healthy)
  }
  return out
}

function airspeedText(r: HardwareReport): string {
  let out = 'Primary: ' + String(r.sensors.airspeed.primary ?? NaN)
  for (const s of r.sensors.airspeed.sensors) {
    if (s === undefined) continue
    out += `Airspeed ${s.number}` + deviceLines(s.device).join('') + 'Use: ' + mark(s.use)
    if (s.healthy !== undefined) out += 'Health: ' + mark(s.healthy)
  }
  return out
}

function gpsText(r: HardwareReport): string {
  let out = ''
  for (const g of r.sensors.gps) {
    if (g?.device === undefined) continue
    out += `GPS ${g.number}`
    if (g.typeName !== undefined) out += `Type ${g.type}: ${g.typeName}`
    out += g.device
    if (g.canName !== undefined) out += 'Name: ' + g.canName
  }
  return out
}

interface OffsetTrace {
  name: string
  visible?: boolean
  x?: number[]
  y?: number[]
  z?: number[]
  type: string
  mode?: string
}

export function compareSensorSections(up: UpstreamHardwareReport, r: HardwareReport): void {
  const section = (id: string) => up.dom.getElementById(id)
  expect(section('INS').textContent, 'INS').toBe(insText(r))
  expect(section('INS').hidden, 'INS hidden').toBe(r.sensors.ins.every((s) => s === undefined))
  expect(section('COMPASS').textContent, 'COMPASS').toBe(compassText(r))
  expect(section('COMPASS').hidden, 'COMPASS hidden').toBe(r.sensors.compass.sensors.every((s) => s === undefined))
  expect(section('BARO').textContent, 'BARO').toBe(baroText(r))
  expect(section('BARO').hidden, 'BARO hidden').toBe(r.sensors.baro.sensors.every((s) => s === undefined))
  expect(section('ARSPD').textContent, 'ARSPD').toBe(airspeedText(r))
  expect(section('ARSPD').hidden, 'ARSPD hidden').toBe(r.sensors.airspeed.sensors.every((s) => s === undefined))
  expect(section('GPS').textContent, 'GPS').toBe(gpsText(r))
  expect(section('GPS').hidden, 'GPS hidden').toBe(r.sensors.gps.every((g) => g?.device === undefined))

  // Position plot: the visible markers, in trace order, against the port's points.
  const traces = up.get('Sensor_Offset.data') as OffsetTrace[]
  const visible = traces
    .filter((t) => t.type === 'scatter3d' && t.mode === 'markers' && t.visible === true)
    .map((t) => ({ name: t.name, pos: [t.x?.[0], t.y?.[0], t.z?.[0]] }))
  expect(visible).toEqual(r.positionOffsets.points.map((p) => ({ name: p.name, pos: [...p.pos] })))
  const max = r.positionOffsets.maxOffset
  expect(up.dom.getElementById('POS_OFFSETS').parentElement?.hidden, 'offset plot hidden').toBe(!(max > 0))
  if (max > 0) {
    const scene = (up.get('Sensor_Offset.layout') as { scene: { xaxis: { range: number[] } } }).scene
    expect(scene.xaxis.range).toEqual([-max, max])
  }
}
