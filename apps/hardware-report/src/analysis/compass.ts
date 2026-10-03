/**
 * Compasses (upstream `load_compass()`).
 */
import type { DataflashLog } from '@apwt/dataflash'
import type { CanInventory } from './can.js'
import { describeDevice, type SensorDevice } from './device.js'
import { healthByInstance } from './health.js'
import { paramArray, paramArrayConfigured } from './param-arrays.js'
import type { ParamValues } from './params.js'
import { DeviceType } from './shared/decode-devid.js'
import { compassParamNames } from './shared/param-helpers.js'

/** Number of compass slots the report fills (3 priority slots plus extra detected ids). */
export const MAX_NUM_COMPASS = 7

/** Calibration state, only known for compasses in a priority slot. */
export interface CompassCalibration {
  /** `COMPASS_USE[n]`. */
  readonly use: number | undefined
  /** External flag is set (`COMPASS_EXTERNAL`/`COMPASS_EXTERN<n>` > 0). */
  readonly external: boolean
  /** Offsets differ from zero. */
  readonly offsetsSet: boolean
  /** Soft-iron matrix differs from identity. */
  readonly matrixSet: boolean
  /** Motor compensation differs from zero. */
  readonly motorSet: boolean
}

/** One compass. */
export interface CompassSensor {
  /** 1-based compass number (slot + 1). */
  readonly number: number
  /** Device id. */
  readonly device: SensorDevice
  /** Calibration, for compasses found through `COMPASS_PRIOn_ID` (upstream `full_inst`). */
  readonly calibration: CompassCalibration | undefined
  /** Healthy throughout the log (`MAG.Health`); `undefined` without log data. */
  readonly healthy: boolean | undefined
}

/** Compass section of the report. */
export interface CompassReport {
  /** `COMPASS_ENABLE` value. */
  readonly enabled: number | undefined
  /** Slots 0..{@link MAX_NUM_COMPASS}-1; `undefined` where empty. */
  readonly sensors: readonly (CompassSensor | undefined)[]
}

function prioInstance(params: ParamValues, prioIdName: string): { id: number; calibration: CompassCalibration } | undefined {
  const id = params.get(prioIdName)
  if (id === undefined || id === 0) return undefined

  // Find the compass index with this id.
  let index: number | undefined
  for (let i = 1; i <= 3; i++) {
    const devIdName = i !== 1 ? `COMPASS_DEV_ID${i}` : 'COMPASS_DEV_ID'
    if (params.get(devIdName) === id) {
      index = i
      break
    }
  }
  if (index === undefined) return undefined

  const names = compassParamNames(index)
  return {
    id,
    calibration: {
      use: params.get(names.use),
      external: (params.get(names.external) ?? 0) > 0,
      offsetsSet: paramArrayConfigured(paramArray(params, names.offsets), 0),
      matrixSet:
        paramArrayConfigured(paramArray(params, names.diagonals), 1) ||
        paramArrayConfigured(paramArray(params, names.offDiagonals), 0),
      motorSet: paramArrayConfigured(paramArray(params, names.motor), 0)
    }
  }
}

/**
 * Compasses from `COMPASS_PRIOn_ID` (with calibration state) followed by any remaining
 * `COMPASS_DEV_IDn` ids, with health from MAG instances when a log is given.
 */
export function readCompass(params: ParamValues, log: DataflashLog | undefined, can: CanInventory): CompassReport {
  const slots: ({ id: number; calibration: CompassCalibration | undefined } | undefined)[] = Array.from(
    { length: MAX_NUM_COMPASS },
    () => undefined
  )

  let devIdStart = 0
  for (let i = 0; i < 3; i++) {
    const prio = prioInstance(params, `COMPASS_PRIO${i + 1}_ID`)
    if (prio !== undefined) {
      slots[i] = prio
      devIdStart = i + 1
    }
  }
  // Upstream quirk kept: the remaining slots read COMPASS_DEV_ID<slot+1>, so with all three
  // priorities set slots 4..7 show COMPASS_DEV_ID4..7.
  for (let i = devIdStart; i < MAX_NUM_COMPASS; i++) {
    const id = params.get(i === 0 ? 'COMPASS_DEV_ID' : `COMPASS_DEV_ID${i + 1}`)
    if (id !== undefined && id !== 0) slots[i] = { id, calibration: undefined }
  }

  const health = healthByInstance(log, 'MAG', ['Health'])
  return {
    enabled: params.get('COMPASS_ENABLE'),
    sensors: slots.map((slot, i) =>
      slot === undefined
        ? undefined
        : {
            number: i + 1,
            device: describeDevice(slot.id, DeviceType.compass, can),
            calibration: slot.calibration,
            healthy: health.get(i)
          }
    )
  }
}
