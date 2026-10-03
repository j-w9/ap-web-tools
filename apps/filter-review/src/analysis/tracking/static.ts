import type { NotchParams } from '../filter-params.js'
import type { FilterVersion } from '../filter-version.js'
import { NotchTarget, single, type InterpolatedTarget, type TargetFrequency, type TrackingContext } from './target.js'

/** `INS_HNTCH_MODE` value of a static (fixed frequency) notch. */
export const STATIC_MODE = 0

/** Fixed-frequency notch (upstream `StaticTarget`, `tracking/Static.js`). */
export class StaticTarget extends NotchTarget {
  constructor() {
    super('Static', STATIC_MODE)
  }

  /** Notch frequency: `_FREQ`, made positive from filter version 2. */
  target(config: NotchParams, filterVersion: FilterVersion): number {
    if (filterVersion >= 2) return Math.abs(config.freq)
    return config.freq
  }

  override haveData(): boolean {
    return true
  }

  override targetFrequency(config: NotchParams, context: TrackingContext): TargetFrequency {
    const f = this.target(config, context.filterVersion)
    return single(Float64Array.of(context.gyroStartTime, context.gyroEndTime), Float64Array.of(f, f))
  }

  /** Static targets do not depend on time; the result ignores the window index. */
  override interpolate(): InterpolatedTarget {
    return { frequencies: (_index, config, version) => [this.target(config, version)] }
  }
}
