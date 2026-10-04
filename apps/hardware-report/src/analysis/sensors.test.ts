import { describe, expect, it } from 'vitest'
import { EMPTY_CAN } from './can.js'
import { readAirspeed } from './airspeed.js'
import { readBaro } from './baro.js'
import { readCompass } from './compass.js'
import { readGps } from './gps.js'
import { insParamNames, readIns } from './ins.js'
import { positionOffsets } from './position-offsets.js'
import { readFlow, readRangefinders, readViso } from './position-sensors.js'

const m = (o: Record<string, number>): Map<string, number> => new Map(Object.entries(o))

describe('IMU parameters', () => {
  it('builds names for every index', () => {
    expect(insParamNames(0)).toMatchObject({
      use: 'INS_USE',
      pos: ['INS_POS1_X', 'INS_POS1_Y', 'INS_POS1_Z'],
      gyro: { id: 'INS_GYR_ID', calTemp: 'INS_GYR1_CALTEMP' }
    })
    expect(insParamNames(2)).toMatchObject({
      use: 'INS_USE3',
      gyro: { id: 'INS_GYR3_ID' },
      accel: { scale: ['INS_ACC3SCAL_X', 'INS_ACC3SCAL_Y', 'INS_ACC3SCAL_Z'] }
    })
    expect(insParamNames(3)).toMatchObject({
      use: 'INS4_USE',
      gyro: { id: 'INS4_GYR_ID', calTemp: 'INS4_GYR_CALTEMP' },
      pos: ['INS4_POS_X', 'INS4_POS_Y', 'INS4_POS_Z']
    })
    // Proven upstream bug fixed: gyro coefficients are ArduPilot's GYR names (upstream repeats ACC).
    expect(insParamNames(0).tcal.gyro[0]).toEqual(['INS_TCAL1_GYR1_X', 'INS_TCAL1_GYR1_Y', 'INS_TCAL1_GYR1_Z'])
    // Upstream typo, kept (the name is never read): TMAN for TMAX.
    expect(insParamNames(0).tcal.tMax).toBe('INS_TCAL1_TMAN')
  })

  it('derives calibration state', () => {
    const base = {
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
      INS_POS1_X: 0,
      INS_POS1_Y: 0,
      INS_POS1_Z: 0,
      INS_TCAL1_ENABLE: 1,
      INS_TCAL1_ACC1_X: 0,
      INS_TCAL1_ACC1_Y: 0,
      INS_TCAL1_ACC1_Z: 0,
      INS_TCAL1_ACC2_X: 0,
      INS_TCAL1_ACC2_Y: 0,
      INS_TCAL1_ACC2_Z: 0,
      INS_TCAL1_ACC3_X: 0,
      INS_TCAL1_ACC3_Y: 0,
      INS_TCAL1_ACC3_Z: 0,
      INS_TCAL1_GYR1_X: 0,
      INS_TCAL1_GYR1_Y: 0,
      INS_TCAL1_GYR1_Z: 0,
      INS_TCAL1_GYR2_X: 0,
      INS_TCAL1_GYR2_Y: 0,
      INS_TCAL1_GYR2_Z: 0,
      INS_TCAL1_GYR3_X: 0,
      INS_TCAL1_GYR3_Y: 0,
      INS_TCAL1_GYR3_Z: 0,
      INS_GYR2_ID: 0,
      INS_ACC2_ID: 0
    }
    const clean = readIns(m(base), undefined, EMPTY_CAN)[0]
    // Proven upstream bug fixed: default offsets (0) and scales (1) are not calibrated (upstream
    // compared the offsets with 1.0 and showed calibrated).
    expect(clean).toMatchObject({
      accelCalibrated: false,
      gyroCalibrated: false,
      accelTempCalibrated: false,
      gyroTempCalibrated: false,
      posSet: false,
      combined: true
    })
    // Each temperature calibration is judged from its own coefficients.
    const gyrOnly = readIns(m({ ...base, INS_TCAL1_GYR2_Z: 0.5 }), undefined, EMPTY_CAN)[0]
    expect(gyrOnly).toMatchObject({ accelTempCalibrated: false, gyroTempCalibrated: true })
    const scaleOnly = readIns(m({ ...base, INS_ACCSCAL_Y: 1.01 }), undefined, EMPTY_CAN)[0]
    expect(scaleOnly).toMatchObject({ accelCalibrated: true })
    const cal = readIns(m({ ...base, INS_ACCSCAL_Y: 1.01, INS_TCAL1_ACC2_Z: 0.5, INS_POS1_X: 0.1 }), undefined, EMPTY_CAN)[0]
    expect(cal).toMatchObject({
      accelCalibrated: true,
      gyroCalibrated: false,
      accelTempCalibrated: true,
      gyroTempCalibrated: false,
      posSet: true
    })
    // Both ids zero: slot empty. Missing: slot empty.
    expect(readIns(m(base), undefined, EMPTY_CAN).slice(1)).toEqual([undefined, undefined, undefined, undefined])
  })
})

describe('compass slots', () => {
  it('uses priorities with calibration, then fills from the next device id', () => {
    const r = readCompass(
      m({
        COMPASS_ENABLE: 1,
        COMPASS_PRIO1_ID: 200,
        COMPASS_PRIO2_ID: 0,
        COMPASS_PRIO3_ID: 0,
        COMPASS_DEV_ID: 100,
        COMPASS_DEV_ID2: 200,
        COMPASS_DEV_ID3: 300,
        COMPASS_EXTERN2: 1,
        COMPASS_DIA2_X: 1,
        COMPASS_DIA2_Y: 1,
        COMPASS_DIA2_Z: 1.1,
        COMPASS_ODI2_X: 0,
        COMPASS_ODI2_Y: 0,
        COMPASS_ODI2_Z: 0,
        COMPASS_OFS2_X: 0,
        COMPASS_OFS2_Y: 0,
        COMPASS_OFS2_Z: 0,
        COMPASS_MOT2_X: 0,
        COMPASS_MOT2_Y: 0,
        COMPASS_MOT2_Z: 0
      }),
      undefined,
      EMPTY_CAN
    )
    expect(r.enabled).toBe(1)
    expect(r.sensors.map((s) => s?.device.devId)).toEqual([200, 200, 300, undefined, undefined, undefined, undefined])
    expect(r.sensors[0]?.calibration).toEqual({
      use: undefined,
      external: true,
      offsetsSet: false,
      matrixSet: true,
      motorSet: false
    })
    expect(r.sensors[1]?.calibration).toBeUndefined()
  })
})

describe('baro, airspeed, GPS and positioned sensors', () => {
  const params = m({
    BARO_PRIMARY: 0,
    BARO1_DEVID: 816641,
    BARO2_DEVID: 0,
    BARO1_WCF_ENABLE: 1,
    BARO1_WCF_FWD: 0.1,
    ARSPD_PRIMARY: 1,
    ARSPD_DEVID: 0,
    ARSPD2_DEVID: 0x0b0000 | 1,
    ARSPD2_USE: 1,
    GPS1_TYPE: 17,
    GPS1_POS_X: 0.1,
    GPS1_POS_Y: 0,
    GPS1_POS_Z: -0.2,
    GPS1_MB_TYPE: 1,
    GPS1_MB_OFS_X: -0.4,
    GPS1_MB_OFS_Y: 0,
    GPS1_MB_OFS_Z: 0,
    GPS2_TYPE: 0,
    RNGFND1_TYPE: 0,
    RNGFNDA_TYPE: 10,
    RNGFNDA_POS_X: 0.5,
    RNGFNDA_POS_Y: 0,
    RNGFNDA_POS_Z: 0.1,
    FLOW_TYPE: 6,
    VISO_TYPE: 0
  })

  it('reads barometers and airspeed sensors', () => {
    const baro = readBaro(params, undefined, EMPTY_CAN)
    expect(baro.primary).toBe(1)
    expect(baro.sensors[0]).toMatchObject({ number: 1, windCompensation: true, healthy: undefined })
    expect(baro.sensors.slice(1)).toEqual([undefined, undefined])
    const arsp = readAirspeed(params, undefined, EMPTY_CAN)
    expect(arsp.primary).toBe(2)
    expect(arsp.sensors[1]).toMatchObject({ number: 2, use: 1 })
    expect(arsp.sensors[1]?.device.decoded.name).toBe('AUAV')
  })

  it('reads GPS (4.6+ names) with moving baseline and plots offsets', () => {
    const gps = readGps(params, undefined, EMPTY_CAN)
    expect(gps[0]).toMatchObject({
      number: 1,
      type: 17,
      typeName: 'uBlox-MovingBaseline-Base',
      pos: [0.1, 0, -0.2],
      movingBase: [-0.4, 0, 0]
    })
    expect(gps[1]).toBeUndefined()
    const rng = readRangefinders(params)
    expect(rng[9]).toEqual({ number: 10, type: 10, pos: [0.5, 0, 0.1] })
    expect(readFlow(params)).toEqual({ number: 1, type: 6, pos: [undefined, undefined, undefined] })
    expect(readViso(params)).toBeUndefined()
    const offsets = positionOffsets({ ins: [], gps, rangefinders: rng, flow: readFlow(params), viso: undefined })
    expect(offsets.points.map((p) => p.name)).toEqual(['GPS 1 Master', 'GPS 1 Slave', 'Rangefinder 10'])
    expect(offsets.points[1]?.pos[0]).toBeCloseTo(0.5)
    expect(offsets.maxOffset).toBeCloseTo(0.5)
  })

  it('prefers the pre-4.6 GPS_TYPE names when present', () => {
    const gps = readGps(m({ GPS_TYPE: 0, GPS1_TYPE: 2, GPS_TYPE2: 9, GPS_CAN_NODEID2: 7, GPS_POS2_X: 1 }), undefined, EMPTY_CAN)
    expect(gps[0]).toBeUndefined()
    expect(gps[1]).toMatchObject({ type: 9, nodeId: 7, pos: [1, undefined, undefined], movingBase: undefined })
  })
})
