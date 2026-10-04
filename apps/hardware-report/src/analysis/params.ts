/**
 * Parameter sources for the report: the PARM records of a log or a `.param` file.
 * Mirrors upstream HardwareReport.js `load_log()` (PARM loop) and `load_param_file()`.
 */
import { US_TO_S, type DataflashLog } from '@apwt/dataflash'

/** Parameter values by name. */
export type ParamValues = ReadonlyMap<string, number>

/** One value a parameter took during the log. */
export interface ParamChange {
  /** Seconds since boot. */
  readonly time: number
  /** Value from this time on. */
  readonly value: number
}

/** A parameter whose value changed while logging, with every value it held. */
export interface ParamHistory {
  /** Parameter name. */
  readonly name: string
  /** Original value first, then each change in log order. */
  readonly changes: readonly ParamChange[]
}

/** Everything the report knows about parameters. */
export interface ParamData {
  /** Final values (last value wins). */
  readonly values: ParamValues
  /** Firmware defaults from the PARM `Default` field (empty for `.param` files and old logs). */
  readonly defaults: ParamValues
  /** Parameters that changed during the log, in order of first change. */
  readonly changes: readonly ParamHistory[]
}

/**
 * Collect parameter values, defaults and in-log changes from PARM records. Returns
 * `undefined` when the log has no PARM records (upstream aborts with "No parameter values
 * found in log").
 */
export function readLogParams(log: DataflashLog): ParamData | undefined {
  const names = log.getStrings('PARM', 'Name')
  const values = log.getNumbers('PARM', 'Value')
  const timeUs = log.getNumbers('PARM', 'TimeUS')
  if (names === undefined || values === undefined || timeUs === undefined) return undefined
  const defaultsCol = log.getNumbers('PARM', 'Default')

  const params = new Map<string, number>()
  const defaults = new Map<string, number>()
  const paramTime = new Map<string, number>()
  const changes = new Map<string, ParamChange[]>()

  for (let i = 0; i < names.length; i++) {
    const name = names[i] as string
    const time = (timeUs[i] as number) * US_TO_S
    const value = values[i] as number
    const previous = params.get(name)
    if (previous !== undefined && previous !== value) {
      let list = changes.get(name)
      if (list === undefined) {
        list = [{ time: paramTime.get(name) as number, value: previous }]
        changes.set(name, list)
      }
      list.push({ time, value })
    }
    params.set(name, value)
    paramTime.set(name, time)
    if (defaultsCol !== undefined) {
      const def = defaultsCol[i] as number
      if (!Number.isNaN(def)) defaults.set(name, def)
    }
  }

  return {
    values: params,
    defaults,
    changes: [...changes].map(([name, list]) => ({ name, changes: list }))
  }
}

/** Whether `key` is an array index, which JavaScript objects enumerate first, in ascending order. */
function isArrayIndex(key: string): boolean {
  return /^(0|[1-9]\d*)$/.test(key) && Number(key) < 2 ** 32 - 1
}

/**
 * Parse a `.param`/`.parm` file as upstream `load_param_file`: every line (split on `\n` only) is
 * split on runs of whitespace, `,` and `=`; a line with at least two fields stores
 * `parseFloat(field 2)` under field 1, later lines winning. A line starting with `#` is skipped, as
 * ArduPilot's `AP_Param::parse_param_line` does (proven upstream bug fixed: upstream stored comments
 * as entries such as `"#"` → `NaN`, see docs/bug-proofs/hardware-report.md). Nothing else is trimmed
 * or skipped: an indented line stores under `""`, and `NAME,` stores `NaN` (upstream behaviour,
 * reproduced). Entries keep the order of upstream's `params` object: integer-like names first in
 * ascending order, then first-seen order.
 */
export function parseParamFile(text: string): ParamData {
  const parsed = new Map<string, number>()
  for (const line of text.split('\n')) {
    if (line.startsWith('#')) continue
    const v = line.split(/[\s,=\t]+/)
    if (v.length >= 2) parsed.set(v[0]!, parseFloat(v[1]!))
  }
  const indexKeys = [...parsed.keys()].filter(isArrayIndex).sort((a, b) => Number(a) - Number(b))
  const values = new Map<string, number>()
  for (const key of indexKeys) values.set(key, parsed.get(key) ?? NaN)
  for (const [key, value] of parsed) if (!isArrayIndex(key)) values.set(key, value)
  return { values, defaults: new Map(), changes: [] }
}

/**
 * In-log changes worth showing: `STAT_` parameters are updated automatically and are
 * hidden, as in upstream `show_param_changes`.
 */
export function interestingParamChanges(changes: readonly ParamHistory[]): readonly ParamHistory[] {
  return changes.filter((c) => !c.name.startsWith('STAT_'))
}

/** Whether a parameter differs from (or has no) firmware default. */
export function isChangedFromDefault(name: string, value: number, defaults: ParamValues): boolean {
  const def = defaults.get(name)
  return def === undefined || value !== def
}
