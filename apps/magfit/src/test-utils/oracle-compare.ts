// Test-only: comparisons of upstream MAGFit state (after `load`/`calculate`, run by upstream.ts)
// with the port. Shared by the oracle tests and the real-log test.
import { expect } from 'vitest'
import { FIT_KIND_NAMES, FIT_KINDS, type FitResult } from '../analysis/fit.js'
import type { MagFitLog } from '../analysis/load.js'
import type { MagFitResult } from '../analysis/magfit.js'
import {
  buildParamFile,
  checkParams,
  missingOrientationError,
  type ParamFileEntry,
  type UseOverride
} from '../analysis/params.js'
import { expectSameArray, expectSameNumber } from './compare.js'
import type { UpstreamMagfit } from './upstream.js'

export type Series = { x: number[]; y: number[]; z: number[] }
export interface UpFit extends Partial<Series> {
  /** Upstream builds this with `&=`, so it is 0 or 1. */
  valid: number
  params: {
    offsets: number[]
    diagonals: number[]
    off_diagonals: number[]
    motor: number[]
    scale: number
    orientation: number
    fit_type: number
  }
  error?: number[]
  mean_error?: number
  yaw?: number[]
}
export interface UpCompass {
  time: number[]
  raw: Series
  rotate: boolean
  rotation?: number
  orig: Series & { error: number[]; yaw: number[]; mean_error: number }
  expected: Series & { bins: number[] }
  quaternion: { q1: number[]; q2: number[]; q3: number[]; q4: number[]; yaw: number[] }
  coverage: { value: number }
  params: Record<string, number | number[] | undefined>
  fits: ({ name: string; type: number; value: number[] | null } & Record<'offsets' | 'scale' | 'iron', UpFit>)[]
}

export function compareSeries(
  mine: { x: ArrayLike<number>; y: ArrayLike<number>; z: ArrayLike<number> },
  theirs: Series,
  label: string
): void {
  expectSameArray(mine.x, theirs.x, `${label}.x`)
  expectSameArray(mine.y, theirs.y, `${label}.y`)
  expectSameArray(mine.z, theirs.z, `${label}.z`)
}

export function compareFit(mine: FitResult, theirs: UpFit, label: string): void {
  expect(mine.valid, `${label} valid`).toBe(theirs.valid === 1)
  const p = mine.params
  expectSameArray(p.offsets, theirs.params.offsets, `${label} offsets`)
  expectSameArray(p.diagonals, theirs.params.diagonals, `${label} diagonals`)
  expectSameArray(p.offDiagonals, theirs.params.off_diagonals, `${label} offDiagonals`)
  expectSameArray(p.motor, theirs.params.motor, `${label} motor`)
  expectSameNumber(p.scale, theirs.params.scale, `${label} scale`)
  expectSameNumber(p.orientation, theirs.params.orientation, `${label} orientation`)
  expect(p.fitType, `${label} fitType`).toBe(theirs.params.fit_type)
  if (!mine.valid) return
  compareSeries(mine.field, theirs as Series, `${label} field`)
  expectSameArray(mine.error, theirs.error, `${label} error`)
  expectSameNumber(mine.meanError, theirs.mean_error, `${label} meanError`)
  expectSameArray(mine.yaw, theirs.yaw, `${label} yaw`)
}

export function compareAll(up: UpstreamMagfit, data: MagFitLog, result: MagFitResult): void {
  const ef = up.evaluate<{ declination: number; inclination: number; intensity: number; vector: number[] }>('earth_field')
  expectSameNumber(data.earthField.declination, ef.declination, 'declination')
  expectSameNumber(data.earthField.inclination, ef.inclination, 'inclination')
  expectSameNumber(data.earthField.intensity, ef.intensity, 'intensity')
  expectSameArray(data.earthField.vector, ef.vector, 'ef vector')
  expect(data.startTime).toBe(up.evaluate('MAG_Data.start_time'))
  expect(data.endTime).toBe(up.evaluate('MAG_Data.end_time'))

  const source = up.evaluate<Series & { name: string; quaternion: { time: number[] } }>('source')
  expect(result.attitude.source.name).toBe(source.name)
  expectSameArray(result.attitude.source.time, source.quaternion.time, 'source time')
  compareSeries(result.attitude.expected, source, 'source expected')

  for (let i = 0; i < 3; i++) {
    const theirs = up.evaluate<UpCompass | null | undefined>(`MAG_Data[${i}]`)
    const mine = result.compasses[i]
    const label = `MAG ${i}`
    expect(mine === undefined, `${label} presence`).toBe(theirs === undefined || theirs === null)
    if (mine === undefined || theirs === undefined || theirs === null) continue
    const compass = mine.prepared.compass
    expectSameArray(compass.time, theirs.time, `${label} time`)
    compareSeries(compass.logged, theirs.orig, `${label} logged`)
    compareSeries(compass.raw, theirs.raw, `${label} raw`)
    expect(compass.rotated, `${label} rotate`).toBe(theirs.rotate)
    expectSameNumber(compass.params.scale, theirs.params['scale'] as number | undefined, `${label} param scale`)
    expectSameNumber(compass.params.orientation, theirs.params['orientation'] as number | undefined, `${label} param orientation`)

    const p = mine.prepared
    expectSameArray(p.attitude.q1, theirs.quaternion.q1, `${label} q1`)
    expectSameArray(p.attitude.q2, theirs.quaternion.q2, `${label} q2`)
    expectSameArray(p.attitude.q3, theirs.quaternion.q3, `${label} q3`)
    expectSameArray(p.attitude.q4, theirs.quaternion.q4, `${label} q4`)
    expectSameArray(p.attitudeYaw, theirs.quaternion.yaw, `${label} attitude yaw`)
    compareSeries(p.expected, theirs.expected, `${label} expected`)
    expectSameArray(p.bins, theirs.expected.bins, `${label} bins`)
    expectSameArray(p.existingError, theirs.orig.error, `${label} existing error`)
    expectSameArray(p.existingYaw, theirs.orig.yaw, `${label} existing yaw`)
    expectSameNumber(mine.existingMeanError, theirs.orig.mean_error, `${label} existing mean error`)
    expectSameNumber(mine.coverage, theirs.coverage.value, `${label} coverage`)
    if (theirs.rotate) expect(mine.orientation, `${label} rotation`).toBe(theirs.rotation)

    expect(mine.groups.map((g) => [g.name, g.type])).toEqual(theirs.fits.map((f) => [f.name, f.type]))
    mine.groups.forEach((g, j) => {
      const value = theirs.fits[j]!.value
      if (value === null) expect(g.motor, `${label} ${g.name} motor source`).toBeUndefined()
      else expectSameArray(g.motor, value, `${label} ${g.name} motor source`)
    })
    mine.groups.forEach((g, j) => {
      for (const kind of FIT_KINDS) compareFit(g.fits[kind], theirs.fits[j]![kind], `${label} ${g.name} ${kind}`)
    })
  }
}

/** Entries upstream would save: the first shown selection of each compass. */
export function upstreamEntries(up: UpstreamMagfit, result: MagFitResult, use: readonly UseOverride[] = []): ParamFileEntry[] {
  const entries: ParamFileEntry[] = []
  result.compasses.forEach((c, i) => {
    if (c === undefined) return
    const selection = up.evaluate<{ name: string; show: boolean }[]>(`MAG_Data[${i}].param_selection`).find((s) => s.show)
    if (selection === undefined) return
    for (const g of c.groups) {
      for (const kind of FIT_KINDS) {
        if (`${FIT_KIND_NAMES[kind]}, ${g.name}` !== selection.name) continue
        const entry = { compassIndex: i, names: c.prepared.compass.names, params: g.fits[kind].params, fitName: selection.name }
        const override = use[i]
        entries.push(override === undefined ? entry : { ...entry, use: override })
      }
    }
  })
  return entries
}

/**
 * Save parameters upstream (its selection, and the "Use sensor" radios the caller set to match
 * `use`) and compare the file, summary and confirmations with the port's.
 */
export function compareParamFile(up: UpstreamMagfit, result: MagFitResult, use: readonly UseOverride[] = []): void {
  const entries = upstreamEntries(up, result, use)
  up.saved.length = 0
  up.alerts.length = 0
  up.confirms.length = 0
  let upstreamThrew = false
  try {
    up.evaluate('save_parameters()')
  } catch {
    upstreamThrew = true
  }
  if (upstreamThrew) {
    // A missing orientation parameter: param_to_string(undefined) throws upstream. Proven bug,
    // fixed (docs/bug-proofs/magfit.md row 4): the port returns a message instead.
    const missing = entries.find((e) => Number.isNaN(e.params.orientation))
    expect(missing, 'upstream threw without a missing orientation').toBeDefined()
    expect(buildParamFile(entries)).toEqual({ ok: false, error: missingOrientationError(missing!.names.orientation) })
    return
  }
  const built = buildParamFile(entries)
  if (up.saved.length === 0) {
    expect(built).toEqual({ ok: false, error: up.alerts.at(-1) })
    return
  }
  expect(built.ok).toBe(true)
  if (!built.ok) return
  expect(built.text).toBe(up.saved[0])
  expect(built.summary).toBe(up.alerts[up.alerts.length - 1])
  // Upstream asks for confirmation only when check_params finds something; the text must match.
  const warnings = entries
    .map((e) => checkParams(e.compassIndex, e.names, e.params, result.compasses[e.compassIndex]!.prepared.compass.params))
    .filter((w) => w !== '')
  expect(warnings).toEqual(up.confirms)
}

/**
 * Proven upstream bug fixed (docs/bug-proofs/magfit.md row 1, proofs/magfit/battery-time-base.test.ts):
 * upstream resamples the battery current at compass 1's times for every compass. Assert upstream's
 * value, then hand upstream each compass's own resample and recalculate, so the rest of the oracle
 * checks the port's corrected motor fits against upstream's own maths. Returns how many motor
 * sources differed (0 when every compass shares compass 1's time base: nothing changes).
 */
export function correctUpstreamMotorTimeBase(up: UpstreamMagfit): number {
  let patched = 0
  for (let i = 0; i < 3; i++) {
    if (up.evaluate(`MAG_Data[${i}] == null`)) continue
    const groups = up.evaluate<number>(`MAG_Data[${i}].fits.length`)
    for (let j = 1; j < groups; j++) {
      const source = `motor_comp.data[${j - 1}]`
      const value = up.evaluate<number[]>(`MAG_Data[${i}].fits[${j}].value`)
      expect(value, `upstream MAG ${i} motor source ${j}`).toEqual(
        up.evaluate<number[]>(`linear_interp(${source}.y, ${source}.x, MAG_Data[0].time)`)
      )
      const own = up.evaluate<number[]>(`linear_interp(${source}.y, ${source}.x, MAG_Data[${i}].time)`)
      if (JSON.stringify(own) === JSON.stringify(value)) continue
      ;(up.context as Record<string, unknown>)['__own'] = own
      up.evaluate(`MAG_Data[${i}].fits[${j}].value = __own`)
      patched++
    }
  }
  if (patched > 0) {
    up.alerts.length = 0
    up.evaluate('calculate()')
  }
  return patched
}
