/**
 * Barometers (upstream `get_baro_param_names()` and `load_baro()`).
 */
import type { DataflashLog } from '@apwt/dataflash'
import type { CanInventory } from './can.js'
import { describeDevice, type SensorDevice } from './device.js'
import { healthByInstance } from './health.js'
import { paramArray } from './param-arrays.js'
import type { ParamValues } from './params.js'
import { DeviceType } from '@apwt/ardupilot'

/** Number of barometer slots. */
export const MAX_NUM_BARO = 3

/** Parameter names of one barometer. */
export interface BaroParamNames {
  /** Device id. */
  readonly id: string
  /** Ground pressure calibration. */
  readonly gndPress: string
  /** Wind compensation enable and coefficients (fwd, back, right, left, up, down). */
  readonly windComp: { readonly enabled: string; readonly coefficients: readonly string[] }
}

/** Parameter names for a 0-based barometer index. */
export function baroParamNames(index: number): BaroParamNames {
  const prefix = `BARO${index + 1}_`
  const wcf = prefix + 'WCF_'
  return {
    id: prefix + 'DEVID',
    gndPress: prefix + 'GND_PRESS',
    windComp: {
      enabled: wcf + 'ENABLE',
      coefficients: ['FWD', 'BCK', 'RGT', 'LFT', 'UP', 'DN'].map((s) => wcf + s)
    }
  }
}

/** One barometer. */
export interface BaroSensor {
  /** 1-based number. */
  readonly number: number
  /** Device id. */
  readonly device: SensorDevice
  /** Wind compensation enabled with non-zero coefficients. */
  readonly windCompensation: boolean
  /** Healthy throughout the log (`BARO.Health` or `BARO.H`); `undefined` without log data. */
  readonly healthy: boolean | undefined
}

/** Barometer section. */
export interface BaroReport {
  /** 1-based primary barometer (`BARO_PRIMARY + 1`), `undefined` when the param is missing. */
  readonly primary: number | undefined
  /** Slots 0..2; `undefined` where empty. */
  readonly sensors: readonly (BaroSensor | undefined)[]
}

/** Barometers configured by `BAROn_DEVID`, with health from BARO instances. */
export function readBaro(params: ParamValues, log: DataflashLog | undefined, can: CanInventory): BaroReport {
  const health = healthByInstance(log, 'BARO', ['Health', 'H'])
  const sensors: (BaroSensor | undefined)[] = []
  for (let i = 0; i < MAX_NUM_BARO; i++) {
    const names = baroParamNames(i)
    const id = params.get(names.id)
    if (id === undefined || id === 0) {
      sensors.push(undefined)
      continue
    }
    let windCompensation = false
    if ((params.get(names.windComp.enabled) ?? 0) > 0) {
      windCompensation = !paramArray(params, names.windComp.coefficients).every((v) => v === 0)
    }
    sensors.push({ number: i + 1, device: describeDevice(id, DeviceType.baro, can), windCompensation, healthy: health.get(i) })
  }
  const primary = params.get('BARO_PRIMARY')
  return { primary: primary === undefined ? undefined : primary + 1, sensors }
}
