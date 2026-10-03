// Least-squares compass calibration fits, ported from upstream MAGFit/magfit.js (`fit`).
//
// Three nested models are fitted with weighted linear least squares, each optionally with
// per-axis motor compensation proportional to an interference source (battery current):
//   offsets: expected - raw = offsets (+ motor * source)
//   scale:   expected = scale * raw + scale * offsets (+ motor * source)
//   iron:    expected = M * raw + M * offsets (+ motor * source), M symmetric 3x3
// Each solution is converted back to ArduPilot's parameterisation and evaluated against the
// expected field over the analysis window.
//
// Upstream builds one 3n x 12 matrix and narrows it by assigning `A.columns`; here each solve
// gets an exactly sized matrix with the same entries, which ml-matrix treats identically.

import { Matrix, inverse, solve } from 'ml-matrix'
import { arrayMean } from '@apwt/signal'
import { applyParams, ironMatrix } from './calibration.js'
import { compassYaw } from './expected.js'
import { DIAGONALS_RANGE, OFF_DIAGONALS_RANGE, OFFSETS_RANGE, SCALE_RANGE, type CalParams, type MotorCompType } from './params.js'
import type { QuatSeries } from './quaternion.js'
import type { SampleRange } from './time-range.js'
import { vec3Distance, type Vec3, type Vec3Series } from './vector.js'

/** The three calibration models (upstream `fit_types` keys). */
export type FitKind = 'offsets' | 'scale' | 'iron'

/** All fit kinds in upstream order. */
export const FIT_KINDS: readonly FitKind[] = ['offsets', 'scale', 'iron']

/** Display names of the fit kinds (upstream `fit_types`). */
export const FIT_KIND_NAMES: Readonly<Record<FitKind, string>> = {
  offsets: 'Offsets',
  scale: 'Offsets and scale',
  iron: 'Offsets and iron'
}

/** A per-sample interference source for motor compensation, on the compass time base. */
export interface MotorInput {
  readonly type: MotorCompType
  readonly value: ArrayLike<number>
}

/** Result of evaluating one fitted parameter set. Invalid fits are not evaluated. */
export type FitResult =
  | { readonly valid: false; readonly params: CalParams }
  | {
      readonly valid: true
      readonly params: CalParams
      /** Calibrated field for every sample. */
      readonly field: Vec3Series
      /** Per-sample distance to the expected field, mGauss. */
      readonly error: Float64Array
      /** Weighted RMS error over the analysis window, mGauss. */
      readonly meanError: number
      /** Tilt-compensated heading from the calibrated field, radians. */
      readonly yaw: Float64Array
    }

/** The three fits for one interference source. */
export type FitSet = Readonly<Record<FitKind, FitResult>>

/** Everything a fit needs about one compass. */
export interface FitInput {
  /** Raw field in the board frame (already rotated by the orientation in use). */
  readonly field: Vec3Series
  /** Expected body-frame field at the compass sample times. */
  readonly expected: Vec3Series
  /** Bin weights for the samples in `range` (index 0 is sample `range.start`). */
  readonly weights: ArrayLike<number>
  readonly range: SampleRange
  /** Orientation parameter the fitted parameters belong to. */
  readonly orientation: number
  /** Attitude at the compass sample times, for the heading. */
  readonly attitude: QuatSeries
  /** Earth field declination in degrees, for the heading. */
  readonly declination: number
}

function inRange(val: number, range: readonly [number, number]): boolean {
  return val > range[0] && val < range[1]
}

/** Whether every parameter is strictly inside its typical range (upstream `params_valid`). */
export function paramsValid(params: CalParams): boolean {
  let ret = true
  for (let i = 0; i < 3; i++) {
    ret &&= inRange(params.offsets[i]!, OFFSETS_RANGE)
    ret &&= inRange(params.diagonals[i]!, DIAGONALS_RANGE)
    ret &&= inRange(params.offDiagonals[i]!, OFF_DIAGONALS_RANGE)
  }
  ret &&= inRange(params.scale, SCALE_RANGE)
  return ret
}

/** Weighted RMS of `error` over `range` with `weights` indexed from `range.start`. */
export function weightedRms(error: ArrayLike<number>, weights: ArrayLike<number>, range: SampleRange): number {
  const numSamples = range.end - range.start
  let errorSum = 0
  for (let j = 0; j < numSamples; j++) errorSum += weights[j]! * error[range.start + j]! ** 2
  return Math.sqrt(errorSum / numSamples)
}

interface PartialParams {
  offsets: Vec3
  scale?: number
  diagonals?: Vec3
  offDiagonals?: Vec3
  motor?: Vec3 | undefined
}

/** Fill defaults, check ranges and evaluate a parameter set (upstream `evaluate_fit`). */
function evaluateFit(input: FitInput, partial: PartialParams, motor: MotorInput | undefined): FitResult {
  const params: CalParams = {
    offsets: partial.offsets,
    diagonals: partial.diagonals ?? [1.0, 1.0, 1.0],
    offDiagonals: partial.offDiagonals ?? [0.0, 0.0, 0.0],
    scale: partial.scale ?? 1.0,
    motor: partial.motor ?? [0.0, 0.0, 0.0],
    orientation: input.orientation,
    fitType: motor?.type ?? 0
  }
  if (!paramsValid(params)) return { valid: false, params }

  const field = applyParams(input.field, params, motor?.value)
  const error = vec3Distance(input.expected, field)
  const meanError = weightedRms(error, input.weights, input.range)
  const yaw = compassYaw(field, input.attitude, input.declination)
  return { valid: true, params, field, error, meanError, yaw }
}

const vec3Of = (m: Matrix, first: number): Vec3 => [m.get(first, 0), m.get(first + 1, 0), m.get(first + 2, 0)]

/**
 * Fit offsets, offsets + scale and offsets + iron matrix for one compass, optionally with motor
 * compensation from `motor` (one iteration of upstream `fit`'s loop over `MAG_Data[i].fits`).
 */
export function fitCompass(input: FitInput, motor?: MotorInput): FitSet {
  const { field: rot, expected, range } = input
  const startIndex = range.start
  const numSamples = range.end - range.start
  const rows = numSamples * 3
  const fitMot = motor !== undefined

  const sqrtWeight = new Float64Array(numSamples)
  for (let j = 0; j < numSamples; j++) sqrtWeight[j] = Math.sqrt(input.weights[j]!)

  // B for scale and iron fits, B2 for offsets only
  const B = new Matrix(rows, 1)
  const B2 = new Matrix(rows, 1)
  for (let j = 0; j < numSamples; j++) {
    const r = j * 3
    const d = startIndex + j
    const w = sqrtWeight[j]!
    B.set(r + 0, 0, expected.x[d]! * w)
    B.set(r + 1, 0, expected.y[d]! * w)
    B.set(r + 2, 0, expected.z[d]! * w)
    B2.set(r + 0, 0, (expected.x[d]! - rot.x[d]!) * w)
    B2.set(r + 1, 0, (expected.y[d]! - rot.y[d]!) * w)
    B2.set(r + 2, 0, (expected.z[d]! - rot.z[d]!) * w)
  }

  /** A matrix with the offset columns 0..2 populated (upstream `setup_offsets`). */
  const offsetsMatrix = (columns: number): Matrix => {
    const A = new Matrix(rows, columns)
    for (let j = 0; j < numSamples; j++) {
      const r = j * 3
      A.set(r + 0, 0, sqrtWeight[j]!)
      A.set(r + 1, 1, sqrtWeight[j]!)
      A.set(r + 2, 2, sqrtWeight[j]!)
    }
    return A
  }

  /** Motor columns `col..col+2` (upstream `setup_motor`). */
  const setupMotor = (A: Matrix, col: number): void => {
    if (motor === undefined) return
    for (let j = 0; j < numSamples; j++) {
      const r = j * 3
      const val = motor.value[startIndex + j]! * sqrtWeight[j]!
      A.set(r + 0, col, val)
      A.set(r + 1, col + 1, val)
      A.set(r + 2, col + 2, val)
    }
  }

  // Just fitting offsets, possibly with motor correction
  let A = offsetsMatrix(fitMot ? 6 : 3)
  setupMotor(A, 3)
  let p = solve(A, B2)
  const offsetsFit = evaluateFit(
    input,
    {
      offsets: vec3Of(p, 0),
      motor: fitMot ? vec3Of(p, 3) : undefined
    },
    motor
  )

  // Offsets and scale, possibly with motor correction (upstream `setup_scale`)
  A = offsetsMatrix(fitMot ? 7 : 4)
  for (let j = 0; j < numSamples; j++) {
    const r = j * 3
    const d = startIndex + j
    const w = sqrtWeight[j]!
    A.set(r + 0, 3, rot.x[d]! * w)
    A.set(r + 1, 3, rot.y[d]! * w)
    A.set(r + 2, 3, rot.z[d]! * w)
  }
  setupMotor(A, 4)
  p = solve(A, B)
  const scale = p.get(3, 0)
  // Remove scale from offsets
  const invScale = 1 / scale
  const scaleFit = evaluateFit(
    input,
    {
      offsets: [p.get(0, 0) * invScale, p.get(1, 0) * invScale, p.get(2, 0) * invScale],
      scale,
      motor: fitMot ? vec3Of(p, 4) : undefined
    },
    motor
  )

  // Offsets and iron matrix, possibly with motor correction (upstream `setup_iron`)
  A = offsetsMatrix(fitMot ? 12 : 9)
  for (let j = 0; j < numSamples; j++) {
    const r = j * 3
    const d = startIndex + j
    const w = sqrtWeight[j]!
    const x = rot.x[d]! * w
    const y = rot.y[d]! * w
    const z = rot.z[d]! * w
    // Diagonals
    A.set(r + 0, 3, x)
    A.set(r + 1, 4, y)
    A.set(r + 2, 5, z)
    // Off-diagonals
    A.set(r + 0, 6, y)
    A.set(r + 1, 6, x)
    A.set(r + 0, 7, z)
    A.set(r + 2, 7, x)
    A.set(r + 1, 8, z)
    A.set(r + 2, 8, y)
  }
  setupMotor(A, 9)
  p = solve(A, B)
  let diagonals = vec3Of(p, 3)
  let offDiagonals = vec3Of(p, 6)

  // Remove iron correction from offsets
  const uncorrected = new Matrix([[p.get(0, 0), p.get(1, 0), p.get(2, 0)]])
  const corrected = uncorrected.mmul(inverse(ironMatrix(diagonals, offDiagonals)))
  const offsets: Vec3 = [corrected.get(0, 0), corrected.get(0, 1), corrected.get(0, 2)]

  // Normalize iron matrix into scale param
  const ironScale = arrayMean(diagonals)
  const inv = 1 / ironScale
  diagonals = [diagonals[0] * inv, diagonals[1] * inv, diagonals[2] * inv]
  offDiagonals = [offDiagonals[0] * inv, offDiagonals[1] * inv, offDiagonals[2] * inv]

  const ironFit = evaluateFit(
    input,
    {
      offsets,
      scale: ironScale,
      diagonals,
      offDiagonals,
      motor: fitMot ? vec3Of(p, 9) : undefined
    },
    motor
  )

  return { offsets: offsetsFit, scale: scaleFit, iron: ironFit }
}

/**
 * The fit upstream selects by default for a set: the first valid kind, but only for fits
 * without motor compensation (`fit` end of loop). `undefined` when none applies.
 */
export function defaultFitKind(set: FitSet, motorType: MotorCompType): FitKind | undefined {
  if (motorType !== 0) return undefined
  return FIT_KINDS.find((kind) => set[kind].valid)
}
