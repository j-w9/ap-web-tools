/** Reading and writing `.param` files (upstream `loadParamFile` / `saveParamFile`). */
import { paramToString, parseParamFile as parseParamText } from '@apwt/ardupilot'
import { SAVED_PARAM_NAMES, isInputName, type InputName, type SavedParamName } from './params.js'

/** What a parameter file sets. */
export interface ParamFileValues {
  /** Values for the tool's inputs. NaN where the file's value is not a number (upstream empties the input). */
  readonly values: Partial<Record<InputName, number>>
  /** Number of recognised lines. */
  readonly count: number
  /**
   * Upstream applies each line as an input "change" event, and only a change to
   * `MOT_THST_EXPO` keeps the expo fixed; any later recognised line (including
   * `MOT_THST_HOVER`, which a full parameter file lists right after it) triggers a refit.
   * True when the file's last recognised line is `MOT_THST_EXPO`.
   */
  readonly expoFixed: boolean
}

/**
 * Parse a parameter file with the shared reader. Names outside the tool's inputs are ignored;
 * `MOT_THST_HOVER` is recognised (it is an input upstream) but its value is not used, as it is
 * always estimated. A recognised line whose value is missing or not a number sets NaN, as
 * upstream's `parseFloat` empties the input.
 *
 * Deviation: upstream splits on commas only and does not trim, so space, tab or `=` separated
 * and indented lines were ignored; the shared reader accepts them.
 */
export function parseParamFile(text: string): ParamFileValues {
  const parsed = parseParamText(text)
  // Unreadable values still count as a recognised line (and a change event) upstream.
  const lines = [
    ...parsed.entries,
    ...parsed.skipped.filter((s) => s.reason !== 'missing-name').map((s) => ({ name: s.name, value: Number.NaN, line: s.line }))
  ].sort((a, b) => a.line - b.line)
  const values: Partial<Record<InputName, number>> = {}
  let count = 0
  let last: InputName | 'MOT_THST_HOVER' | null = null
  for (const { name, value } of lines) {
    if (name === 'MOT_THST_HOVER') {
      last = name
      count++
    } else if (isInputName(name)) {
      values[name] = value
      last = name
      count++
    }
  }
  return { values, count, expoFixed: last === 'MOT_THST_EXPO' }
}

export interface SavedParams {
  readonly values: Readonly<Record<SavedParamName, number>>
  /** Estimated hover throttle, written last when known. */
  readonly motThstHover: number | null
}

/** Names of saved values that cannot be written (not finite). */
export function invalidSavedParams(params: SavedParams): SavedParamName[] {
  return SAVED_PARAM_NAMES.filter((name) => !Number.isFinite(params.values[name]))
}

/**
 * Text of `ThrustExpo.param`: `NAME,value` lines joined by newlines, no trailing newline.
 *
 * Deviation: upstream writes `MOT_THST_HOVER` once it has ever been estimated, even after the
 * estimate is gone (weight cleared), with the stale value. Here it is written only while
 * there is a current estimate.
 */
export function buildParamFile(params: SavedParams): string {
  const lines = SAVED_PARAM_NAMES.map((name) => `${name},${paramToString(params.values[name])}`)
  if (params.motThstHover !== null) lines.push(`MOT_THST_HOVER,${paramToString(params.motThstHover)}`)
  return lines.join('\n')
}

/** File name upstream saves as. */
export const PARAM_FILE_NAME = 'ThrustExpo.param'
