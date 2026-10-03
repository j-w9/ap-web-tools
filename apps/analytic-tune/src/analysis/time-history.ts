/**
 * The time histories a system identification run is analysed from, sliced to the analysis window
 * and converted to radians. Ported from upstream `load_vtol_time_history_data` and
 * `load_fw_time_history_data`.
 */
import type { DataflashLog } from '@apwt/dataflash'
import { arrayMean, arrayScale, arraySub } from '@apwt/signal'
import type { FixedWingAxis, TuneAxis, TuneTarget } from './params.js'
import { TuneLogError } from './load.js'

/** Signals used to identify the responses, in upstream's key order (the FFT windows follow the first). */
export const SIGNAL_KEYS = [
  'PilotInput',
  'ActInput',
  'GyroRaw',
  'RateTgt',
  'Rate',
  'AttTgt',
  'Att',
  'DRBin',
  'DRBresp',
  'SysBLInput',
  'SysBLOutput'
] as const
export type SignalKey = (typeof SIGNAL_KEYS)[number]

/** Mean airspeed scaling over the window; fixed-wing gains are scheduled with it. */
export interface AirspeedScaling {
  readonly aspeed: number
  readonly eas2tas: number
}

/** Unity scaling for multirotors. */
export const NO_AIRSPEED_SCALING: AirspeedScaling = { aspeed: 1, eas2tas: 1 }

export interface TimeHistory {
  readonly signals: Readonly<Record<SignalKey, Float64Array>>
  /** Average sample rate of the window (Hz). */
  readonly sampleRate: number
  readonly airspeed: AirspeedScaling
}

/** Upstream's degrees to radians factor. */
const DEG_TO_RAD = 0.01745

/** Index of the value closest to `target`; the first wins a tie (upstream `nearestIndex`). */
export function nearestIndex(values: ArrayLike<number>, target: number): number | null {
  let minDist: number | null = null
  let minIndex: number | null = null
  for (let i = 0; i < values.length; i++) {
    const dist = Math.abs(values[i]! - target)
    if (minDist === null || dist < minDist) {
      minDist = dist
      minIndex = i
    }
  }
  return minIndex
}

function numbers(log: DataflashLog, message: string, field: string): ArrayLike<number> {
  const column = log.getNumbers(message, field)
  if (column === undefined) throw new TuneLogError(`The log has no ${message}.${field} field, which this analysis needs.`)
  return column
}

/** A message's samples within [start, end] (s): the index range nearest to each end, end exclusive. */
interface Window {
  readonly first: number
  readonly last: number
}

function windowOf(time: ArrayLike<number>, startTime: number, endTime: number): Window {
  const first = nearestIndex(time, startTime * 1000000)
  const last = nearestIndex(time, endTime * 1000000)
  if (first === null || last === null) throw new TuneLogError('The log has no samples in the analysis window.')
  return { first, last }
}

function slice(values: ArrayLike<number>, w: Window): Float64Array {
  const out = new Float64Array(Math.max(0, w.last - w.first))
  for (let i = 0; i < out.length; i++) out[i] = values[w.first + i]!
  return out
}

const sliceRad = (values: ArrayLike<number>, w: Window): Float64Array => arrayScale(slice(values, w), DEG_TO_RAD)

/** Average sample rate of sliced timestamps (µs): samples over elapsed seconds, as upstream. */
function averageRate(timeUs: Float64Array): number {
  const record = (timeUs[timeUs.length - 1]! - timeUs[0]!) / 1000000
  return timeUs.length / record
}

/** Disturbance rejection and whole-system loop signals, shared by both vehicle types. */
function derivedSignals(pilotInput: Float64Array, actInput: Float64Array, att: Float64Array) {
  return {
    DRBin: pilotInput,
    DRBresp: arraySub(att, pilotInput),
    SysBLInput: actInput,
    SysBLOutput: arraySub(arrayScale(pilotInput, 1.0 / DEG_TO_RAD), actInput)
  }
}

const MULTIROTOR_FIELDS: Readonly<
  Record<TuneAxis, { act: string; rateTgt: string; rate: string; attTgt: string; att: string; gyro: string }>
> = {
  Roll: { act: 'ROut', rateTgt: 'RDes', rate: 'R', attTgt: 'DesRoll', att: 'Roll', gyro: 'Gx' },
  Pitch: { act: 'POut', rateTgt: 'PDes', rate: 'P', attTgt: 'DesPitch', att: 'Pitch', gyro: 'Gy' },
  Yaw: { act: 'YOut', rateTgt: 'YDes', rate: 'Y', attTgt: 'DesYaw', att: 'Yaw', gyro: 'Gz' }
}

function multirotorHistory(
  log: DataflashLog,
  attitudeMessage: 'ANG' | 'ATT',
  axis: TuneAxis,
  startTime: number,
  endTime: number
): TimeHistory {
  const rateTime = numbers(log, 'RATE', 'TimeUS')
  const rateWindow = windowOf(rateTime, startTime, endTime)
  const sampleRate = averageRate(slice(rateTime, rateWindow))
  const attWindow = windowOf(numbers(log, attitudeMessage, 'TimeUS'), startTime, endTime)
  const siddWindow = windowOf(numbers(log, 'SIDD', 'TimeUS'), startTime, endTime)

  const f = MULTIROTOR_FIELDS[axis]
  const actInput = slice(numbers(log, 'RATE', f.act), rateWindow)
  const att = sliceRad(numbers(log, attitudeMessage, f.att), attWindow)
  const pilotInput = sliceRad(numbers(log, 'SIDD', 'Targ'), siddWindow)
  return {
    signals: {
      PilotInput: pilotInput,
      ActInput: actInput,
      GyroRaw: sliceRad(numbers(log, 'SIDD', f.gyro), siddWindow),
      RateTgt: sliceRad(numbers(log, 'RATE', f.rateTgt), rateWindow),
      Rate: sliceRad(numbers(log, 'RATE', f.rate), rateWindow),
      AttTgt: sliceRad(numbers(log, attitudeMessage, f.attTgt), attWindow),
      Att: att,
      ...derivedSignals(pilotInput, actInput, att)
    },
    sampleRate,
    airspeed: NO_AIRSPEED_SCALING
  }
}

const FIXED_WING_FIELDS: Readonly<
  Record<FixedWingAxis, { act: string; rateTgt: string; rate: string; attTgt: string; att: string; gyro: string }>
> = {
  Roll: { act: 'Aile', rateTgt: 'rdes', rate: 'Gx', attTgt: 'DRll', att: 'Rll', gyro: 'Gx' },
  Pitch: { act: 'Elev', rateTgt: 'pdes', rate: 'Gy', attTgt: 'DPit', att: 'Pit', gyro: 'Gy' }
}

function fixedWingHistory(log: DataflashLog, axis: FixedWingAxis, startTime: number, endTime: number): TimeHistory {
  const sidpWindow = windowOf(numbers(log, 'SIDP', 'TimeUS'), startTime, endTime)
  const siddTime = numbers(log, 'SIDD', 'TimeUS')
  const siddWindow = windowOf(siddTime, startTime, endTime)
  const sampleRate = averageRate(slice(siddTime, siddWindow))

  const f = FIXED_WING_FIELDS[axis]
  const actInput = sliceRad(numbers(log, 'SIDP', f.act), sidpWindow)
  const att = sliceRad(numbers(log, 'SIDP', f.att), sidpWindow)
  const pilotInput = sliceRad(numbers(log, 'SIDD', 'Targ'), siddWindow)
  return {
    signals: {
      PilotInput: pilotInput,
      ActInput: actInput,
      GyroRaw: sliceRad(numbers(log, 'SIDD', f.gyro), siddWindow),
      RateTgt: sliceRad(numbers(log, 'SIDP', f.rateTgt), sidpWindow),
      Rate: sliceRad(numbers(log, 'SIDD', f.rate), siddWindow),
      AttTgt: sliceRad(numbers(log, 'SIDP', f.attTgt), sidpWindow),
      Att: att,
      ...derivedSignals(pilotInput, actInput, att)
    },
    sampleRate,
    airspeed: {
      aspeed: arrayMean(slice(numbers(log, 'SIDP', 'aspd'), sidpWindow)),
      eas2tas: arrayMean(slice(numbers(log, 'SIDP', 'eastas'), sidpWindow))
    }
  }
}

/**
 * Time histories of the target's axis between `startTime` and `endTime` (s).
 *
 * Deviation: upstream keeps the fixed-wing airspeed scaling in globals, so a multirotor analysed
 * after a fixed-wing log reuses it; here multirotors always use unity scaling.
 */
export function loadTimeHistory(
  log: DataflashLog,
  attitudeMessage: 'ANG' | 'ATT',
  target: TuneTarget,
  startTime: number,
  endTime: number
): TimeHistory {
  return target.vehicle === 'fixed-wing'
    ? fixedWingHistory(log, target.axis, startTime, endTime)
    : multirotorHistory(log, attitudeMessage, target.axis, startTime, endTime)
}
