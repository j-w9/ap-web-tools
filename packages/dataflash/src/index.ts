/**
 * `@apwt/dataflash`: parser for ArduPilot DataFlash binary logs.
 *
 * @example
 * ```ts
 * const log = DataflashLog.parse(buffer)
 * const roll = log.get('ATT', 'Roll')          // Float32Array
 * const gyrX = log.getInstance('IMU', 0, 'GyrX')
 * for (const [name, info] of log.messageTypes()) console.log(name, info.count)
 * ```
 */
export { DataflashLog, leapSecondsGps, leapSecondsTai } from './log.js'
export type { FieldInfo, MessageStats, MessageTypeInfo, ParseOptions, ParsedMessage } from './log.js'
export type { Column, NumericColumn } from './decode.js'
export type { FormatDefinition, TypeCode } from './format.js'
export { TYPE_SIZES, isTypeCode, makeFormat } from './format.js'
export type { FieldUnits } from './units.js'
export { BUILTIN_MULTIPLIERS, BUILTIN_UNITS } from './units.js'
export {
  MavType,
  detectVehicleType,
  mavTypeForVehicle,
  modeName,
  modeTable,
  vehicleTypeForMavType
} from './modes.js'
export type { ModeChange, VehicleType } from './modes.js'
