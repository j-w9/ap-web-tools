/**
 * Adapts the embind `AC_WPNav_wrapper` (see `wpnav-glue.d.ts`) to the `WpNavEngine` port the analysis
 * code uses. The engine owns every instance it creates and deletes it when the caller is done,
 * so callers only ever see a borrowed `WpNav`.
 */
import type { Curve1D, Vec3, WpNav, WpNavEngine } from '../analysis/engine.js'
import type { AC_WPNav_wrapper, BoundCurve, WPNavModuleInstance } from './wpnav-glue.js'

function curveFrom(raw: BoundCurve): Curve1D {
  return {
    time: Float64Array.from(raw.time),
    pos: Float64Array.from(raw.pos),
    vel: Float64Array.from(raw.vel),
    accel: Float64Array.from(raw.accel),
    jerk: Float64Array.from(raw.jerk),
    snap: Float64Array.from(raw.snap)
  }
}

/** Borrowed camelCase view of one embind instance. */
function view(w: AC_WPNav_wrapper): WpNav {
  return {
    setLimits: (l) =>
      w.set_wp_nav_params(
        l.speedMs,
        l.speedUpMs,
        l.speedDownMs,
        l.radiusM,
        l.accelMss,
        l.accelCornerMss,
        l.accelZMss,
        l.jerkMsss,
        l.terrainMarginM
      ),
    setPosControl: (s) =>
      w.set_psc_params(s.neKp, s.accelZFilterTargetHz, s.accelZFilterErrorHz, s.shapingJerkNeMsss, s.shapingJerkDMsss, s.dtS),
    setAttitude: (s) =>
      w.set_atc_params(
        s.rollRateMaxDegs,
        s.pitchRateMaxDegs,
        s.rollAccelMaxDegss,
        s.pitchAccelMaxDegss,
        s.inputTc,
        s.rateFeedForward
      ),
    setInitialPosition: (p) => w.set_initial_position(p.north, p.east, p.down),
    init: (p) => w.wp_and_spline_init_m(p.north, p.east, p.down),
    setDestination: (p) => w.set_wp_destination_NED_m(p.north, p.east, p.down),
    setNextDestination: (p) => w.set_wp_destination_next_NED_m(p.north, p.east, p.down),
    advance: (dt) => w.advance_wp_target_along_track(dt),
    reachedDestination: () => w.reached_wp_destination(),
    position: (): Vec3 => w.get_pos(),
    velocity: (): Vec3 => w.get_vel(),
    acceleration: (): Vec3 => w.get_accel(),
    currentCurve: (dt) => curveFrom(w.get_current_1D_curve(dt))
  }
}

/** Wrap an instantiated module. Each `withWpNav` call gets a fresh instance, freed afterwards. */
export function createEngine(module: WPNavModuleInstance): WpNavEngine {
  return {
    withWpNav<T>(body: (nav: WpNav) => T): T {
      const instance = new module.AC_WPNav_wrapper()
      try {
        return body(view(instance))
      } finally {
        instance.delete()
      }
    }
  }
}
