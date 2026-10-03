import {
  accumulateTrackedNotchGroup,
  designTrackedNotchGroup,
  type TrackedNotch,
  type TransferAccumulator,
  type ZGrid
} from '@apwt/filters'
import { MAX_NUM_HARMONICS } from '../constants.js'
import type { NotchParams } from '../filter-params.js'
import type { FilterVersion } from '../filter-version.js'
import { STATIC_MODE } from '../tracking/static.js'
import type { InterpolatedTarget, NotchTarget, TargetFrequency, TrackingContext } from '../tracking/target.js'

/** Option bits of `_OPTS` that change the filter shape. */
export const NOTCH_OPTIONS = {
  double: 1 << 0,
  multiSource: 1 << 1,
  triple: 1 << 4,
  treatLowFreqAsMin: 1 << 5,
  quintuple: 1 << 6
} as const

/** Interpolated tracking data per target, for one gyro instance. */
export type TrackingInterpolation = ReadonlyMap<NotchTarget, InterpolatedTarget | undefined>

/**
 * A harmonic notch filter as configured by one `INS_HNTCH_*` parameter set
 * (upstream `HarmonicNotchFilter`).
 */
export class HarmonicNotchFilter {
  readonly params: NotchParams
  readonly filterVersion: FilterVersion
  /** Tracking source selected by `_MODE`, or `null` for an unsupported mode. */
  readonly tracking: NotchTarget | null
  /** Problems found while setting up (upstream alerts). */
  readonly warnings: readonly string[]
  /** Whether the notch is enabled and has tracking data. */
  readonly enabled: boolean
  /** One group of notches per selected harmonic (several for double, triple and quintuple notches). */
  private readonly notches: readonly (readonly TrackedNotch[])[]

  /**
   * @param targets Tracking sources in upstream `tracking_methods` order; the first whose
   *   `modeValue` equals `_MODE` is used.
   */
  constructor(params: NotchParams, targets: readonly NotchTarget[], filterVersion: FilterVersion) {
    this.params = params
    this.filterVersion = filterVersion
    const warnings: string[] = []

    // Find tracking source
    this.tracking = targets.find((t) => t.modeValue === params.mode) ?? null
    if (this.tracking === null) {
      warnings.push(`Unsupported notch mode ${params.mode}`)
    } else if (params.enable > 0 && !this.tracking.haveData(params, filterVersion)) {
      warnings.push(this.tracking.noDataError(params, filterVersion))
    }
    this.enabled = params.enable > 0 && this.tracking !== null && this.tracking.haveData(params, filterVersion)

    const notches: (readonly TrackedNotch[])[] = []
    if (this.enabled) {
      const quintuple = (params.options & NOTCH_OPTIONS.quintuple) !== 0
      const triple = (params.options & NOTCH_OPTIONS.triple) !== 0
      const double = (params.options & NOTCH_OPTIONS.double) !== 0

      let numCompositeNotches: 1 | 2 | 3 | 5 = 1
      if (double) {
        numCompositeNotches = 2
      } else if (triple) {
        numCompositeNotches = 3
      } else if (quintuple) {
        if (filterVersion < 4) {
          warnings.push('Quintuple notch only supported with filter version 4 or later')
        } else {
          numCompositeNotches = 5
        }
      }

      const minFreq = (h: number): number => this.minFreq(h)
      for (let n = 0; n < MAX_NUM_HARMONICS; n++) {
        if ((params.harmonics & (1 << n)) === 0) continue
        const harmonic = n + 1
        notches.push(
          designTrackedNotchGroup(params.attenuation, params.bandwidth, harmonic, minFreq, numCompositeNotches, params.freq)
        )
      }
    }
    this.notches = notches
    this.warnings = warnings
  }

  /** Whether the notch frequency is fixed (static mode), so it can be applied once for all times. */
  get isStatic(): boolean {
    return this.tracking?.modeValue === STATIC_MODE
  }

  /** Harmonic bitmask. */
  get harmonics(): number {
    return this.params.harmonics
  }

  /** Tracking source name. */
  get name(): string {
    return this.tracking?.name ?? ''
  }

  /** Lowest frequency the notch tracks for a harmonic (upstream `get_min_freq`). */
  minFreq(harmonic: number): number {
    if (this.filterVersion === 1) return 0.0
    const minFreq = this.params.freq * this.params.minRatio
    if ((this.params.options & NOTCH_OPTIONS.treatLowFreqAsMin) !== 0) return minFreq * harmonic
    return minFreq
  }

  /** Fundamental target frequency over the log (upstream `get_target_freq`). */
  targetFrequency(context: TrackingContext): TargetFrequency | undefined {
    return this.tracking?.targetFrequency(this.params, context)
  }

  /**
   * Multiply the notch response at FFT window `index` into `h`. Each harmonic is applied once
   * per tracked frequency (multi-motor / multi-peak tracking).
   */
  transfer(h: TransferAccumulator, tracking: TrackingInterpolation, index: number, sampleFreq: number, grid: ZGrid): void {
    if (!this.enabled || this.tracking === null) return
    // Get target frequencies from target
    const freq = tracking.get(this.tracking)?.frequencies(index, this.params, this.filterVersion) ?? null
    if (freq === null) return
    for (const group of this.notches) {
      for (const f of freq) accumulateTrackedNotchGroup(h, group, f, sampleFreq, grid)
    }
  }
}
