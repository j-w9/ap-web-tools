/**
 * Inertial sensors (upstream `get_ins_param_names()` and `load_ins()`).
 */
import type { DataflashLog } from '@apwt/dataflash'
import type { CanInventory } from './can.js'
import { describeDevice, type SensorDevice } from './device.js'
import { healthByInstance } from './health.js'
import { paramArray, paramArrayConfigured, paramVector3, type ParamVector3 } from './param-arrays.js'
import type { ParamValues } from './params.js'
import { DeviceType, paramNameVector3, type Vector3Names } from '@apwt/ardupilot'

/** Maximum number of IMUs the report looks for. */
export const MAX_NUM_INS = 5

/** Parameter names of one IMU. */
export interface InsParamNames {
  /** Gyro offsets, id and calibration temperature. */
  readonly gyro: { readonly offset: Vector3Names; readonly id: string; readonly calTemp: string }
  /** Accel offsets, scale, id and calibration temperature. */
  readonly accel: {
    readonly offset: Vector3Names
    readonly scale: Vector3Names
    readonly id: string
    readonly calTemp: string
  }
  /** Temperature calibration parameters. */
  readonly tcal: {
    readonly enabled: string
    readonly tMin: string
    readonly tMax: string
    readonly accel: readonly [Vector3Names, Vector3Names, Vector3Names]
    readonly gyro: readonly [Vector3Names, Vector3Names, Vector3Names]
  }
  /** Position offset. */
  readonly pos: Vector3Names
  /** Use flag. */
  readonly use: string
}

/**
 * Parameter names for a 0-based IMU index (upstream `get_ins_param_names`).
 *
 * The gyro temperature coefficients are ArduPilot's `..._GYR1_..` to `..._GYR3_..` (proven upstream
 * bug fixed: upstream repeats the accel names `..._ACC1_..`, see docs/bug-proofs/hardware-report.md).
 * Upstream typo, kept (never read, no effect): the temperature-calibration max is `..._TMAN`
 * (ArduPilot's is `TMAX`).
 */
export function insParamNames(index: number): InsParamNames {
  const n = index + 1
  const prefix = n > 3 ? `INS${n}` : 'INS'
  const fullNum = n < 4 ? String(n) : ''
  const num = n === 1 ? '' : fullNum

  const gyroPrefix = prefix + '_GYR' + num
  const accPrefix = prefix + '_ACC' + num
  const tcal = prefix + '_TCAL' + fullNum + '_'
  return {
    gyro: {
      offset: paramNameVector3(gyroPrefix + 'OFFS_'),
      id: gyroPrefix + '_ID',
      calTemp: prefix + '_GYR' + fullNum + '_CALTEMP'
    },
    accel: {
      offset: paramNameVector3(accPrefix + 'OFFS_'),
      scale: paramNameVector3(accPrefix + 'SCAL_'),
      id: accPrefix + '_ID',
      calTemp: prefix + '_ACC' + fullNum + '_CALTEMP'
    },
    tcal: {
      enabled: tcal + 'ENABLE',
      tMin: tcal + 'TMIN',
      tMax: tcal + 'TMAN',
      accel: [paramNameVector3(tcal + 'ACC1_'), paramNameVector3(tcal + 'ACC2_'), paramNameVector3(tcal + 'ACC3_')],
      gyro: [paramNameVector3(tcal + 'GYR1_'), paramNameVector3(tcal + 'GYR2_'), paramNameVector3(tcal + 'GYR3_')]
    },
    pos: paramNameVector3(prefix + '_POS' + fullNum + '_'),
    use: prefix + '_USE' + num
  }
}

/** One IMU as configured by parameters, plus log health. */
export interface InsSensor {
  /** 1-based IMU number. */
  readonly number: number
  /** Gyro device. */
  readonly gyro: SensorDevice
  /** Accel device. */
  readonly accel: SensorDevice
  /** Whether gyro and accel are the same chip (same device id). */
  readonly combined: boolean
  /** `INS_USE` value. */
  readonly use: number | undefined
  /** Accel offsets or scale differ from defaults. */
  readonly accelCalibrated: boolean
  /** Gyro offsets differ from defaults. */
  readonly gyroCalibrated: boolean
  /** Temperature calibration enabled with non-zero accel coefficients. */
  readonly accelTempCalibrated: boolean
  /** Temperature calibration enabled with non-zero gyro coefficients. */
  readonly gyroTempCalibrated: boolean
  /** Position offset. */
  readonly pos: ParamVector3
  /** Position offset set (any component non-zero or missing). */
  readonly posSet: boolean
  /**
   * "Accel health": whether `IMU.AH` is 1 throughout the log (proven upstream bug fixed: upstream
   * shows the gyro flag here and the accel flag as gyro health). `undefined` without log data.
   */
  readonly accelHealthy: boolean | undefined
  /** "Gyro health": whether `IMU.GH` is 1 throughout the log. */
  readonly gyroHealthy: boolean | undefined
}

function readInstance(
  params: ParamValues,
  index: number,
  can: CanInventory
): Omit<InsSensor, 'accelHealthy' | 'gyroHealthy'> | undefined {
  const names = insParamNames(index)
  const gyroId = params.get(names.gyro.id)
  const accId = params.get(names.accel.id)
  if (gyroId === undefined && accId === undefined) return undefined
  if (gyroId === 0 && accId === 0) return undefined

  let accelTemp = false
  let gyroTemp = false
  if ((params.get(names.tcal.enabled) ?? 0) > 0) {
    for (let i = 0; i < 3; i++) {
      accelTemp ||= paramArrayConfigured(paramArray(params, names.tcal.accel[i] as Vector3Names), 0)
      gyroTemp ||= paramArrayConfigured(paramArray(params, names.tcal.gyro[i] as Vector3Names), 0)
    }
  }

  // Proven upstream bug fixed: upstream compares the accel *offset* names with 1.0 instead of the
  // scale names (docs/bug-proofs/hardware-report.md).
  const accelCalibrated =
    paramArrayConfigured(paramArray(params, names.accel.offset), 0) ||
    paramArrayConfigured(paramArray(params, names.accel.scale), 1)

  // Upstream treats a missing id as `undefined`; decode it as 0 so the device is still typed.
  const gyro = describeDevice(gyroId ?? 0, DeviceType.imu, can)
  const accel = describeDevice(accId ?? 0, DeviceType.imu, can)
  const pos = paramVector3(params, names.pos)
  return {
    number: index + 1,
    gyro,
    accel,
    combined: gyroId === accId,
    use: params.get(names.use),
    accelCalibrated,
    gyroCalibrated: paramArrayConfigured(paramArray(params, names.gyro.offset), 0),
    accelTempCalibrated: accelTemp,
    gyroTempCalibrated: gyroTemp,
    pos,
    posSet: paramArrayConfigured(pos, 0)
  }
}

/**
 * IMUs configured by parameters, indexed 0..{@link MAX_NUM_INS}-1 (`undefined` for absent
 * slots), with health from the log's IMU instances when a log is given.
 */
export function readIns(params: ParamValues, log: DataflashLog | undefined, can: CanInventory): (InsSensor | undefined)[] {
  const accHealth = healthByInstance(log, 'IMU', ['AH'])
  const gyroHealth = healthByInstance(log, 'IMU', ['GH'])
  const out: (InsSensor | undefined)[] = []
  for (let i = 0; i < MAX_NUM_INS; i++) {
    const inst = readInstance(params, i, can)
    out.push(inst === undefined ? undefined : { ...inst, accelHealthy: accHealth.get(i), gyroHealthy: gyroHealth.get(i) })
  }
  return out
}
