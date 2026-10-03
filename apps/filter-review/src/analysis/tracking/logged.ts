import type { DataflashLog } from '@apwt/dataflash'
import { isInstanced, readField, readSeconds } from './read-series.js'
import { NotchTarget, single, type FrequencySeries, type TargetFrequency } from './target.js'

/** Frequencies the firmware logged for one harmonic notch, read from `FTNS` or `FTN`. */
function readLogged(log: DataflashLog, instance: number): TargetFrequency | undefined {
  // Load single notch message
  const staticMsg = 'FTNS'
  if (log.has(staticMsg) && isInstanced(log, staticMsg) && log.instances(staticMsg).includes(instance)) {
    const time = readSeconds(log, staticMsg, instance)
    const freq = readField(log, staticMsg, 'NF', instance)
    // If we have a single instance there should not be a dynamic for this instance
    return time === undefined || freq === undefined ? undefined : single(time, freq)
  }

  // Load multi notch message
  const dynamicMsg = 'FTN'
  if (log.has(dynamicMsg) && isInstanced(log, dynamicMsg) && log.instances(dynamicMsg).includes(instance)) {
    const notchNumber = log.getNumbers(dynamicMsg, 'NDn', instance)
    const time = readSeconds(log, dynamicMsg, instance)
    if (notchNumber === undefined || time === undefined) return undefined
    let numNotches = 0
    for (let i = 0; i < notchNumber.length; i++) numNotches = Math.max(numNotches, notchNumber[i]!)

    const series: FrequencySeries[] = []
    for (let i = 0; i < numNotches; i++) {
      // Upstream leaves a hole for a missing NFn field (which later breaks its plot data); skip it.
      const freq = readField(log, dynamicMsg, `NF${i + 1}`, instance)
      if (freq !== undefined) series.push({ time, freq })
    }
    return { multi: true, series }
  }
  return undefined
}

/** Notch frequencies logged by the firmware, for comparison (upstream `LoggedNotch`, `tracking/Logged.js`). */
export class LoggedNotch extends NotchTarget {
  /** Harmonic bitmask to plot, copied from the notch's logged `_HMNCS` after loading. */
  harmonics: number | null = null
  private readonly data: TargetFrequency | undefined

  /** @param instance Harmonic notch index (0 or 1). */
  constructor(log: DataflashLog, instance: number) {
    super('Logged', null)
    this.data = readLogged(log, instance)
  }

  override haveData(): boolean {
    return this.data !== undefined
  }

  /** The logged fundamental frequencies (independent of the notch configuration). */
  override targetFrequency(): TargetFrequency | undefined {
    return this.data
  }

  /** Logged notches are only plotted, never simulated. */
  override interpolate(): undefined {
    return undefined
  }
}
