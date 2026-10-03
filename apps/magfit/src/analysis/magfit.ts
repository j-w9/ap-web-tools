// The MAGFit calculation pipeline, ported from upstream MAGFit/magfit.js (`calculate`:
// `select_body_frame_attitude`, `calculate_bins`, `check_orientation`, `fit`), minus the DOM.

import type { AttitudeSource } from './attitude.js'
import { binWeights, assignBins } from './bins.js'
import { rotateField } from './calibration.js'
import type { CompassData } from './compass.js'
import { attitudeYaw, bodyFrameEarthField, compassYaw, interpolateAttitude } from './expected.js'
import { defaultFitKind, fitCompass, weightedRms, type FitKind, type FitSet } from './fit.js'
import type { MagFitLog } from './load.js'
import { checkOrientation, type OrientationCheck, type OrientationOption } from './orientation.js'
import type { MotorCompType } from './params.js'
import type { QuatSeries } from './quaternion.js'
import { analysisRange, type SampleRange } from './time-range.js'
import { vec3Distance, type Vec3Series } from './vector.js'

/** Attitude-dependent data for one compass (independent of the analysis window). */
export interface PreparedCompass {
  readonly compass: CompassData
  /** Attitude interpolated to the compass sample times. */
  readonly attitude: QuatSeries
  /** Euler yaw of {@link attitude}, radians. */
  readonly attitudeYaw: Float64Array
  /** Expected body-frame field at the compass sample times, mGauss. */
  readonly expected: Vec3Series
  /** Attitude bin of each sample. */
  readonly bins: Int32Array
  /** Distance between the logged (existing calibration) and expected field, mGauss. */
  readonly existingError: Float64Array
  /** Heading from the logged field, radians. */
  readonly existingYaw: Float64Array
}

/** Result of {@link prepareAttitude}. */
export interface PreparedAttitude {
  readonly source: AttitudeSource
  /** Expected body-frame field at the attitude source times (upstream "Expected" trace). */
  readonly expected: Vec3Series
  readonly compasses: readonly (PreparedCompass | undefined)[]
}

/**
 * Compute the expected field for an attitude source (upstream `select_body_frame_attitude`
 * plus `calculate_bins`). Upstream caches this until the source changes; callers can too.
 */
export function prepareAttitude(data: MagFitLog, sourceIndex: number): PreparedAttitude {
  const source = data.attitudeSources[sourceIndex]
  if (source === undefined) throw new Error('No attitude source selected')
  const ef = data.earthField
  const compasses = data.compasses.map((compass): PreparedCompass | undefined => {
    if (compass === undefined) return undefined
    const attitude = interpolateAttitude(source.attitude, source.time, compass.time)
    const expected = bodyFrameEarthField(attitude, ef.vector)
    return {
      compass,
      attitude,
      attitudeYaw: attitudeYaw(attitude),
      expected,
      bins: assignBins(expected),
      existingError: vec3Distance(expected, compass.logged),
      existingYaw: compassYaw(compass.logged, attitude, ef.declination)
    }
  })
  return { source, expected: bodyFrameEarthField(source.attitude, ef.vector), compasses }
}

/** Analysis options (upstream TimeStart/TimeEnd inputs and per-compass orientation radios). */
export interface MagFitOptions {
  /** Analysis window start, seconds. */
  readonly timeStart: number
  /** Analysis window end, seconds. */
  readonly timeEnd: number
  /** Orientation option per compass index; defaults to `check`. */
  readonly orientation?: readonly (OrientationOption | undefined)[]
}

/** Fits for one interference source (upstream `MAG_Data[i].fits[j]`). */
export interface FitGroup {
  /** "No motor comp" or the interference source name. */
  readonly name: string
  readonly type: MotorCompType
  /**
   * Interference source resampled at compass 1's sample times (upstream bug reproduced, see
   * {@link motorSourceAt}), `undefined` for no motor compensation.
   */
  readonly motor: Float64Array | undefined
  readonly fits: FitSet
  /** Fit upstream ticks by default, see {@link defaultFitKind}. */
  readonly defaultKind: FitKind | undefined
}

/** MAGFit result for one compass. */
export interface CompassFitResult {
  readonly prepared: PreparedCompass
  /** Samples inside the analysis window. */
  readonly range: SampleRange
  /** Fraction of attitude bins covered in the window, 0..1. */
  readonly coverage: number
  /** Weighted RMS error of the existing calibration in the window, mGauss. */
  readonly existingMeanError: number
  /** Orientation check, only for compasses whose orientation could be undone. */
  readonly orientationCheck: OrientationCheck | undefined
  /** Orientation the fits use. */
  readonly orientation: number
  /** Raw field in the board frame that was fitted. */
  readonly field: Vec3Series
  readonly groups: readonly FitGroup[]
}

/** Run the orientation check and fits for every compass (upstream `check_orientation` + `fit`). */
export function runFits(data: MagFitLog, prepared: PreparedAttitude, options: MagFitOptions): (CompassFitResult | undefined)[] {
  return prepared.compasses.map((p, i) => {
    if (p === undefined) return undefined
    const compass = p.compass
    const range = analysisRange(compass.time, options.timeStart, options.timeEnd)
    const { weights, coverage } = binWeights(p.bins.subarray(range.start, range.end))

    let orientationCheck: OrientationCheck | undefined
    let orientation = compass.params.orientation
    let field = compass.raw
    if (compass.rotated) {
      orientationCheck = checkOrientation({
        raw: compass.raw,
        expected: p.expected,
        weights,
        range,
        current: compass.params.orientation,
        option: options.orientation?.[i] ?? 'check',
        compassIndex: i
      })
      orientation = orientationCheck.rotation
      field = rotateField(compass.raw, orientation)
    }

    const input = {
      field,
      expected: p.expected,
      weights,
      range,
      orientation,
      attitude: p.attitude,
      declination: data.earthField.declination
    }
    const sources: Omit<FitGroup, 'fits' | 'defaultKind'>[] = [
      { name: 'No motor comp', type: 0, motor: undefined },
      ...data.motorSources.map((s) => ({ name: s.name, type: s.type, motor: s.atCompass0 }))
    ]
    const groups = sources.map((g): FitGroup => {
      const fits = fitCompass(input, g.motor === undefined ? undefined : { type: g.type, value: g.motor })
      return { ...g, fits, defaultKind: defaultFitKind(fits, g.type) }
    })

    return {
      prepared: p,
      range,
      coverage,
      existingMeanError: weightedRms(p.existingError, weights, range),
      orientationCheck,
      orientation,
      field,
      groups
    }
  })
}

/** Full MAGFit result for one attitude source and window. */
export interface MagFitResult {
  readonly attitude: PreparedAttitude
  readonly compasses: readonly (CompassFitResult | undefined)[]
}

/** Run the whole MAGFit calculation (upstream `calculate`). */
export function runMagFit(data: MagFitLog, options: MagFitOptions & { readonly attitudeSource: number }): MagFitResult {
  const attitude = prepareAttitude(data, options.attitudeSource)
  return { attitude, compasses: runFits(data, attitude, options) }
}
