/**
 * Airspeed sensors (upstream `get_airspeed_param_names()` and `load_airspeed()`).
 */
import type { DataflashLog } from '@apwt/dataflash'
import type { CanInventory } from './can.js'
import { describeDevice, type SensorDevice } from './device.js'
import { healthByInstance } from './health.js'
import type { ParamValues } from './params.js'
import { DeviceType } from '@apwt/ardupilot'

/** Number of airspeed slots. */
export const MAX_NUM_AIRSPEED = 6

/** Parameter names of one airspeed sensor. */
export interface AirspeedParamNames {
  /** Device id. */
  readonly id: string
  /** Sensor type. */
  readonly type: string
  /** I2C bus. */
  readonly bus: string
  /** Analog pin. */
  readonly pin: string
  /** Pressure range (PSI). */
  readonly psiRange: string
  /** Pitot tube order. */
  readonly tubeOrder: string
  /** Skip calibration at boot. */
  readonly skipCal: string
  /** Use flag. */
  readonly use: string
  /** Calibration offset. */
  readonly offset: string
  /** Calibration ratio. */
  readonly ratio: string
  /** In-flight auto calibration. */
  readonly autoCal: string
}

/** Parameter names for a 0-based airspeed index (`ARSPD_` for the first, `ARSPDn_` after). */
export function airspeedParamNames(index: number): AirspeedParamNames {
  const prefix = 'ARSPD' + (index === 0 ? '' : String(index + 1)) + '_'
  return {
    id: prefix + 'DEVID',
    type: prefix + 'TYPE',
    bus: prefix + 'BUS',
    pin: prefix + 'PIN',
    psiRange: prefix + 'PSI_RANGE',
    tubeOrder: prefix + (index === 0 ? 'TUBE_ORDER' : 'TUBE_ORDR'),
    skipCal: prefix + 'SKIP_CAL',
    use: prefix + 'USE',
    offset: prefix + 'OFFSET',
    ratio: prefix + 'RATIO',
    autoCal: prefix + 'AUTOCAL'
  }
}

/** One airspeed sensor. */
export interface AirspeedSensor {
  /** 1-based number. */
  readonly number: number
  /** Device id. */
  readonly device: SensorDevice
  /** `ARSPD[n]_USE`. */
  readonly use: number | undefined
  /** Healthy throughout the log (`ARSP.H`); `undefined` without log data. */
  readonly healthy: boolean | undefined
}

/** Airspeed section. */
export interface AirspeedReport {
  /** 1-based primary sensor (`ARSPD_PRIMARY + 1`). */
  readonly primary: number | undefined
  /** Slots 0..5; `undefined` where empty. */
  readonly sensors: readonly (AirspeedSensor | undefined)[]
}

/** Airspeed sensors configured by `ARSPD[n]_DEVID`, with health from ARSP instances. */
export function readAirspeed(params: ParamValues, log: DataflashLog | undefined, can: CanInventory): AirspeedReport {
  const health = healthByInstance(log, 'ARSP', ['H'])
  const sensors: (AirspeedSensor | undefined)[] = []
  for (let i = 0; i < MAX_NUM_AIRSPEED; i++) {
    const names = airspeedParamNames(i)
    const id = params.get(names.id)
    if (id === undefined || id === 0) {
      sensors.push(undefined)
      continue
    }
    sensors.push({
      number: i + 1,
      device: describeDevice(id, DeviceType.airspeed, can),
      use: params.get(names.use),
      healthy: health.get(i)
    })
  }
  const primary = params.get('ARSPD_PRIMARY')
  return { primary: primary === undefined ? undefined : primary + 1, sensors }
}
