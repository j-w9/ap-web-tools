/**
 * Reading a system identification log: the runs it contains, the vehicle, the flight data
 * overview and the parameter values the tool models. Ported from upstream `load_log`.
 */
import { DataflashLog, timeUsToSeconds } from '@apwt/dataflash'
import {
  FIXED_WING_YAW_NOTCH,
  FILTER_FIELDS,
  FILTER_INDICES,
  NOTCH_FIELDS,
  NOTCH_PREFIXES,
  RATE_GAIN_TERMS,
  RATE_NOTCH_TERMS,
  TUNE_AXES,
  controllerParams,
  filterParam,
  isInputName,
  notchParam,
  tuneTarget,
  type InputName,
  type TuneVehicle
} from './params.js'
import { inputValueFromNumber } from './form-values.js'
import { detectTuneVehicle, findSidRuns, type SidRun } from './sid.js'

/** `SIDD` overview for the flight data plot: target and gyro rates against time (s). */
export interface SidFlightData {
  readonly time: Float64Array
  readonly target: ArrayLike<number>
  readonly gyroX: ArrayLike<number>
  readonly gyroY: ArrayLike<number>
  readonly gyroZ: ArrayLike<number>
}

export interface LoadedTuneLog {
  readonly log: DataflashLog
  readonly vehicle: TuneVehicle
  /** Runs found in the log; empty when it has no `SIDD` data. */
  readonly runs: readonly SidRun[]
  /** `SIDD` overview, or null when the log has none. */
  readonly flight: SidFlightData | null
  /** Attitude comes from `ANG` when the log has it, otherwise from `ATT`. */
  readonly attitudeMessage: 'ANG' | 'ATT'
  /** Values read from the log's parameters, for the inputs the tool models. */
  readonly inputs: ReadonlyMap<InputName, number>
  /** Firmware banner, when logged. */
  readonly firmware: string | undefined
  readonly messageTypes: readonly string[]
}

/** Thrown for logs the tool cannot use; the message says what is missing. */
export class TuneLogError extends Error {
  override readonly name = 'TuneLogError'
}

/**
 * Thrown where upstream's `load_log` fails part way: the inputs it had already copied from the
 * log stay applied (`inputs`), nothing else from the log is used.
 */
export class PartialTuneLogError extends TuneLogError {
  constructor(
    message: string,
    readonly inputs: ReadonlyMap<InputName, number>
  ) {
    super(message)
  }
}

function numbers(log: DataflashLog, message: string, field: string): ArrayLike<number> {
  const column = log.getNumbers(message, field)
  if (column === undefined) throw new TuneLogError(`The log has no ${message}.${field} field.`)
  return column
}

/** Harmonic notch parameters, which upstream copies before it decides the vehicle. */
function notchParamNames(): string[] {
  const names: string[] = []
  for (const prefix of NOTCH_PREFIXES) for (const field of NOTCH_FIELDS) names.push(notchParam(prefix, field))
  return names
}

/**
 * Parameters read from a log for the given vehicle (upstream `load_log`'s parameter lists).
 * Upstream also lists the fixed-wing yaw rate gains and `YAW2SRV_TCONST`, which have no inputs on
 * its page except `YAW_RATE_NTF`/`NEF`; those two are copied (they are saved for fixed-wing yaw).
 */
function logParamNames(vehicle: TuneVehicle): string[] {
  const names = notchParamNames()
  for (const axis of TUNE_AXES) {
    const target = tuneTarget(vehicle, axis)
    if (target === null) continue
    const rate = controllerParams(target).rate
    for (const term of [...RATE_GAIN_TERMS, ...RATE_NOTCH_TERMS]) names.push(rate[term])
  }
  if (vehicle === 'fixed-wing') names.push(FIXED_WING_YAW_NOTCH.NTF, FIXED_WING_YAW_NOTCH.NEF)
  for (const index of FILTER_INDICES) for (const field of FILTER_FIELDS) names.push(filterParam(index, field))
  names.push(
    'INS_GYRO_FILTER',
    'ATC_INPUT_TC',
    'PILOT_Y_RATE_TC',
    'ATC_ANG_RLL_P',
    'ATC_ANG_PIT_P',
    'ATC_ANG_YAW_P',
    'Q_A_INPUT_TC',
    'Q_PLT_Y_RATE_TC',
    'Q_A_ANG_RLL_P',
    'Q_A_ANG_PIT_P',
    'Q_A_ANG_YAW_P',
    'RLL2SRV_TCONST',
    'PTCH2SRV_TCONST'
  )
  return names
}

function copyParams(log: DataflashLog, names: readonly string[], inputs: Map<InputName, number>): void {
  for (const name of names) {
    const value = log.param(name)
    // Upstream writes the value into the page input, so a drop-down keeps only its option values.
    if (value !== undefined && isInputName(name)) inputs.set(name, inputValueFromNumber(name, value))
  }
}

/** Model inputs from the log's parameters (last logged value of each, as upstream). */
export function inputsFromLog(log: DataflashLog, vehicle: TuneVehicle): Map<InputName, number> {
  const inputs = new Map<InputName, number>()
  copyParams(log, logParamNames(vehicle), inputs)

  // Approximate the gyro sample rate. Upstream compares the possibly missing INS_GYRO_RATE with
  // `!= 0` and shifts by it, so a log without it gives 1 kHz.
  const gyroRate = log.param('INS_GYRO_RATE')
  if (gyroRate !== 0) inputs.set('GyroSampleRate', (1 << (gyroRate ?? 0)) * 1000)

  // Approximate the rate loop rate, which runs at the gyro rate divided down with fast rate.
  const loopRate = log.param('SCHED_LOOP_RATE')
  const fastRate = log.param('FSTRATE_ENABLE')
  const fastRateDiv = log.param('FSTRATE_DIV')
  if (loopRate !== undefined && loopRate > 0) {
    if (fastRate !== undefined && fastRate > 0 && fastRateDiv !== undefined && fastRateDiv > 0) {
      inputs.set('SCHED_LOOP_RATE', ((1 << (gyroRate ?? 0)) * 1000) / fastRateDiv)
    } else {
      inputs.set('SCHED_LOOP_RATE', loopRate)
    }
  }
  return inputs
}

/** Upstream page state that carries over from one log to the next. */
export interface PreviousLogState {
  /** `vehicle_type`: kept when the new log has no firmware banner. */
  readonly vehicle: TuneVehicle
}

/**
 * Read a log for system identification analysis, following upstream `load_log`:
 *
 * - no `PARM`: upstream alerts "No params in log" and stops;
 * - `SIDD` without `SIDS`, or fewer `SIDD` runs than `SIDS` records: upstream throws while listing
 *   the runs, before copying any parameter;
 * - no `SIDD`: no runs, but the parameters are still copied (a later calculation fails);
 * - a plane banner without `SIDS`: upstream throws deciding fixed wing or VTOL, after copying the
 *   harmonic notch parameters (`PartialTuneLogError`).
 */
export function loadTuneLog(buffer: ArrayBuffer | Uint8Array, previous: PreviousLogState = { vehicle: 'copter' }): LoadedTuneLog {
  const log = DataflashLog.parse(buffer)
  if (!log.has('PARM')) throw new TuneLogError('No params in log')

  const hasSids = log.has('SIDS')
  const sidsAxis = hasSids ? numbers(log, 'SIDS', 'Ax') : undefined
  let runs: SidRun[] = []
  let flight: SidFlightData | null = null
  if (log.has('SIDD')) {
    if (sidsAxis === undefined) throw new TuneLogError('The log has SIDD data but no SIDS records, which upstream cannot read.')
    const siddTime = timeUsToSeconds(numbers(log, 'SIDD', 'TimeUS'))
    runs = findSidRuns(siddTime, sidsAxis, numbers(log, 'SIDS', 'TR'))
    flight = {
      time: siddTime,
      target: numbers(log, 'SIDD', 'Targ'),
      gyroX: numbers(log, 'SIDD', 'Gx'),
      gyroY: numbers(log, 'SIDD', 'Gy'),
      gyroZ: numbers(log, 'SIDD', 'Gz')
    }
  }

  const messages = log.textMessages()
  const banner = messages.map((m) => m.split(' ')[0]).find((first) => first === 'ArduPlane' || first === 'ArduCopter')
  if (banner === 'ArduPlane' && sidsAxis === undefined) {
    const partial = new Map<InputName, number>()
    copyParams(log, notchParamNames(), partial)
    throw new PartialTuneLogError('The log is from a plane but has no SIDS records, which upstream cannot read.', partial)
  }
  const vehicle = detectTuneVehicle(
    messages,
    sidsAxis !== undefined && sidsAxis.length > 0 ? sidsAxis[0] : undefined,
    previous.vehicle
  )

  return {
    log,
    vehicle,
    runs,
    flight,
    attitudeMessage: log.has('ANG') ? 'ANG' : 'ATT',
    inputs: inputsFromLog(log, vehicle),
    firmware: messages.find((m) => m.startsWith('Ardu')),
    messageTypes: [...log.messageTypes().keys()]
  }
}
