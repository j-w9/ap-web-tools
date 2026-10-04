// Oracle: upstream HardwareReport.js `load_params()` sensor sections (`load_ins`, `load_compass`,
// `load_baro`, `load_airspeed`, `load_gps`, `load_rangefinder/flow/viso`, `update_pos_plot`) run in a
// vm (test-utils/upstream.ts) against the port's report. For each case the text upstream renders in
// each section is rebuilt from the port's data in upstream's wording, and the sensor position plot
// traces are compared point by point.
import { DataflashLog } from '@apwt/dataflash'
import { describe, expect, it } from 'vitest'
import { readFixture } from '../test-utils/fixtures.js'
import { baseLog } from '../test-utils/synthetic.js'
import { compareSensorSections } from '../test-utils/compare-sensors.js'
import { createUpstreamHardwareReport, type UpstreamHardwareReport } from '../test-utils/upstream.js'
import { buildLogReport, buildParamFileReport, type HardwareReport } from './report.js'

async function compareParamFile(text: string): Promise<HardwareReport> {
  const up = await createUpstreamHardwareReport()
  up.loadParamFile(text)
  const r = buildParamFileReport(text)
  compareSensorSections(up, r)
  return r
}

async function uploaded(bytes: Uint8Array): Promise<UpstreamHardwareReport> {
  const up = await createUpstreamHardwareReport()
  await up.loadLog(bytes)
  return up
}

async function compareLog(bytes: Uint8Array): Promise<HardwareReport> {
  const up = await createUpstreamHardwareReport()
  await up.loadLog(bytes)
  const r = buildLogReport(DataflashLog.parse(bytes))
  compareSensorSections(up, r)
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
  it('fixes the proven IMU calibration and temperature-calibration name bugs', async () => {
    const up = await createUpstreamHardwareReport()
    up.loadParamFile(lines(IMU_BASE))
    const r = await compareParamFile(lines(IMU_BASE))
    const imu1 = up.dom.getElementById('INS').textContent.split('IMU 2')[0] ?? ''
    // Upstream: zero offsets and unit scales read as calibrated (offsets compared with 1.0); the
    // GYR coefficient of IMU 1 does not count and IMU 2's ACC coefficient counts for the gyro.
    expect(imu1).toContain('Accel calibration: ✅')
    expect(imu1).toContain('Gyro temperature calibration: ❌')
    expect(up.dom.getElementById('INS').textContent.split('IMU 2')[1]).toContain('Gyro temperature calibration: ✅')
    // Port: ArduPilot's SCAL and GYR names.
    expect(r.sensors.ins[0]?.accelCalibrated).toBe(false)
    expect(r.sensors.ins[0]?.gyroTempCalibrated).toBe(true)
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

  it('shows IMU health (unswapped), and compass, baro and airspeed health', async () => {
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
    // IMU 1: AH all 1, GH not. Upstream's "Accel health" line shows the gyro flag (proven bug);
    // the port shows AH as accel health and GH as gyro health.
    const upIns = (await uploaded(bytes)).dom.getElementById('INS').textContent
    expect(upIns.split('IMU 2')[0]).toContain('Accel health: ❌Gyro health: ✅')
    expect([r.sensors.ins[0]?.accelHealthy, r.sensors.ins[0]?.gyroHealthy]).toEqual([true, false])
    expect(r.sensors.gps.map((g) => g?.device)).toEqual(['u-blox-F9', 'NMEA'])
  })

  it('ignores a boot message naming an unconfigured GPS, where upstream throws', async () => {
    const bytes = baseLog()
      .params({ GPS_TYPE: 1 })
      .write('MSG', [4, 'GPS 1: detected as u-blox at 230400 baud'])
      .write('MSG', [5, 'GPS 2: detected as u-blox at 230400 baud'])
      .bytes()
    const up = await createUpstreamHardwareReport()
    await expect(up.loadLog(bytes)).rejects.toThrow(/Cannot set properties of undefined/)
    // Port (proven bug fixed): the message is ignored and the report is built; GPS 1 keeps its device.
    const r = buildLogReport(DataflashLog.parse(bytes))
    expect(r.sensors.gps.map((g) => g?.device)).toEqual(
      ['u-blox', undefined, undefined, undefined].slice(0, r.sensors.gps.length)
    )
    // Without that message, the port's report matches upstream's in full.
    const control = baseLog().params({ GPS_TYPE: 1 }).write('MSG', [4, 'GPS 1: detected as u-blox at 230400 baud']).bytes()
    const fixed = await compareLog(control)
    expect(fixed.sensors).toEqual(r.sensors)
  })
})
