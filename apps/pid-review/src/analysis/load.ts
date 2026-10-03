import { DataflashLog, type NumericColumn } from '@apwt/dataflash'
import { splitIntoBatches } from './batches.js'
import type { FlightData, LoadedLog, PidAxisData, PidBatch } from './data.js'
import { splitParamSets, type ParamSets } from './param-sets.js'
import { pidSpecsForVehicle, type PidMessageSpec } from './vehicle.js'

const US_TO_S = 1e-6

/** Copy `[start, end]` (inclusive) of a column into a scaled Float64Array. */
function slice(column: NumericColumn, start: number, end: number, scale = 1): Float64Array {
  const out = new Float64Array(end - start + 1)
  for (let i = 0; i < out.length; i++) out[i] = (column[start + i] as number) * scale
  return out
}

function secondsColumn(log: DataflashLog, message: string): { time: Float64Array; values: Float64Array } | undefined {
  const timeUs = log.getNumbers(message, 'TimeUS')
  if (!timeUs) return undefined
  return { time: slice(timeUs, 0, timeUs.length - 1, US_TO_S), values: new Float64Array(0) }
}

function series(log: DataflashLog, message: string, field: string): { time: Float64Array; values: Float64Array } | undefined {
  const base = secondsColumn(log, message)
  const values = log.getNumbers(message, field)
  if (!base || !values) return undefined
  return { time: base.time, values: slice(values, 0, values.length - 1) }
}

/**
 * Parse a DataFlash log and extract everything PID Review shows. Throws an `Error` with a
 * user-facing message when the vehicle is unsupported or the log has no PID data.
 */
export function loadLog(buffer: ArrayBuffer): LoadedLog {
  const log = DataflashLog.parse(buffer)

  const specs = pidSpecsForVehicle(log.vehicleType())
  if (!specs) throw new Error('Vehicle Type not supported')

  const parmNames = log.getStrings('PARM', 'Name')
  const parmTime = log.getNumbers('PARM', 'TimeUS')
  const parmValues = log.getNumbers('PARM', 'Value')
  if (!parmNames || !parmTime || !parmValues) throw new Error('No PARM messages found')
  const parm = { names: parmNames, timeUs: parmTime, values: parmValues }

  const axes: PidAxisData[] = []
  let startTime = Infinity
  let endTime = -Infinity

  for (const spec of specs) {
    const paramSets = splitParamSets(parm, spec.prefixes)
    if (!paramSets) continue
    const axis = loadAxis(log, spec, paramSets)
    if (!axis) continue
    axes.push(axis)
    startTime = Math.min(startTime, axis.startTime)
    endTime = Math.max(endTime, axis.endTime)
  }

  if (axes.length === 0) throw new Error('No PID or RATE log messages found')

  const flight: FlightData = {}
  const roll = series(log, 'ATT', 'Roll')
  const pitch = series(log, 'ATT', 'Pitch')
  const throttle = series(log, 'RATE', 'AOut')
  const altitude = series(log, 'POS', 'RelHomeAlt')
  if (roll) flight.roll = roll
  if (pitch) flight.pitch = pitch
  if (throttle) flight.throttle = throttle
  if (altitude) flight.altitude = altitude

  return { axes, flight, startTime, endTime, messageTypes: [...log.messageTypes().keys()] }
}

function loadAxis(log: DataflashLog, spec: PidMessageSpec, paramSets: ParamSets): PidAxisData | null {
  const message = spec.id[0]
  const timeUs = log.getNumbers(message, 'TimeUS')
  if (!timeUs || timeUs.length === 0) return null
  const time = slice(timeUs, 0, timeUs.length - 1, US_TO_S)

  const batches = splitIntoBatches(time, paramSets.sets)
  if (batches.length === 0) return null

  const column = (field: string): NumericColumn | undefined => log.getNumbers(message, field)
  const required = (field: string): NumericColumn => {
    const c = column(field)
    if (!c) throw new Error(`${message} message is missing field ${field}`)
    return c
  }

  const sets: (PidBatch[] | null)[] = paramSets.sets.map(() => null)
  const isRate = message === 'RATE'

  for (const b of batches) {
    const take = (c: NumericColumn, scale = 1) => slice(c, b.start, b.end, scale)
    let batch: PidBatch
    if (isRate) {
      const axis = spec.id[1] as string
      batch = {
        time: take(timeUs, US_TO_S),
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
      for (let i = 0; i < Out.length; i++) {
        Out[i] = (P[i] as number) + (I[i] as number) + (D[i] as number) + (FF[i] as number) + (DFF ? (DFF[i] as number) : 0)
      }
      batch = {
        time: take(timeUs, US_TO_S),
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

  return {
    spec,
    paramSets,
    sets,
    startTime: time[0] as number,
    endTime: time[time.length - 1] as number
  }
}
