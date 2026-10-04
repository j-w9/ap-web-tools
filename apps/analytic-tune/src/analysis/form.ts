/**
 * Which inputs the parameter form shows for the current settings. Ported from upstream
 * `update_PID_filters`, `update_hidden` and `update_hidden_mode`.
 */
import {
  controllerParams,
  filterIndex,
  type FilterIndex,
  type InputName,
  type Inputs,
  type NotchPrefix,
  type TuneTarget
} from './params.js'

/** A harmonic notch's other fields are disabled while its `_ENABLE` is not positive. */
export function notchEnabled(inputs: Inputs, prefix: NotchPrefix): boolean {
  return inputs[`${prefix}_ENABLE`] > 0
}

/** Operating-point inputs a tracking mode reads. */
export type TrackingSource = 'throttle' | 'esc' | 'rpm'

const MODE_SOURCES: readonly (readonly [TrackingSource, readonly number[]])[] = [
  ['throttle', [1]],
  ['esc', [3]],
  ['rpm', [2, 5]]
]

/** Operating-point inputs used by an enabled harmonic notch's tracking mode. */
export function trackingSourcesInUse(inputs: Inputs): ReadonlySet<TrackingSource> {
  const used = new Set<TrackingSource>()
  for (const prefix of ['INS_HNTCH', 'INS_HNTC2'] as const) {
    if (!notchEnabled(inputs, prefix)) continue
    const mode = Math.floor(inputs[`${prefix}_MODE`])
    for (const [source, modes] of MODE_SOURCES) if (modes.includes(mode)) used.add(source)
  }
  return used
}

/** The `FILTn_` notches the target's rate controller selects: the target notch, then the error notch if different. */
export function selectedFilters(inputs: Inputs, target: TuneTarget): FilterIndex[] {
  const rate = controllerParams(target).rate
  return selectedFilterIndices(inputs, rate.NTF, rate.NEF)
}

/** The `FILTn_` notches a pair of notch selections names (also used for fixed-wing yaw, which has no target). */
export function selectedFilterIndices(inputs: Inputs, ntfName: InputName, nefName: InputName): FilterIndex[] {
  const ntf = filterIndex(inputs[ntfName])
  const nef = filterIndex(inputs[nefName])
  const out: FilterIndex[] = []
  if (ntf !== null) out.push(ntf)
  if (nef !== null && nef !== ntf) out.push(nef)
  return out
}
