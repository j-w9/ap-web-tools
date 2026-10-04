/**
 * System identification runs: what each `SID_AXIS` value excites, how runs are found in the
 * `SIDD` log, and which rate controller axis a run tunes. Ported from upstream `load_log`,
 * `add_sid_sets` and `set_sid_axis`.
 */
import type { TuneAxis, TuneVehicle } from './params.js'

/**
 * Names of the `SID_AXIS` values (upstream `add_sid_sets`).
 *
 * Proven upstream bug, fixed (docs/bug-proofs/analytic-tune.md, "SID axes 22 and 23"): upstream names
 * and maps 22 as "FW Input Yaw Angle" and 23 as "FW Mixer Roll", but the firmware at the pinned commit
 * defines 22 as FW mixer roll and 23 as FW mixer pitch (`ArduPlane/systemid.h`, `FW_MIX_ROLL = 22`,
 * `FW_MIX_PITCH = 23`). The port uses the firmware's meaning for 22 and 23; 24 to 26, which the
 * firmware does not define, keep upstream's names and axes.
 */
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
  22: 'FW Mixer Roll',
  23: 'FW Mixer Pitch',
  24: 'FW Mixer Pitch',
  25: 'FW Mixer Yaw',
  26: 'FW Mixer Thrust'
}

/** "7: Rate Roll", or just the number for values upstream does not name. */
export function sidAxisLabel(axis: number): string {
  const name = SID_AXIS_NAMES[axis]
  return name === undefined ? String(axis) : `${axis}: ${name}`
}

// Upstream: roll 23, pitch 24, yaw 22 and 25 (proven bug for 22 and 23, see SID_AXIS_NAMES).
const ROLL_AXES: readonly number[] = [1, 4, 7, 10, 20, 22]
const PITCH_AXES: readonly number[] = [2, 5, 8, 11, 21, 23, 24]
const YAW_AXES: readonly number[] = [3, 6, 9, 12, 25]

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
 * Proven upstream bug, fixed (docs/bug-proofs/analytic-tune.md, row 114): upstream's run table
 * (`add_sid_sets`) throws when there are fewer data segments than `SIDS` records (it formats the
 * missing start time), which stops the log load before any parameter is copied. The port lists the
 * records that have data and the load carries on; with as many segments as records nothing changes.
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
  for (let i = 0; i < Math.min(sidsAxis.length, tstart.length); i++) {
    runs.push({ axis: sidsAxis[i]!, startTime: tstart[i]!, endTime: tend[i]! })
  }
  return runs
}

/**
 * Vehicle from the firmware banner: the first `MSG` starting with `ArduPlane` or `ArduCopter`
 * decides. A plane whose first run excites a fixed-wing axis (over 19) is tuned as a fixed wing,
 * otherwise as a quadplane.
 *
 * Upstream keeps `vehicle_type` in a page global that starts as copter and is only changed by a
 * banner, so a log without one keeps the previous log's vehicle: pass it as `previous`.
 */
export function detectTuneVehicle(
  messages: readonly string[],
  firstSidAxis: number | undefined,
  previous: TuneVehicle = 'copter'
): TuneVehicle {
  for (const message of messages) {
    const first = message.split(' ')[0]
    if (first === 'ArduPlane') return firstSidAxis !== undefined && firstSidAxis > 19 ? 'fixed-wing' : 'quadplane'
    if (first === 'ArduCopter') return 'copter'
  }
  return previous
}
