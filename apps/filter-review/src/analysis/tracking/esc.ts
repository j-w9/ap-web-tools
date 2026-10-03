import type { DataflashLog } from '@apwt/dataflash'
import { arrayScale, linearInterp } from '@apwt/signal'
import type { NotchParams } from '../filter-params.js'
import type { FilterVersion } from '../filter-version.js'
import type { TimeRange } from '../time-index.js'
import { isInstanced, readSeconds } from './read-series.js'
import {
  NotchTarget,
  isMultiSource,
  mapValues,
  meanOverRange,
  single,
  type FrequencySeries,
  type InterpolatedTarget,
  type TargetFrequency,
  type TrackingContext
} from './target.js'

/** `INS_HNTCH_MODE` value tracking ESC telemetry RPM. */
export const ESC_MODE = 3

/**
 * Average the motors' frequencies whenever every motor seen so far has reported a fresh value.
 *
 * Upstream also tries to time out stale instances, but that check reads `inst[j].time`, which
 * is never assigned (only `time_ms` is), so it never fires; it is omitted here with identical
 * results.
 */
function averageFrequency(motors: readonly FrequencySeries[]): FrequencySeries {
  const all: { time: number; freq: number; inst: number }[] = []
  motors.forEach((m, i) => {
    for (let j = 0; j < m.time.length; j++) all.push({ time: m.time[j]!, freq: m.freq[j]!, inst: i })
  })
  // Stable sort by time, as upstream
  all.sort((a, b) => a.time - b.time)

  const freq: (number | null)[] = motors.map(() => null)
  const seen: boolean[] = motors.map(() => false)
  const avgFreq: number[] = []
  const avgTime: number[] = []
  for (const sample of all) {
    freq[sample.inst] = sample.freq
    seen[sample.inst] = true

    let expectedCount = 0
    let count = 0
    let sum = 0
    for (let j = 0; j < motors.length; j++) {
      const f = freq[j]
      if (f !== null && f !== undefined) {
        count++
        sum += f
      }
      if (seen[j] === true) expectedCount++
    }
    if (count > 0 && count === expectedCount) {
      avgFreq.push(sum / count)
      avgTime.push(sample.time)
      freq.fill(null)
    }
  }
  return { time: Float64Array.from(avgTime), freq: Float64Array.from(avgFreq) }
}

/** ESC telemetry tracking (upstream `ESCTarget`, `tracking/ESC.js`). */
export class EscTarget extends NotchTarget {
  /** Per-ESC rotation frequency (Hz), one entry per logged ESC instance. */
  readonly motors: readonly FrequencySeries[]
  /** Average rotation frequency of all motors. */
  readonly average: FrequencySeries | undefined

  constructor(log: DataflashLog) {
    super('ESC', ESC_MODE)
    const msg = 'ESC'
    const motors: FrequencySeries[] = []
    if (log.has(msg) && isInstanced(log, msg)) {
      for (const inst of log.instances(msg)) {
        const time = readSeconds(log, msg, inst)
        const rpm = log.getNumbers(msg, 'RPM', inst)
        if (time === undefined || rpm === undefined) continue
        motors.push({ time, freq: arrayScale(rpm, 1 / 60) })
      }
    }
    this.motors = motors
    this.average = motors.length > 0 ? averageFrequency(motors) : undefined
  }

  /** Number of ESC instances (upstream `get_num_motors`), `undefined` without data. */
  get numMotors(): number | undefined {
    return this.average === undefined ? undefined : this.motors.length
  }

  /** Notch frequency for one motor frequency. */
  target(config: NotchParams, freq: number, filterVersion: FilterVersion): number {
    if (config.ref === 0) return config.freq
    if (filterVersion >= 2) return Math.abs(freq)
    return Math.max(freq, config.freq)
  }

  override haveData(): boolean {
    return this.average !== undefined
  }

  override targetFrequency(config: NotchParams, context: TrackingContext): TargetFrequency | undefined {
    const average = this.average
    if (average === undefined) return undefined
    const map = (f: number): number => this.target(config, f, context.filterVersion)
    if (isMultiSource(config)) {
      // Tracking individual motor RPM's
      return { multi: true, series: this.motors.map((m) => ({ time: m.time, freq: mapValues(m.freq, map) })) }
    }
    // Tracking average motor rpm
    return single(average.time, mapValues(average.freq, map))
  }

  override interpolate(time: ArrayLike<number>): InterpolatedTarget | undefined {
    const average = this.average
    if (average === undefined) return undefined
    const perMotor = this.motors.map((m) => linearInterp(m.freq, m.time, time))
    const avg = linearInterp(average.freq, average.time, time)
    return {
      frequencies: (index, config, version) => {
        if (perMotor.length === 0) return null
        if (isMultiSource(config)) return perMotor.map((m) => this.target(config, m[index]!, version))
        return [this.target(config, avg[index]!, version)]
      }
    }
  }

  /** Mean motor RPM over `range` (upstream converts the mean frequency back to RPM). */
  override mean(range: TimeRange): number | undefined {
    if (this.average === undefined) return undefined
    return meanOverRange(this.average.time, this.average.freq, range) * 60
  }
}
