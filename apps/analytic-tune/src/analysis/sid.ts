/**
 * System identification runs: what each `SID_AXIS` value excites, how runs are found in the
 * `SIDD` log, and which rate controller axis a run tunes. Ported from upstream `load_log`,
 * `add_sid_sets` and `set_sid_axis`.
 */
import type { TuneAxis, TuneVehicle } from './params.js'

/** Names of the `SID_AXIS` values (upstream `add_sid_sets`). */
export const SID_AXIS_NAMES: Readonly<Record<number, string>> = {
  1: 'Input Roll Angle',
  2: 'Input Pitch Angle',
  3: 'Input Yaw Angle',
  4: 'Recovery Roll Angle',
  5: 'Recovery Pitch Angle',
  6: 'Recovery Yaw Angle',
  7: 'Rate Roll',
  8: 'Rate Pitch',
  9: 'Rate Yaw',
  10: 'Mixer Roll',
  11: 'Mixer Pitch',
  12: 'Mixer Yaw',
  13: 'Mixer Thrust',
  14: 'Measured Lateral Position',
  15: 'Measured Longitudinal Position',
  16: 'Measured Lateral Velocity',
  17: 'Measured Longitudinal Velocity',
  18: 'Input Lateral Velocity',
  19: 'Input Longitudinal Velocity',
  20: 'FW Input Roll Angle',
  21: 'FW Input Pitch Angle',
  22: 'FW Input Yaw Angle',
  23: 'FW Mixer Roll',
  24: 'FW Mixer Pitch',
  25: 'FW Mixer Yaw',
  26: 'FW Mixer Thrust'
}

/** "7: Rate Roll", or just the number for values upstream does not name. */
export function sidAxisLabel(axis: number): string {
  const name = SID_AXIS_NAMES[axis]
  return name === undefined ? String(axis) : `${axis}: ${name}`
}

const ROLL_AXES: readonly number[] = [1, 4, 7, 10, 20, 23]
const PITCH_AXES: readonly number[] = [2, 5, 8, 11, 21, 24]
const YAW_AXES: readonly number[] = [3, 6, 9, 12, 22, 25]

/** The rate controller axis a run tunes, or null for runs that excite no single axis (upstream `set_sid_axis`). */
export function tuneAxisForSid(axis: number): TuneAxis | null {
  if (ROLL_AXES.includes(axis)) return 'Roll'
  if (PITCH_AXES.includes(axis)) return 'Pitch'
  if (YAW_AXES.includes(axis)) return 'Yaw'
  return null
}

/** One system identification run. */
export interface SidRun {
  /** `SID_AXIS` of the run. */
  readonly axis: number
  /** Start and end of the run's data (s). */
  readonly startTime: number
  readonly endTime: number
}

/**
 * Split `SIDD` timestamps into runs at gaps over 0.5 s, limiting each run to its `SIDS` record's
 * chirp length plus one second. Runs are paired with `SIDS` records in order; as upstream, only
 * as many runs as there are `SIDS` records are listed.
 *
 * Deviation: upstream fails when there are fewer data segments than `SIDS` records; those
 * records are dropped here.
 */
export function findSidRuns(siddTime: ArrayLike<number>, sidsAxis: ArrayLike<number>, sidsLength: ArrayLike<number>): SidRun[] {
  if (siddTime.length === 0) return []
  const tstart: number[] = []
  const tend: number[] = []
  // A missing SIDS length reads as undefined upstream, so no clamp applies.
  const clamp = (j: number): void => {
    const length = j < sidsLength.length ? sidsLength[j]! : NaN
    if (tend[j]! - tstart[j]! > length + 1.0) tend[j] = tstart[j]! + length + 1.0
  }
  let j = 0
  tstart[j] = siddTime[0]!
  for (let k = 1; k < siddTime.length; k++) {
    if (siddTime[k]! - siddTime[k - 1]! > 0.5) {
      tend[j] = siddTime[k - 1]!
      clamp(j)
      j++
      tstart[j] = siddTime[k]!
    }
  }
  tend[j] = siddTime[siddTime.length - 1]!
  clamp(j)

  const runs: SidRun[] = []
  for (let i = 0; i < sidsAxis.length && i < tstart.length; i++) {
    runs.push({ axis: sidsAxis[i]!, startTime: tstart[i]!, endTime: tend[i]! })
  }
  return runs
}

/**
 * Vehicle from the firmware banner: the first `MSG` starting with `ArduPlane` or `ArduCopter`
 * decides. A plane whose first run excites a fixed-wing axis (over 19) is tuned as a fixed wing,
 * otherwise as a quadplane. Copter is the default.
 */
export function detectTuneVehicle(messages: readonly string[], firstSidAxis: number | undefined): TuneVehicle {
  for (const message of messages) {
    const first = message.split(' ')[0]
    if (first === 'ArduPlane') return firstSidAxis !== undefined && firstSidAxis > 19 ? 'fixed-wing' : 'quadplane'
    if (first === 'ArduCopter') return 'copter'
  }
  return 'copter'
}
