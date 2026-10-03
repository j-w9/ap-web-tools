import type { DataflashLog } from '@apwt/dataflash'
import { EscTarget } from './esc.js'
import { FftTarget } from './fft.js'
import { LoggedNotch } from './logged.js'
import { RPM1_MODE, RPM2_MODE, RpmTarget } from './rpm.js'
import { StaticTarget } from './static.js'
import type { NotchTarget } from './target.js'
import { ThrottleTarget } from './throttle.js'

/** Every notch tracking source, by role. */
export interface TrackingTargets {
  readonly static: StaticTarget
  readonly throttle: ThrottleTarget
  readonly rpm1: RpmTarget
  readonly esc: EscTarget
  readonly fft: FftTarget
  readonly rpm2: RpmTarget
  /** All of the above in upstream `tracking_methods` order (the order modes are matched in). */
  readonly all: readonly NotchTarget[]
}

/** Load every potential notch tracking source from a log (upstream `tracking_methods`). */
export function createTrackingTargets(log: DataflashLog): TrackingTargets {
  const targets = {
    static: new StaticTarget(),
    throttle: new ThrottleTarget(log),
    rpm1: new RpmTarget(log, 1, RPM1_MODE),
    esc: new EscTarget(log),
    fft: new FftTarget(log),
    rpm2: new RpmTarget(log, 2, RPM2_MODE)
  }
  return { ...targets, all: [targets.static, targets.throttle, targets.rpm1, targets.esc, targets.fft, targets.rpm2] }
}

/** Logged notch frequencies of both harmonic notches (upstream `logged_tracking`). */
export function createLoggedNotches(log: DataflashLog): [LoggedNotch, LoggedNotch] {
  return [new LoggedNotch(log, 0), new LoggedNotch(log, 1)]
}
