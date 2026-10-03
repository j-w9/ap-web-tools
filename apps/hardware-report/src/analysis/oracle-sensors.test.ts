// Oracle: upstream HardwareReport.js `load_params()` sensor sections (`load_ins`, `load_compass`,
// `load_baro`, `load_airspeed`, `load_gps`, `load_rangefinder/flow/viso`, `update_pos_plot`) run in a
// vm (test-utils/upstream.ts) against the port's report. For each case the text upstream renders in
// each section is rebuilt from the port's data in upstream's wording, and the sensor position plot
// traces are compared point by point.
import { DataflashLog } from '@apwt/dataflash'
import { describe, expect, it } from 'vitest'
import { readFixture } from '../test-utils/fixtures.js'
import { baseLog } from '../test-utils/synthetic.js'
import { createUpstreamHardwareReport, type UpstreamHardwareReport } from '../test-utils/upstream.js'
import { deviceLines } from './device.js'
import { buildLogReport, buildParamFileReport, type HardwareReport } from './report.js'

const mark = (v: unknown): string => (v ? '✅' : '❌')

function insText(r: HardwareReport): string {
  let out = ''
  for (const s of r.sensors.ins) {
    if (s === undefined) continue
    out += `IMU ${s.number}`
    out += s.combined
      ? deviceLines(s.gyro).join('')
      : 'Gyro: ' + deviceLines(s.gyro).join('') + 'Accel: ' + deviceLines(s.accel).join('')
    out += 'Use: ' + mark(s.use)
    out += 'Accel calibration: ' + mark(s.accelCalibrated)
    out += 'Gyro calibration: ' + mark(s.gyroCalibrated)
    out += 'Accel temperature calibration: ' + mark(s.accelTempCalibrated)
    out += 'Gyro temperature calibration: ' + mark(s.gyroTempCalibrated)
    out += 'Position offset: ' + mark(s.posSet)
    if (s.accelHealthy !== undefined) out += 'Accel health: ' + mark(s.accelHealthy)
    if (s.gyroHealthy !== undefined) out += 'Gyro health: ' + mark(s.gyroHealthy)
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

function compareSections(up: UpstreamHardwareReport, r: HardwareReport): void {
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

async function compareParamFile(text: string): Promise<HardwareReport> {
  const up = await createUpstreamHardwareReport()
  up.loadParamFile(text)
  const r = buildParamFileReport(text)
  compareSections(up, r)
  return r
}

async function compareLog(bytes: Uint8Array): Promise<HardwareReport> {
  const up = await createUpstreamHardwareReport()
  await up.loadLog(bytes)
  const r = buildLogReport(DataflashLog.parse(bytes))
  compareSections(up, r)
  return r
}

const lines = (o: Readonly<Record<string, number>>): string =>
  Object.entries(o)
    .map(([k, v]) => `${k},${v}`)
    .join('\n')

const IMU_BASE = {
  INS_GYR_ID: 3408138,
  INS_ACC_ID: 3408138,
  INS_USE: 1,
  INS_GYROFFS_X: 0,
  INS_GYROFFS_Y: 0,
  INS_GYROFFS_Z: 0,
  INS_ACCOFFS_X: 0,
  INS_ACCOFFS_Y: 0,
  INS_ACCOFFS_Z: 0,
  INS_ACCSCAL_X: 1,
  INS_ACCSCAL_Y: 1,
  INS_ACCSCAL_Z: 1,
  INS_TCAL1_ENABLE: 1,
  INS_TCAL1_GYR1_X: 0.3,
  ...Object.fromEntries(['ACC1', 'ACC2', 'ACC3'].flatMap((a) => ['X', 'Y', 'Z'].map((c) => [`INS_TCAL1_${a}_${c}`, 0]))),
  INS_GYR2_ID: 2753036,
  INS_ACC2_ID: 2753028,
  INS_USE2: 0,
  INS_ACC2OFFS_X: 0.1,
  INS_TCAL2_ENABLE: 1,
  INS_TCAL2_ACC3_Z: 0.2,
  INS_TCAL2_TMAX: 40,
  INS4_GYR_ID: 0,
  INS4_ACC_ID: 1234567,
  INS_POS1_X: 0.1,
  INS_POS1_Y: -0.05,
  INS_POS1_Z: 0
}

describe('oracle: sensor sections from parameter files', () => {
  it('reproduces the IMU calibration and temperature-calibration name bugs', async () => {
    const r = await compareParamFile(lines(IMU_BASE))
    // Zero offsets and unit scales still read as calibrated: the "scale" check compares the
    // offsets (read twice) with 1.0.
    expect(r.sensors.ins[0]?.accelCalibrated).toBe(true)
    // A GYR coefficient does not count; upstream reads the ACC names for the gyro.
    expect(r.sensors.ins[0]?.gyroTempCalibrated).toBe(false)
    expect(r.sensors.ins[1]?.gyroTempCalibrated).toBe(true)
  })

  it('matches compasses in priority and device-id slots', async () => {
    await compareParamFile(
      lines({
        COMPASS_ENABLE: 1,
        COMPASS_DEV_ID: 97539,
        COMPASS_DEV_ID2: 131874,
        COMPASS_DEV_ID3: 263178,
        COMPASS_DEV_ID4: 590114,
        COMPASS_DEV_ID5: 0,
        COMPASS_PRIO1_ID: 131874,
        COMPASS_PRIO2_ID: 555,
        COMPASS_USE2: 1,
        COMPASS_EXTERN2: 1,
        COMPASS_OFS2_X: 5,
        COMPASS_DIA2_X: 1,
        COMPASS_DIA2_Y: 1,
        COMPASS_DIA2_Z: 1,
        COMPASS_ODI2_X: 0,
        COMPASS_ODI2_Y: 0,
        COMPASS_ODI2_Z: 0,
        COMPASS_MOT2_X: 0,
        COMPASS_MOT2_Y: 0,
        COMPASS_MOT2_Z: 0
      })
    )
    await compareParamFile(lines({ COMPASS_DEV_ID: 97539, COMPASS_DEV_ID3: 263178 }))
  })

  it('matches barometers, airspeed (with and without primaries) and GPS', async () => {
    await compareParamFile(
      lines({
        BARO1_DEVID: 65540,
        BARO2_DEVID: 0,
        BARO3_DEVID: 721170,
        BARO1_WCF_ENABLE: 1,
        BARO1_WCF_FWD: 0,
        BARO3_WCF_ENABLE: 1,
        BARO3_WCF_FWD: 0,
        BARO3_WCF_BCK: 0,
        BARO3_WCF_RGT: 0,
        BARO3_WCF_LFT: 0,
        BARO3_WCF_UP: 0,
        BARO3_WCF_DN: 0,
        BARO_PRIMARY: 2,
        ARSPD_DEVID: 1,
        ARSPD2_DEVID: 2,
        ARSPD_USE: 1,
        GPS_TYPE: 9,
        GPS_TYPE2: 2,
        GPS_POS1_X: 0.2,
        GPS_POS1_Y: 0,
        GPS_POS1_Z: -0.1,
        GPS_POS2_X: -0.2,
        GPS_POS2_Y: 0.1,
        GPS_POS2_Z: 0,
        GPS_MB1_TYPE: 1,
        GPS_MB1_OFS_X: 0.5,
        GPS_MB1_OFS_Y: 0,
        GPS_MB1_OFS_Z: 0
      })
    )
    await compareParamFile(lines({ GPS1_TYPE: 1, GPS1_POS_X: 0.3, GPS1_POS_Y: 0, GPS1_POS_Z: 0, GPS2_TYPE: 0 }))
  })

  it('matches rangefinder, flow and VISO positions in the offset plot', async () => {
    await compareParamFile(
      lines({
        RNGFND1_TYPE: 10,
        RNGFND1_POS_X: 0.1,
        RNGFND1_POS_Y: 0,
        RNGFND1_POS_Z: 0.05,
        RNGFNDA_TYPE: 1,
        RNGFNDA_POS_X: -0.4,
        RNGFNDA_POS_Y: 0,
        RNGFNDA_POS_Z: 0,
        FLOW_TYPE: 6,
        FLOW_POS_X: 0,
        FLOW_POS_Y: 0.2,
        FLOW_POS_Z: 0,
        VISO_TYPE: 1,
        VISO_POS_X: 0,
        VISO_POS_Y: 0,
        VISO_POS_Z: 0.3,
        RNGFND2_TYPE: 1,
        RNGFND2_POS_X: 1
      })
    )
  })

  it('hides the offset plot when an offset is not a number, as upstream', async () => {
    const r = await compareParamFile('INS_GYR_ID,1\nINS_ACC_ID,1\nINS_POS1_X,abc\nINS_POS1_Y,0.5\nINS_POS1_Z,0\n')
    expect(Number.isNaN(r.positionOffsets.maxOffset)).toBe(true)
  })

  it('reads junk lines of a parameter file as upstream does', async () => {
    await compareParamFile('# Comment,1\n  INS_GYR_ID 2\nINS_ACC_ID=3\r\nBARO1_DEVID,\nBARO2_DEVID\t65540\n')
  })
})

describe('oracle: sensor sections from logs', () => {
  it.each(['copter-sitl.bin', 'copter-files.bin'])('matches %s', async (name) => {
    await compareLog(readFixture(name))
  })

  it('shows IMU health swapped, and compass, baro and airspeed health', async () => {
    const bytes = baseLog()
      .define('IMU', 'QBBB', 'TimeUS,I,AH,GH', 'I')
      .define('MAG', 'QBB', 'TimeUS,I,Health', 'I')
      .define('BARO', 'QBB', 'TimeUS,I,H', 'I')
      .define('ARSP', 'QBB', 'TimeUS,I,H', 'I')
      .params({
        INS_GYR_ID: 3408138,
        INS_ACC_ID: 3408138,
        INS_GYR2_ID: 3408162,
        INS_ACC2_ID: 3408162,
        COMPASS_DEV_ID: 97539,
        COMPASS_DEV_ID2: 131874,
        COMPASS_PRIO1_ID: 97539,
        BARO1_DEVID: 65540,
        ARSPD_DEVID: 1,
        GPS_TYPE: 1,
        GPS_TYPE2: 5
      })
      .write('IMU', [1, 0, 1, 0])
      .write('IMU', [1, 1, 0, 1])
      .write('IMU', [2, 0, 1, 1])
      .write('MAG', [1, 0, 1])
      .write('MAG', [1, 1, 0])
      .write('BARO', [1, 0, 0])
      .write('ARSP', [1, 0, 1])
      .write('MSG', [5, 'GPS 1: detected as u-blox at 230400 baud'])
      .write('MSG', [6, 'GPS 2: specified as NMEA'])
      .write('MSG', [7, 'GPS 1: detected as u-blox-F9 at 460800 baud'])
      .bytes()
    const r = await compareLog(bytes)
    // IMU 1: AH all 1, GH not: upstream's "Accel health" line shows the gyro flag.
    expect([r.sensors.ins[0]?.accelHealthy, r.sensors.ins[0]?.gyroHealthy]).toEqual([false, true])
    expect(r.sensors.gps.map((g) => g?.device)).toEqual(['u-blox-F9', 'NMEA'])
  })

  it('fails like upstream when a boot message names an unconfigured GPS', async () => {
    const bytes = baseLog().params({ GPS_TYPE: 1 }).write('MSG', [5, 'GPS 2: detected as u-blox at 230400 baud']).bytes()
    const up = await createUpstreamHardwareReport()
    await expect(up.loadLog(bytes)).rejects.toThrow(/Cannot set properties of undefined/)
    expect(() => buildLogReport(DataflashLog.parse(bytes))).toThrow(/names GPS 2, which is not configured/)
  })
})
