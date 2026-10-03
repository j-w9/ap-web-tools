// Compass orientation check, ported from upstream MAGFit/magfit.js (`check_orientation`).
// Every candidate rotation is applied to the raw field, a best-fit offset is removed (difference
// of means) and the weighted squared error to the expected field is compared.

import { quatRotate } from './quaternion.js'
import { LAST_ROTATION, isRightAngleRotation, rotationName, rotationQuat } from './rotations.js'
import type { SampleRange } from './time-range.js'
import type { Vec3Series } from './vector.js'

/** Orientation option per compass (upstream radio: 0 check, 1 fix 90, 2 fix 45). */
export type OrientationOption = 'check' | 'fix90' | 'fix45'

/** Weighted mean squared error for one candidate rotation. */
export interface RotationError {
  readonly rotation: number
  readonly error: number
}

/** Outcome of the orientation check for one compass. */
export interface OrientationCheck {
  /** Candidates sorted by ascending error (stable, in rotation order for ties). */
  readonly ranking: readonly RotationError[]
  /** Orientation parameter currently set. */
  readonly current: number
  /** Whether the best candidate is the current orientation. */
  readonly isCorrect: boolean
  /** Error of the second best divided by the best. */
  readonly costRatio: number
  /** The best candidate is at least twice as good as the next (upstream `check_valid`). */
  readonly confident: boolean
  /** Orientation the fit should use: the best candidate if fixing was requested and confident. */
  readonly rotation: number
  /** Summary line upstream logs to the console. */
  readonly summary: string
  /**
   * Message upstream shows in an alert when an incorrect orientation is detected but the
   * option is `check` (not fixing). `undefined` when there is nothing to warn about.
   */
  readonly warning: string | undefined
}

/** Inputs to {@link checkOrientation}. */
export interface OrientationInput {
  /** Raw field in the sensor frame. */
  readonly raw: Vec3Series
  /** Expected body-frame field at the compass sample times. */
  readonly expected: Vec3Series
  /** Bin weights for the samples in `range` (index 0 is sample `range.start`). */
  readonly weights: ArrayLike<number>
  readonly range: SampleRange
  /** Current orientation parameter. */
  readonly current: number
  readonly option: OrientationOption
  /** 0-based compass index, for messages. */
  readonly compassIndex: number
}

const name = (rotation: number): string => String(rotationName(rotation))

/**
 * Find the best orientation for a compass (upstream `check_orientation` for one compass).
 * Rotations 38 and 41 are never tried; 45 degree rotations only with the `fix45` option.
 * Requires at least two candidate rotations, which is always the case.
 */
export function checkOrientation(input: OrientationInput): OrientationCheck {
  const { raw, expected, weights, range, current, option, compassIndex } = input
  const fix = option === 'fix90' || option === 'fix45'
  const include45 = option === 'fix45'
  const startIndex = range.start
  const numSamples = range.end - range.start

  // Calculate average earth field to match sensor to
  let efX = 0.0
  let efY = 0.0
  let efZ = 0.0
  for (let j = 0; j < numSamples; j++) {
    const d = startIndex + j
    efX += expected.x[d]!
    efY += expected.y[d]!
    efZ += expected.z[d]!
  }
  efX /= numSamples
  efY /= numSamples
  efZ /= numSamples

  const rotError: RotationError[] = []
  const x = new Float64Array(numSamples)
  const y = new Float64Array(numSamples)
  const z = new Float64Array(numSamples)
  for (let rot = 0; rot <= LAST_ROTATION; rot++) {
    // Skip the weird ones: ROTATION_ROLL_90_PITCH_68_YAW_293 and ROTATION_PITCH_7
    if (rot === 38 || rot === 41) continue
    if (!include45 && !isRightAngleRotation(rot)) continue
    const rotation = rotationQuat(rot)
    if (rotation === undefined) continue

    // Rotate and take average
    let meanX = 0.0
    let meanY = 0.0
    let meanZ = 0.0
    for (let j = 0; j < numSamples; j++) {
      const d = startIndex + j
      const tmp = quatRotate(rotation, [raw.x[d]!, raw.y[d]!, raw.z[d]!])
      x[j] = tmp[0]
      y[j] = tmp[1]
      z[j] = tmp[2]
      meanX += tmp[0]
      meanY += tmp[1]
      meanZ += tmp[2]
    }
    meanX /= numSamples
    meanY /= numSamples
    meanZ /= numSamples

    const ofsX = efX - meanX
    const ofsY = efY - meanY
    const ofsZ = efZ - meanZ

    let errorSum = 0
    for (let j = 0; j < numSamples; j++) {
      const d = startIndex + j
      errorSum +=
        ((x[j]! - expected.x[d]! + ofsX) ** 2 + (y[j]! - expected.y[d]! + ofsY) ** 2 + (z[j]! - expected.z[d]! + ofsZ) ** 2) *
        weights[j]!
    }
    rotError.push({ rotation: rot, error: errorSum / numSamples })
  }

  rotError.sort((a, b) => a.error - b.error)
  const first = rotError[0]!
  const second = rotError[1]!

  const isCorrect = first.rotation === current
  const costRatio = second.error / first.error
  // best error must be half that of next best to be sure
  const confident = costRatio > 2

  let summary = 'Mag ' + String(compassIndex + 1) + ' ' + (isCorrect ? 'correct' : 'incorrect') + ' orientation ' + name(current)
  if (!isCorrect) summary += ', best orientation: ' + name(first.rotation)
  summary += ', second best orientation: ' + name(second.rotation)
  summary += ', cost ratio: ' + costRatio.toFixed(2)

  let rotation = current
  let warning: string | undefined
  if (confident && !isCorrect) {
    if (fix) {
      rotation = first.rotation
    } else {
      warning =
        'Mag ' +
        String(compassIndex + 1) +
        ' possible incorrect orientation: ' +
        name(current) +
        '\n' +
        'Should be: ' +
        name(first.rotation) +
        ' ?\n' +
        'Cost ratio: ' +
        costRatio.toFixed(2)
    }
  }

  return { ranking: rotError, current, isCorrect, costRatio, confident, rotation, summary, warning }
}
