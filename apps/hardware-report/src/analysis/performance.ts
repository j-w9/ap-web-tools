/**
 * CPU load, memory, loop rate and thread stack usage (upstream `load_log()` "Performance"
 * and "STAK" sections).
 */
import type { DataflashLog } from '@apwt/dataflash'
import { fieldSeries, timeSeconds, toFloat64, type Series } from './series.js'

/** PM-derived performance series. */
export interface PerformanceData {
  /** CPU load, percent (`PM.Load / 10`). */
  readonly load: Series
  /** Free memory, bytes (`PM.Mem`). */
  readonly freeMemory: Series
  /** Worst-case loop rate, Hz (`1 / (PM.MaxT * 1e-6)`). */
  readonly worstLoopRate: Series
  /** Average loop rate, Hz (`PM.LR`), when logged. */
  readonly averageLoopRate: Series | undefined
}

/** Performance series, or `undefined` without PM records. */
export function readPerformance(log: DataflashLog): PerformanceData | undefined {
  const time = timeSeconds(log, 'PM')
  const load = log.getNumbers('PM', 'Load')
  const mem = log.getNumbers('PM', 'Mem')
  const maxT = log.getNumbers('PM', 'MaxT')
  if (!time || !load || !mem || !maxT) return undefined
  const rate = new Float64Array(maxT.length)
  for (let i = 0; i < maxT.length; i++) rate[i] = 1 / ((maxT[i] as number) * 1e-6)
  return {
    load: { name: 'Load', time, values: toFloat64(load, 1 / 10) },
    freeMemory: { name: 'Free memory', time, values: toFloat64(mem) },
    worstLoopRate: { name: 'Worst', time, values: rate },
    averageLoopRate: fieldSeries(log, 'Average', 'PM', 'LR')
  }
}

/** Stack usage of one thread. */
export interface ThreadStack {
  /** STAK instance id. */
  readonly id: number
  /** Thread priority (first record). */
  readonly priority: number
  /** Thread name (first record). */
  readonly name: string
  /** Seconds. */
  readonly time: Float64Array
  /** Stack size, bytes. */
  readonly total: Float64Array
  /** Free stack, bytes. */
  readonly free: Float64Array
  /** Used stack, percent of total. */
  readonly usedPercent: Float64Array
}

/** Per-thread stack usage sorted by priority, highest first. */
export function readStacks(log: DataflashLog): ThreadStack[] {
  const out: ThreadStack[] = []
  for (const id of log.instances('STAK')) {
    const time = timeSeconds(log, 'STAK', id)
    const pri = log.getNumbers('STAK', 'Pri', id)
    const names = log.getStrings('STAK', 'Name', id)
    const total = log.getNumbers('STAK', 'Total', id)
    const free = log.getNumbers('STAK', 'Free', id)
    if (!time || !pri || !names || !total || !free) continue
    const usedPercent = new Float64Array(total.length)
    for (let i = 0; i < total.length; i++) {
      usedPercent[i] = (((total[i] as number) - (free[i] as number)) / (total[i] as number)) * 100
    }
    out.push({
      id,
      priority: pri[0] as number,
      name: names[0] as string,
      time,
      total: toFloat64(total),
      free: toFloat64(free),
      usedPercent
    })
  }
  return out.sort((a, b) => b.priority - a.priority)
}
