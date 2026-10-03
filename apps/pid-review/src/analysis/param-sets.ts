import { PID_PARAM_KEYS, pidParamName, type PidParamKey } from './vehicle.js'

/** PARM message columns needed to track parameter changes through a log. */
export interface ParmColumns {
  names: ArrayLike<string>
  /** Microseconds. */
  timeUs: ArrayLike<number>
  values: ArrayLike<number>
}

/** The PID parameter values in force over one span of the log. */
export interface ParamSet {
  /** Seconds. */
  startTime: number
  /** Seconds; `Infinity` for the final set. */
  endTime: number
  values: Readonly<Record<PidParamKey, number | null>>
}

export interface ParamSets {
  /** The prefix that matched, e.g. `ATC_RAT_RLL_`. */
  prefix: string
  sets: readonly ParamSet[]
}

const US_TO_S = 1e-6

/**
 * Walk PARM messages and split the log into spans of constant PID parameters.
 * A new set starts at the first change after at least a second of stability; changes
 * within a second of each other are merged into the newest set (leaving a gap).
 * Tries each prefix in order and returns the first with any matching parameter.
 */
export function splitParamSets(parm: ParmColumns, prefixes: readonly string[]): ParamSets | null {
  for (const prefix of prefixes) {
    const nameToKey = new Map<string, PidParamKey>(PID_PARAM_KEYS.map((key) => [pidParamName(prefix, key), key]))

    const current: Record<PidParamKey, number | null> = Object.fromEntries(
      PID_PARAM_KEYS.map((k) => [k, null])
    ) as Record<PidParamKey, number | null>
    let startTime = 0
    let found = false
    let lastSetEnd: number | undefined
    const sets: ParamSet[] = []

    for (let j = 0; j < parm.names.length; j++) {
      const key = nameToKey.get(parm.names[j] as string)
      if (key === undefined) continue
      const time = (parm.timeUs[j] as number) * US_TO_S
      const value = parm.values[j] as number
      found = true
      const previous = current[key]
      if (previous != null && previous !== value) {
        if (lastSetEnd === undefined || time - lastSetEnd > 1.0) {
          lastSetEnd = time
          sets.push({ startTime, endTime: lastSetEnd, values: { ...current } })
          startTime = time
        } else {
          startTime = time
        }
      }
      current[key] = value
    }

    if (found) {
      sets.push({ startTime, endTime: Infinity, values: { ...current } })
      return { prefix, sets }
    }
  }
  return null
}
