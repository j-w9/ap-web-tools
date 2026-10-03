/**
 * Frequency responses of filter chains as Bode data, ported from upstream
 * `evaluate_transfer_functions`, `unwrap`, `calculate_filter` and `calculate_pid`.
 */
import {
  chainResponse,
  designBiquadLowPass,
  designHarmonicNotch,
  designPid,
  elementResponse,
  frequencyGrid,
  isElementEnabled,
  phaseDegrees,
  pidResponse,
  unityResponse,
  unwrapPhase,
  zGrid,
  type BiquadLowPass,
  type HarmonicNotch,
  type Pid
} from '@apwt/filters'
import { arrayLog10, arrayScale, complexAbs, complexMul, type ComplexArray } from '@apwt/signal'
import { NOTCH_PREFIXES, type Inputs, type NotchPrefix, type PidAxis } from './params.js'
import { notchConfig, operatingPoint, pidGains } from './config.js'

/** One filter in the gyro chain. */
export type GyroFilter = HarmonicNotch | BiquadLowPass

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

/** Bode data of a complex response. */
export function toBode(h: ComplexArray, scale: BodeScale): Bode {
  const abs = complexAbs(h)
  const phase = phaseDegrees(h)
  return {
    magnitude: scale.magnitude === 'dB' ? arrayScale(arrayLog10(abs), 20.0) : abs,
    phase: scale.phase === 'unwrapped' ? unwrapPhase(phase) : phase
  }
}

// ---------- Gyro filters ----------

/** The gyro filter chain in upstream order: notch 1, notch 2, low-pass. */
export interface GyroFilters {
  readonly notches: Readonly<Record<NotchPrefix, HarmonicNotch>>
  readonly lowPass: BiquadLowPass
}

export function gyroFilters(inputs: Inputs, sampleRate: number): GyroFilters {
  const op = operatingPoint(inputs)
  const notch = (prefix: NotchPrefix) => designHarmonicNotch(sampleRate, notchConfig(inputs, prefix), op)
  return {
    notches: { INS_HNTCH: notch('INS_HNTCH'), INS_HNTC2: notch('INS_HNTC2') },
    lowPass: designBiquadLowPass(sampleRate, inputs.INS_GYRO_FILTER)
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
    const h = elementResponse(filter, grid)
    total = complexMul(total, h)
    return { key: keys[i]!, filter, enabled: isElementEnabled(filter), bode: toBode(h, scale) }
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
  readonly pid: Pid
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

  const groups: (Pid | GyroFilter)[][] = [[pid]]
  let gyro: Bode | null = null
  if (filtering === 'post') {
    const gyroList = gyroFilterList(gyroFilters(inputs, inputs.GyroSampleRate))
    gyro = toBode(chainResponse(freq, [gyroList]), scale)
    groups.push(gyroList)
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
