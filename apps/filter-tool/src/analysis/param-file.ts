/**
 * Reading and writing ArduPilot `.param` files (upstream `load_parameters` / `save_parameters`),
 * on top of the shared reader and formatter in `@apwt/ardupilot`.
 */
import { paramFileText, parseParamFile as parseParamText } from '@apwt/ardupilot'
import { PARAM_NAMES, isParamName, type Inputs, type ParamName } from './params.js'

export interface ParsedParamFile {
  /** Values of the parameters this tool simulates. */
  readonly values: Partial<Record<ParamName, number>>
  /** How many lines held some other parameter, or a value that is not a finite number. */
  readonly ignored: number
}

/**
 * Parse a `.param` file: one `NAME,value` (or space, tab or `=` separated) per line. QuadPlane
 * `Q_A_RAT_*` gains are read as `ATC_RAT_*`, as upstream does.
 */
export function parseParamFile(text: string): ParsedParamFile {
  const parsed = parseParamText(text)
  const values: Partial<Record<ParamName, number>> = {}
  let ignored = parsed.skipped.filter((s) => s.reason === 'not-a-number').length
  for (const entry of parsed.entries) {
    const name = entry.name.replace('Q_A_RAT_', 'ATC_RAT_')
    if (isParamName(name) && Number.isFinite(entry.value)) values[name] = entry.value
    else ignored++
  }
  return { values, ignored }
}

/**
 * The `.param` text upstream saves: the `INS_*` filter parameters only, so the file can be
 * loaded onto a vehicle without touching its PID gains.
 */
export function formatParamFile(inputs: Inputs): string {
  return paramFileText(new Map(PARAM_NAMES.filter((name) => name.startsWith('INS_')).map((name) => [name, inputs[name]])))
}
