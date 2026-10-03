/**
 * APJ board id to board name lookup (upstream LogFinder `initial_load()` / `load_board_types()`
 * reading `board_types.txt`).
 *
 * Deviation: upstream fetches `board_types.txt` at page load; here the table is compiled in
 * (`board-types-data.ts`, generated from the upstream file and checked by a test) so the
 * summary extraction stays synchronous and works offline.
 */
import { BOARD_TYPES_DATA } from './board-types-data.js'

/**
 * Parse `board_types.txt` text into id to short name. Later lines win for duplicate ids and the
 * `TARGET_HW_`, `EXT_HW_` and `AP_HW_` prefixes are removed, as upstream.
 */
export function parseBoardTypes(text: string): Map<number, string> {
  const out = new Map<number, string>()
  for (const line of text.match(/[^\r\n]+/g) ?? []) {
    const match = /(^[-\w]+)\s+(\d+)/.exec(line)
    if (match?.[1] === undefined || match[2] === undefined) continue
    const name = match[1]
      .replace(/^TARGET_HW_/, '')
      .replace(/^EXT_HW_/, '')
      .replace(/^AP_HW_/, '')
    out.set(Number(match[2]), name)
  }
  return out
}

/** The compiled-in board table. */
export const BOARD_TYPES: ReadonlyMap<number, string> = new Map(BOARD_TYPES_DATA)

/** Short board name for an APJ board id, or `undefined` if unknown. */
export function boardName(boardId: number): string | undefined {
  return BOARD_TYPES.get(boardId)
}
