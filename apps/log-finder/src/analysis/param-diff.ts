/**
 * Parameter differences between two logs (upstream LogFinder `get_param_diff` and
 * `param_diff_ignore`).
 */

/** A parameter whose value differs between the two logs. */
export interface ParamChange {
  readonly from: number
  readonly to: number
}

/** Differences from an earlier parameter set to a later one. */
export interface ParamDiff {
  /** Only in the later set. */
  readonly added: ReadonlyMap<string, number>
  /** Only in the earlier set. */
  readonly missing: ReadonlyMap<string, number>
  /** In both with different values (unless ignored). */
  readonly changed: ReadonlyMap<string, ParamChange>
}

interface ParamIgnoreRule {
  readonly key: string
  readonly label: string
  readonly matches: (name: string) => boolean
}

const STREAM_RATE_GROUPS = [
  'RAW_SENS',
  'EXT_STAT',
  'RC_CHAN',
  'RAW_CTRL',
  'POSITION',
  'EXTRA1',
  'EXTRA2',
  'EXTRA3',
  'PARAMS',
  'ADSB'
] as const

/**
 * Parameters that are expected to change on every boot and can be left out of a comparison.
 * The patterns are upstream's, unanchored as upstream (including its `(:?` groups).
 */
export const PARAM_IGNORE_RULES = [
  { key: 'stats', label: 'Statistics (STAT_)', matches: (name) => name.startsWith('STAT_') || name === 'SYS_NUM_RESETS' },
  { key: 'gyroOffsets', label: 'Gyro offsets', matches: (name) => /(:?(INS)[45]?_(GYR)[23]?(OFFS_)[XYZ])/m.test(name) },
  { key: 'gyroCalTemp', label: 'Gyro cal temperature', matches: (name) => /(:?(INS)[45]?(_GYR)[123]?(_CALTEMP))/m.test(name) },
  { key: 'baroGround', label: 'Baro ground pressure', matches: (name) => /(:?(BARO)[123]?(_GND_PRESS))/m.test(name) },
  { key: 'compassDec', label: 'Compass declination', matches: (name) => name === 'COMPASS_DEC' },
  { key: 'airspeedOffset', label: 'Airspeed offset', matches: (name) => /(:?(ARSPD)[123]?(_OFFSET))/m.test(name) },
  {
    key: 'streamRates',
    label: 'Stream rates',
    matches: (name) => STREAM_RATE_GROUPS.some((g) => new RegExp(`(:?(SR|MAV)\\d{1,2}_(${g}))`, 'm').test(name))
  }
] as const satisfies readonly ParamIgnoreRule[]

/** Key of one ignore rule. */
export type ParamIgnoreKey = (typeof PARAM_IGNORE_RULES)[number]['key']

/** Every ignore rule key; upstream ticks all of them by default. */
export const ALL_PARAM_IGNORE_KEYS: readonly ParamIgnoreKey[] = PARAM_IGNORE_RULES.map((r) => r.key)

/** Whether a change to `name` is hidden by one of the `ignored` rules. */
export function isIgnoredChange(name: string, ignored: ReadonlySet<ParamIgnoreKey>): boolean {
  return PARAM_IGNORE_RULES.some((rule) => ignored.has(rule.key) && rule.matches(name))
}

/**
 * Differences from `previous` to `current`. Additions and removals are always reported; value
 * changes are dropped when an `ignored` rule matches the name.
 */
export function paramDiff(
  current: ReadonlyMap<string, number>,
  previous: ReadonlyMap<string, number>,
  ignored: ReadonlySet<ParamIgnoreKey>
): ParamDiff {
  const added = new Map<string, number>()
  const missing = new Map<string, number>()
  const changed = new Map<string, ParamChange>()
  for (const name of new Set([...previous.keys(), ...current.keys()])) {
    const to = current.get(name)
    const from = previous.get(name)
    if (to !== undefined && from === undefined) added.set(name, to)
    else if (to === undefined && from !== undefined) missing.set(name, from)
    else if (to !== undefined && from !== undefined && to !== from && !isIgnoredChange(name, ignored)) {
      changed.set(name, { from, to })
    }
  }
  return { added, missing, changed }
}

/** Number of differences in a diff (upstream count shown in the "Param Changes" column). */
export function paramDiffCount(diff: ParamDiff): number {
  return diff.added.size + diff.missing.size + diff.changed.size
}
