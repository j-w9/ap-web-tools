/**
 * Frequency responses of filter chains as Bode data, ported from upstream
 * `evaluate_transfer_functions`, `unwrap`, `calculate_filter` and `calculate_pid`.
 */
import { arrayFromRange, arrayLog10, arrayScale, complexAbs, complexMul, complexPhase, type ComplexArray } from '@apwt/signal'
import { NOTCH_PREFIXES, type Inputs, type NotchPrefix, type PidAxis } from './params.js'
import { notchConfig, operatingPoint, pidGains } from './config.js'
import {
  designHarmonicNotch,
  designLowPass,
  designPid,
  gyroFilterResponse,
  isFilterEnabled,
  pidResponse,
  unityResponse,
  zGrid,
  type GyroFilter,
  type HarmonicNotchFilter,
  type LowPassFilter,
  type PidController
} from './filters.js'

export type MagnitudeScale = 'dB' | 'linear'
export type PhaseScale = 'unwrapped' | 'wrapped'

export interface BodeScale {
  readonly magnitude: MagnitudeScale
  readonly phase: PhaseScale
}

/** Magnitude (linear or dB) and phase (degrees) of one response. */
export interface Bode {
  readonly magnitude: Float64Array
  readonly phase: Float64Array
}

/**
 * Unwrap phase (degrees) by looking for jumps larger than a threshold. Notches produce large
 * positive phase steps, so the thresholds are biased (upstream `unwrap`).
 */
export function unwrapPhase(phase: ArrayLike<number>): Float64Array {
  const len = phase.length
  const negThreshold = 45
  const posThreshold = 360 - negThreshold
  const unwrapped = new Float64Array(len)
  if (len === 0) return unwrapped
  unwrapped[0] = phase[0]!
  for (let i = 1; i < len; i++) {
    let diff = phase[i]! - phase[i - 1]!
    if (diff > posThreshold) {
      diff -= 360.0
    } else if (diff < -negThreshold) {
      diff += 360.0
    }
    unwrapped[i] = unwrapped[i - 1]! + diff
  }
  return unwrapped
}

/** Bode data of a complex response. */
export function toBode(h: ComplexArray, scale: BodeScale): Bode {
  const abs = complexAbs(h)
  const phase = arrayScale(complexPhase(h), 180 / Math.PI)
  return {
    magnitude: scale.magnitude === 'dB' ? arrayScale(arrayLog10(abs), 20.0) : abs,
    phase: scale.phase === 'unwrapped' ? unwrapPhase(phase) : phase
  }
}

/** Frequencies `step, 2 step, ...` up to `max` (Hz), as upstream. */
export function frequencyGrid(maxHz: number, stepHz: number): Float64Array {
  return arrayFromRange(stepHz, maxHz, stepHz)
}

/** Product of every filter's response; each group has its own sample rate. */
export function chainResponse(freq: Float64Array, groups: readonly (readonly ResponseSource[])[]): ComplexArray {
  let total = unityResponse(freq.length)
  for (const group of groups) {
    const first = group[0]
    if (first === undefined) continue
    const grid = zGrid(freq, first.sampleRate)
    for (const source of group) total = complexMul(total, source.response(grid))
  }
  return total
}

/** Anything with a sample rate and a transfer function. */
interface ResponseSource {
  readonly sampleRate: number
  response(grid: ReturnType<typeof zGrid>): ComplexArray
}

const gyroSource = (filter: GyroFilter): ResponseSource => ({
  sampleRate: filter.sampleRate,
  response: (grid) => gyroFilterResponse(filter, grid)
})

// ---------- Gyro filters ----------

/** The gyro filter chain in upstream order: notch 1, notch 2, low-pass. */
export interface GyroFilters {
  readonly notches: Readonly<Record<NotchPrefix, HarmonicNotchFilter>>
  readonly lowPass: LowPassFilter
}

export function gyroFilters(inputs: Inputs, sampleRate: number): GyroFilters {
  const op = operatingPoint(inputs)
  const notch = (prefix: NotchPrefix) => designHarmonicNotch(sampleRate, notchConfig(inputs, prefix), op)
  return {
    notches: { INS_HNTCH: notch('INS_HNTCH'), INS_HNTC2: notch('INS_HNTC2') },
    lowPass: designLowPass(sampleRate, inputs.INS_GYRO_FILTER)
  }
}

export function gyroFilterList(filters: GyroFilters): GyroFilter[] {
  return [...NOTCH_PREFIXES.map((p) => filters.notches[p]), filters.lowPass]
}

/** Which gyro filter a component trace is. */
export type GyroComponentKey = NotchPrefix | 'lowPass'

export interface GyroComponent {
  readonly key: GyroComponentKey
  readonly filter: GyroFilter
  readonly enabled: boolean
  readonly bode: Bode
}

export interface GyroBode {
  readonly freq: Float64Array
  readonly total: Bode
  readonly components: readonly GyroComponent[]
  /** Number of enabled filters; upstream only shows components when more than one is. */
  readonly enabledCount: number
}

/** Upstream's resolution for the filter plot (Hz). */
export const GYRO_FREQ_STEP = 0.1

/** Bode of the gyro filters from 0.1 Hz to Nyquist (upstream `calculate_filter`). */
export function gyroBode(inputs: Inputs, scale: BodeScale): GyroBode {
  const sampleRate = inputs.GyroSampleRate
  const freq = frequencyGrid(sampleRate * 0.5, GYRO_FREQ_STEP)
  const filters = gyroFilters(inputs, sampleRate)
  const list = gyroFilterList(filters)
  const keys: readonly GyroComponentKey[] = [...NOTCH_PREFIXES, 'lowPass']

  const grid = zGrid(freq, sampleRate)
  let total = unityResponse(freq.length)
  const components = list.map((filter, i): GyroComponent => {
    const h = gyroFilterResponse(filter, grid)
    total = complexMul(total, h)
    return { key: keys[i]!, filter, enabled: isFilterEnabled(filter), bode: toBode(h, scale) }
  })
  return {
    freq,
    total: toBode(total, scale),
    components,
    enabledCount: components.filter((c) => c.enabled).length
  }
}

// ---------- Rate PID ----------

/** Where the gyro filters sit relative to the PID in the plot: left out, or included. */
export type PidFiltering = 'pre' | 'post'

export interface PidBode {
  readonly freq: Float64Array
  readonly pid: PidController
  readonly total: Bode
  readonly p: Bode
  readonly i: Bode
  readonly d: Bode
  /** The gyro filters on their own, present with `post` filtering. */
  readonly gyro: Bode | null
}

/** Upstream's resolution for the PID plot (Hz). */
export const PID_FREQ_STEP = 0.05

/**
 * Bode of one axis' rate PID from 0.05 Hz to half the loop rate (upstream `calculate_pid`).
 * With `post` filtering, the gyro filters (at the gyro rate) are included in the total.
 */
export function pidBode(inputs: Inputs, axis: PidAxis, filtering: PidFiltering, scale: BodeScale): PidBode {
  const loopRate = inputs.SCHED_LOOP_RATE
  const freq = frequencyGrid(loopRate * 0.5, PID_FREQ_STEP)
  const pid = designPid(loopRate, pidGains(inputs, axis))
  const terms = pidResponse(pid, zGrid(freq, loopRate))

  const pidSource: ResponseSource = { sampleRate: loopRate, response: () => terms.total }
  const groups: ResponseSource[][] = [[pidSource]]
  let gyro: Bode | null = null
  if (filtering === 'post') {
    const gyroRate = inputs.GyroSampleRate
    const sources = gyroFilterList(gyroFilters(inputs, gyroRate)).map(gyroSource)
    gyro = toBode(chainResponse(freq, [sources]), scale)
    groups.push(sources)
  }
  return {
    freq,
    pid,
    total: toBode(chainResponse(freq, groups), scale),
    p: toBode(terms.p, scale),
    i: toBode(terms.i, scale),
    d: toBode(terms.d, scale),
    gyro
  }
}
