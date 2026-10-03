/**
 * IOMCU error counters (upstream `load_log()` "IOMCU" section).
 */
import type { DataflashLog } from '@apwt/dataflash'

/** Maximum IOMCU error counters over the log; each is fine when 0. */
export interface IomcuReport {
  /** Status read errors (`RSErr`), when logged. */
  readonly statusReadErrors: number | undefined
  /** Flight controller side errors (`Nerr`). */
  readonly flightControllerErrors: number | undefined
  /** IOMCU side errors (`Nerr2`). */
  readonly iomcuErrors: number | undefined
  /** Delayed packets (`NDel`). */
  readonly delayedPackets: number | undefined
}

function maxOf(log: DataflashLog, field: string): number | undefined {
  const col = log.getNumbers('IOMC', field)
  if (col === undefined) return undefined
  let max = -Infinity
  for (let i = 0; i < col.length; i++) max = Math.max(max, col[i] as number)
  return max
}

/** IOMCU counters, or `undefined` when the log has no IOMC records. */
export function readIomcu(log: DataflashLog): IomcuReport | undefined {
  if (!log.has('IOMC')) return undefined
  return {
    statusReadErrors: maxOf(log, 'RSErr'),
    flightControllerErrors: maxOf(log, 'Nerr'),
    iomcuErrors: maxOf(log, 'Nerr2'),
    delayedPackets: maxOf(log, 'NDel')
  }
}
