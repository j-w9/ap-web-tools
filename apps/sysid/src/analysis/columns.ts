/**
 * Reading log columns the way upstream SysID does, through JsDataflashParser's
 * `log.get(name, field)`. That lookup matches the FMT name exactly, so it returns nothing for
 * instanced messages by their base name, for types with a format but no records, and for unknown
 * fields. SysID then crashes on the missing array; here that becomes a {@link MissingDataError}.
 *
 * Proven upstream bug fixed (docs/bug-proofs/sysid.md, row 8): upstream's pickers offer the
 * `NAME[n]` instance entries but `log.get('NAME[n]', ...)` returns nothing, so Submit crashed. The
 * port reads instance n of NAME, as the parser's own `get_instance(NAME, n, field)` does.
 */
import type { DataflashLog, NumericColumn } from '@apwt/dataflash'

/** Upstream would throw on this data and produce no result; the port reports why instead. */
export class MissingDataError extends Error {
  override readonly name = 'MissingDataError'
}

/** The numbers upstream's `log.get(message, field)` returns, or `undefined` where it returns nothing usable. */
export function upstreamColumn(log: DataflashLog, message: string, field: string): NumericColumn | undefined {
  const instanced = /^(.+)\[(\d+)\]$/.exec(message)
  if (instanced) {
    const [, base = '', instance = ''] = instanced
    const n = Number(instance)
    return log.messageType(base)?.instances?.has(n) ? log.getNumbers(base, field, n) : undefined
  }
  const info = log.messageType(message)
  // No records (or no such format), or an instanced message: upstream has no flat offsets for it.
  if (info === undefined || info.instances !== undefined) return undefined
  return log.getNumbers(message, field)
}

/** {@link upstreamColumn}, failing where upstream would crash. */
export function requireColumn(log: DataflashLog, message: string, field: string): NumericColumn {
  const column = upstreamColumn(log, message, field)
  if (column === undefined) {
    throw new MissingDataError(
      message === '' || message === 'None'
        ? 'Choose a message and field for every input and output.'
        : `${message}.${field} has no data SysID can read. Text fields cannot be used.`
    )
  }
  return column
}

/**
 * Index of the value closest to `target`; the first one wins ties. A NaN target gives 0, as
 * upstream's `nearestIndex` does (every comparison with NaN is false).
 */
export function nearestIndex(values: ArrayLike<number>, target: number): number {
  let minDist: number | null = null
  let minIndex = 0
  for (let i = 0; i < values.length; i++) {
    const dist = Math.abs(values[i]! - target)
    if (minDist === null || dist < minDist) {
      minDist = dist
      minIndex = i
    }
  }
  return minIndex
}
