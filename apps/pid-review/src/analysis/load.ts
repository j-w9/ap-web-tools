import { getVersionAndBoard } from '@apwt/ardupilot'
import { DataflashLog, type NumericColumn, US_TO_S, type VehicleType } from '@apwt/dataflash'
import { splitIntoBatches } from './batches.js'
import type { FlightData, LoadedLog, PidAxisData, PidBatch } from './data.js'
import { splitParamSets, type ParamSets } from './param-sets.js'
import { pidSpecsForVehicle, type PidMessageSpec } from './vehicle.js'

/** Upstream `load()` alert for a build type other than Rover, Copter or Plane. */
export const UNSUPPORTED_VEHICLE = 'Vehicle Type not supported'
/** Upstream `load()` alert when no controller has usable data. */
export const NO_PID_DATA = 'No PID or RATE log messages found'

/** A log that parsed but cannot be reviewed; carries the message types for the "Open in" menu. */
export class LoadError extends Error {
  constructor(
    message: string,
    readonly messageTypes: readonly string[]
  ) {
    super(message)
    this.name = 'LoadError'
  }
}

/** Copy `[start, end)` of a column into a Float64Array, multiplied by `scale` when given. */
function slice(column: NumericColumn, start: number, end: number, scale?: number): Float64Array {
  const out = new Float64Array(end - start)
  for (let i = 0; i < out.length; i++) out[i] = scale === undefined ? column[start + i]! : column[start + i]! * scale
  return out
}

function series(log: DataflashLog, message: string, field: string): { time: Float64Array; values: Float64Array } | undefined {
  const timeUs = log.getNumbers(message, 'TimeUS')
  const values = log.getNumbers(message, field)
  if (!timeUs || !values) return undefined
  return { time: slice(timeUs, 0, timeUs.length, US_TO_S), values: slice(values, 0, values.length) }
}

/** The `get_version_and_board(log).build_type` values PID Review supports (upstream `load()` switch). */
function vehicleForBuildType(buildType: number | undefined): VehicleType | undefined {
  switch (buildType) {
    case 1:
      return 'rover'
    case 2:
      return 'copter'
    case 3:
      return 'plane'
    default:
      return undefined
  }
}

/**
 * Parse a DataFlash log and extract everything PID Review shows (upstream `load()`). Throws a
 * `LoadError` with upstream's alert text when the vehicle is unsupported or the log has no PID data.
 */
export function loadLog(buffer: ArrayBuffer): LoadedLog {
  const log = DataflashLog.parse(buffer)
  const messageTypes = [...log.messageTypes().keys()]

  // Upstream takes the build type from get_version_and_board: VER.BU, else the boot banner.
  const version = getVersionAndBoard(log)
  const vehicle = vehicleForBuildType(version.buildType)
  const specs = pidSpecsForVehicle(vehicle)
  if (vehicle === undefined || !specs) throw new LoadError(UNSUPPORTED_VEHICLE, messageTypes)

  const parmNames = log.getStrings('PARM', 'Name')
  const parmTime = log.getNumbers('PARM', 'TimeUS')
  const parmValues = log.getNumbers('PARM', 'Value')
  if (!parmNames || !parmTime || !parmValues) throw new LoadError('No PARM messages found', messageTypes)
  const parm = { names: parmNames, timeUs: parmTime, values: parmValues }

  const axes: PidAxisData[] = []
  let startTime: number | undefined
  let endTime: number | undefined

  for (const spec of specs) {
    const paramSets = splitParamSets(parm, spec.prefixes)
    if (!paramSets) continue
    const timeUs = log.getNumbers(spec.source.message, 'TimeUS')
    if (!timeUs || timeUs.length === 0) continue
    const time = slice(timeUs, 0, timeUs.length, US_TO_S)
    // Upstream widens the overall span in split_into_batches, before it knows whether the
    // controller has a usable batch, so controllers without one still count here.
    const first = time[0]!
    const last = time[time.length - 1]!
    if (startTime === undefined || first < startTime) startTime = first
    if (endTime === undefined || last > endTime) endTime = last
    const axis = loadAxis(log, spec, paramSets, time)
    if (axis) axes.push(axis)
  }

  if (axes.length === 0 || startTime === undefined || endTime === undefined) throw new LoadError(NO_PID_DATA, messageTypes)

  const flight: FlightData = {}
  const roll = series(log, 'ATT', 'Roll')
  const pitch = series(log, 'ATT', 'Pitch')
  const throttle = series(log, 'RATE', 'AOut')
  const altitude = series(log, 'POS', 'RelHomeAlt')
  if (roll) flight.roll = roll
  if (pitch) flight.pitch = pitch
  if (throttle) flight.throttle = throttle
  if (altitude) flight.altitude = altitude

  return { axes, flight, startTime, endTime, messageTypes, vehicle, firmware: version.fwString ?? null }
}

function loadAxis(log: DataflashLog, spec: PidMessageSpec, paramSets: ParamSets, time: Float64Array): PidAxisData | null {
  const batches = splitIntoBatches(time, paramSets.sets)
  if (batches.length === 0) return null

  const message = spec.source.message
  const column = (field: string): NumericColumn | undefined => log.getNumbers(message, field)
  const required = (field: string): NumericColumn => {
    const c = column(field)
    if (!c) throw new Error(`${message} message is missing field ${field}`)
    return c
  }

  const sets: (PidBatch[] | null)[] = paramSets.sets.map(() => null)
  const source = spec.source

  for (const b of batches) {
    const take = (c: NumericColumn, scale?: number) => slice(c, b.start, b.end, scale)
    let batch: PidBatch
    if (source.message === 'RATE') {
      const axis = source.axis
      batch = {
        time: time.slice(b.start, b.end),
        sampleRate: b.sampleRate,
        signals: {
          // RATE logs the raw target where PID messages log the filtered one.
          Tar: take(required(`${axis}Des`)),
          Act: take(required(axis)),
          Out: take(required(`${axis}Out`))
        }
      }
    } else {
      const P = take(required('P'))
      const I = take(required('I'))
      const D = take(required('D'))
      const FF = take(required('FF'))
      const dffColumn = column('DFF')
      const DFF = dffColumn ? take(dffColumn) : undefined
      const Out = new Float64Array(P.length)
      for (let i = 0; i < Out.length; i++) Out[i] = P[i]! + I[i]! + D[i]! + FF[i]! + (DFF ? DFF[i]! : 0)
      batch = {
        time: time.slice(b.start, b.end),
        sampleRate: b.sampleRate,
        signals: {
          Tar: take(required('Tar'), spec.unitScale),
          Act: take(required('Act'), spec.unitScale),
          Err: take(required('Err'), spec.unitScale),
          P,
          I,
          D,
          FF,
          ...(DFF ? { DFF } : {}),
          Out
        }
      }
    }
    ;(sets[b.paramSet] ??= []).push(batch)
  }

  return { spec, paramSets, sets, startTime: time[0]!, endTime: time[time.length - 1]! }
}
