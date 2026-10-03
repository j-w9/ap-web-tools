/**
 * APJ board id → board name lookup (upstream HardwareReport `initial_load()` /
 * `load_board_types()` reading `board_types.txt`).
 *
 * Deviation: upstream fetches `board_types.txt` at page load; here the table is compiled in
 * (`board-types-data.ts`, generated from upstream `board_types.txt`, checked by a test) so the
 * analysis stays synchronous and offline.
 */
import { BOARD_TYPES_DATA } from './board-types-data.js'

/**
 * Parse `board_types.txt` text into id → short name. Later lines win for duplicate ids and
 * the `TARGET_HW_`, `EXT_HW_` and `AP_HW_` prefixes are removed, as upstream.
 */
export function parseBoardTypes(text: string): Map<number, string> {
  const out = new Map<number, string>()
  for (const line of text.match(/[^\r\n]+/g) ?? []) {
    const match = line.match(/(^[-\w]+)\s+(\d+)/)
    if (match === null) continue
    const name = (match[1] as string)
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
