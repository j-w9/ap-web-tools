/**
 * Flight controller clock drift against GPS time (upstream `load_log()` "clock drift").
 */
import { timeUsToSeconds, type DataflashLog } from '@apwt/dataflash'
import type { Series } from './series.js'

/** Drift series per GPS plus the y range upstream applies. */
export interface ClockDrift {
  /** `GPS <n>` drift in ms; NaN where the GPS time is not valid. */
  readonly series: readonly Series[]
  /**
   * Symmetric y-axis limit (ms) equal to 1000 ppm of the analysed time span, set when all drift
   * is below it so expected jitter does not look alarming; `undefined` to autorange.
   */
  readonly yRange: number | undefined
}

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000

/** Clock drift of each GPS instance (the blended instance 2 is skipped), or `undefined`. */
export function readClockDrift(log: DataflashLog): ClockDrift | undefined {
  let startUs: number | undefined
  let endUs: number | undefined
  let maxDrift: number | undefined
  const series: Series[] = []

  for (const inst of log.instances('GPS')) {
    if (inst === 2) continue
    const timeUs = log.getNumbers('GPS', 'TimeUS', inst)
    const status = log.getNumbers('GPS', 'Status', inst)
    const weeks = log.getNumbers('GPS', 'GWk', inst)
    const ms = log.getNumbers('GPS', 'GMS', inst)
    if (!timeUs || !status || !weeks || !ms) continue

    const drift = new Float64Array(timeUs.length).fill(NaN)
    let first: { gpsMs: number; timeUs: number } | undefined
    let haveDrift = false
    for (let i = 0; i < timeUs.length; i++) {
      if ((status[i] as number) < 3) continue
      const w = weeks[i] as number
      const m = ms[i] as number
      if (w <= 1000 || m === 0) continue
      const gpsMs = w * MS_PER_WEEK + m
      const t = timeUs[i] as number
      if (first === undefined) {
        drift[i] = 0
        first = { gpsMs, timeUs: t }
        continue
      }
      drift[i] = gpsMs - first.gpsMs - (t - first.timeUs) * 0.001
      haveDrift = true
      if (startUs === undefined || first.timeUs < startUs) startUs = first.timeUs
      if (endUs === undefined || t > endUs) endUs = t
      const abs = Math.abs(drift[i] as number)
      if (maxDrift === undefined || abs > maxDrift) maxDrift = abs
    }
    if (haveDrift) series.push({ name: `GPS ${inst}`, time: timeUsToSeconds(timeUs), values: drift })
  }

  if (series.length === 0 || startUs === undefined || endUs === undefined || maxDrift === undefined) return undefined
  const minDrift = (endUs - startUs) * 0.001 * 1000 * 1e-6
  return { series, yRange: maxDrift < minDrift ? minDrift : undefined }
}
