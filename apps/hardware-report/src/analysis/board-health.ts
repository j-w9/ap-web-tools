/**
 * Board temperature, voltage and power flag series (upstream `load_log()` Temperature,
 * Board_Voltage and power_flags plots).
 */
import type { DataflashLog } from '@apwt/dataflash'
import { allNaN, fieldSeries, timeSeconds, toFloat64, type Series } from './series.js'

/** Temperature series, °C. */
export interface TemperatureData {
  /** Heater target (`HEAT.Targ`). */
  readonly heaterTarget: Series | undefined
  /** Heater actual (`HEAT.Temp`). */
  readonly heaterActual: Series | undefined
  /** MCU temperature (`MCU.MTemp`, else `POWR.MTemp`). */
  readonly mcu: Series | undefined
  /** IMU temperatures (`IMU.T`) per instance. */
  readonly imu: readonly Series[]
}

/**
 * Temperatures, or `undefined` when the log has none of HEAT, POWR.MTemp, MCU or IMU (the
 * upstream condition for showing the plot).
 */
export function readTemperature(log: DataflashLog): TemperatureData | undefined {
  const haveHeat = log.has('HEAT')
  const haveMcu = log.has('MCU')
  const havePowrTemp = log.has('POWR', 'MTemp')
  const haveImu = log.has('IMU')
  if (!haveHeat && !havePowrTemp && !haveMcu && !haveImu) return undefined
  return {
    heaterTarget: haveHeat ? fieldSeries(log, 'heater target', 'HEAT', 'Targ') : undefined,
    heaterActual: haveHeat ? fieldSeries(log, 'heater actual', 'HEAT', 'Temp') : undefined,
    mcu: haveMcu ? fieldSeries(log, 'MCU', 'MCU', 'MTemp') : havePowrTemp ? fieldSeries(log, 'MCU', 'POWR', 'MTemp') : undefined,
    imu: log
      .instances('IMU')
      .map((i) => fieldSeries(log, `IMU ${i + 1}`, 'IMU', 'T', i))
      .filter((s): s is Series => s !== undefined)
  }
}

/** MCU voltage with its min/max envelope. */
export interface McuVoltage {
  /** `MVolt`. */
  readonly voltage: Series
  /** `MVmin`. */
  readonly min: Float64Array
  /** `MVmax`. */
  readonly max: Float64Array
}

/** Board voltage series, volts. */
export interface VoltageData {
  /** Servo rail (`POWR.VServo`), unless all NaN. */
  readonly servo: Series | undefined
  /** Board 5V (`POWR.Vcc`), unless all NaN. */
  readonly board: Series | undefined
  /** MCU voltage (`MCU`, else `POWR.MVolt`). */
  readonly mcu: McuVoltage | undefined
}

function mcuVoltage(log: DataflashLog, message: string): McuVoltage | undefined {
  const voltage = fieldSeries(log, 'MCU', message, 'MVolt')
  const min = log.getNumbers(message, 'MVmin')
  const max = log.getNumbers(message, 'MVmax')
  if (!voltage || !min || !max) return undefined
  return { voltage, min: toFloat64(min), max: toFloat64(max) }
}

/** Board voltages, or `undefined` when there is nothing to plot. */
export function readVoltage(log: DataflashLog): VoltageData | undefined {
  const havePowr = log.has('POWR')
  const haveMcu = log.has('MCU')
  if (!havePowr && !haveMcu) return undefined
  const servo = havePowr ? fieldSeries(log, 'servo', 'POWR', 'VServo') : undefined
  const board = havePowr ? fieldSeries(log, 'board', 'POWR', 'Vcc') : undefined
  let mcu: McuVoltage | undefined
  if (haveMcu) mcu = mcuVoltage(log, 'MCU')
  else if (havePowr && log.has('POWR', 'MVolt')) mcu = mcuVoltage(log, 'POWR')
  const data: VoltageData = {
    servo: servo !== undefined && !allNaN(servo.values) ? servo : undefined,
    board: board !== undefined && !allNaN(board.values) ? board : undefined,
    mcu
  }
  return data.servo || data.board || data.mcu ? data : undefined
}

/** `MAV_POWER_STATUS` bits. */
export const MAV_POWER_STATUS = {
  brickValid: 1 << 0,
  servoValid: 1 << 1,
  usbConnected: 1 << 2,
  periphOvercurrent: 1 << 3,
  periphHipowerOvercurrent: 1 << 4,
  changed: 1 << 5
} as const

/** Power status flags as 0/1 series. */
export interface PowerFlagsData {
  /** Seconds. */
  readonly time: Float64Array
  /** Primary power supply valid. */
  readonly brickValid: Float64Array
  /** Secondary (servo) power supply valid. */
  readonly servoValid: Float64Array
  /** USB connected. */
  readonly usbConnected: Float64Array
  /** Peripheral over-current. */
  readonly periphOvercurrent: Float64Array
  /** High-power peripheral over-current. */
  readonly periphHipowerOvercurrent: Float64Array
}

function bitSet(col: ArrayLike<number>, bit: number): Float64Array {
  const out = new Float64Array(col.length)
  for (let i = 0; i < col.length; i++) out[i] = ((col[i] as number) & bit) !== 0 ? 1 : 0
  return out
}

/**
 * Power flags from POWR, or `undefined` when not logged or when the accumulated flags show
 * they never changed.
 */
export function readPowerFlags(log: DataflashLog): PowerFlagsData | undefined {
  if (!log.has('POWR')) return undefined
  const accName = log.has('POWR', 'AccFlags') ? 'AccFlags' : 'AccFlg'
  const flagName = log.has('POWR', 'Flags') ? 'Flags' : 'Flg'
  const flags = log.getNumbers('POWR', flagName)
  const time = timeSeconds(log, 'POWR')
  if (flags === undefined || time === undefined) return undefined
  const acc = log.getNumbers('POWR', accName)
  if (acc !== undefined && bitSet(acc, MAV_POWER_STATUS.changed).every((v) => v === 0)) return undefined
  return {
    time,
    brickValid: bitSet(flags, MAV_POWER_STATUS.brickValid),
    servoValid: bitSet(flags, MAV_POWER_STATUS.servoValid),
    usbConnected: bitSet(flags, MAV_POWER_STATUS.usbConnected),
    periphOvercurrent: bitSet(flags, MAV_POWER_STATUS.periphOvercurrent),
    periphHipowerOvercurrent: bitSet(flags, MAV_POWER_STATUS.periphHipowerOvercurrent)
  }
}
