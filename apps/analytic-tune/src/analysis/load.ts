/**
 * Reading a system identification log: the runs it contains, the vehicle, the flight data
 * overview and the parameter values the tool models. Ported from upstream `load_log`.
 */
import { DataflashLog, timeUsToSeconds } from '@apwt/dataflash'
import {
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
  readonly runs: readonly SidRun[]
  readonly flight: SidFlightData
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

function numbers(log: DataflashLog, message: string, field: string): ArrayLike<number> {
  const column = log.getNumbers(message, field)
  if (column === undefined) throw new TuneLogError(`The log has no ${message}.${field} field.`)
  return column
}

/** Parameters read from a log for the given vehicle (upstream `load_log`'s parameter lists). */
function logParamNames(vehicle: TuneVehicle): string[] {
  const names: string[] = []
  for (const prefix of NOTCH_PREFIXES) for (const field of NOTCH_FIELDS) names.push(notchParam(prefix, field))
  for (const axis of TUNE_AXES) {
    const target = tuneTarget(vehicle, axis)
    if (target === null) continue
    const rate = controllerParams(target).rate
    for (const term of [...RATE_GAIN_TERMS, ...RATE_NOTCH_TERMS]) names.push(rate[term])
  }
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

/** Model inputs from the log's parameters (last logged value of each, as upstream). */
export function inputsFromLog(log: DataflashLog, vehicle: TuneVehicle): Map<InputName, number> {
  const inputs = new Map<InputName, number>()
  for (const name of logParamNames(vehicle)) {
    const value = log.param(name)
    if (value !== undefined && isInputName(name)) inputs.set(name, value)
  }

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

/** Read a log for system identification analysis. */
export function loadTuneLog(buffer: ArrayBuffer | Uint8Array): LoadedTuneLog {
  const log = DataflashLog.parse(buffer)
  if (!log.has('PARM')) throw new TuneLogError('The log has no parameters. Log a flight with PARM messages.')
  if (!log.has('SIDS') || !log.has('SIDD')) {
    throw new TuneLogError('The log has no system identification data (SIDS and SIDD). Fly in SystemID mode and try again.')
  }

  const siddTime = timeUsToSeconds(numbers(log, 'SIDD', 'TimeUS'))
  const sidsAxis = numbers(log, 'SIDS', 'Ax')
  const runs = findSidRuns(siddTime, sidsAxis, numbers(log, 'SIDS', 'TR'))
  const messages = log.textMessages()
  const vehicle = detectTuneVehicle(messages, sidsAxis.length > 0 ? sidsAxis[0] : undefined)

  return {
    log,
    vehicle,
    runs,
    flight: {
      time: siddTime,
      target: numbers(log, 'SIDD', 'Targ'),
      gyroX: numbers(log, 'SIDD', 'Gx'),
      gyroY: numbers(log, 'SIDD', 'Gy'),
      gyroZ: numbers(log, 'SIDD', 'Gz')
    },
    attitudeMessage: log.has('ANG') ? 'ANG' : 'ATT',
    inputs: inputsFromLog(log, vehicle),
    firmware: messages.find((m) => m.startsWith('Ardu')),
    messageTypes: [...log.messageTypes().keys()]
  }
}
