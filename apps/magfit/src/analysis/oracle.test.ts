/**
 * End-to-end oracle: run upstream MAGFit (magfit.js in a vm with a stub DOM) and the port on the
 * same logs and require identical results at every stage.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { expectSameArray, expectSameNumber } from '../test-utils/compare.js'
import { buildSyntheticMagLog } from '../test-utils/synthetic-mag-log.js'
import { createUpstreamMagfit, readFixture, upstreamLoad, type UpstreamMagfit } from '../test-utils/upstream.js'
import { FIT_KIND_NAMES, FIT_KINDS, type FitResult } from './fit.js'
import { loadMagFitLog, type MagFitLog } from './load.js'
import { runMagFit, type MagFitResult } from './magfit.js'
import type { OrientationOption } from './orientation.js'
import { buildParamFile, checkParams, type ParamFileEntry } from './params.js'

type Series = { x: number[]; y: number[]; z: number[] }
interface UpFit extends Partial<Series> {
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
interface UpCompass {
  time: number[]
  raw: Series
  rotate: boolean
  rotation?: number
  orig: Series & { error: number[]; yaw: number[]; mean_error: number }
  expected: Series & { bins: number[] }
  quaternion: { q1: number[]; q2: number[]; q3: number[]; q4: number[]; yaw: number[] }
  coverage: { value: number }
  params: Record<string, number | number[] | undefined>
  fits: ({ name: string; type: number } & Record<'offsets' | 'scale' | 'iron', UpFit>)[]
}

function compareSeries(
  mine: { x: ArrayLike<number>; y: ArrayLike<number>; z: ArrayLike<number> },
  theirs: Series,
  label: string
): void {
  expectSameArray(mine.x, theirs.x, `${label}.x`)
  expectSameArray(mine.y, theirs.y, `${label}.y`)
  expectSameArray(mine.z, theirs.z, `${label}.z`)
}

function compareFit(mine: FitResult, theirs: UpFit, label: string): void {
  expect(mine.valid, `${label} valid`).toBe(theirs.valid === 1)
  const p = mine.params
  expectSameArray(p.offsets, theirs.params.offsets, `${label} offsets`)
  expectSameArray(p.diagonals, theirs.params.diagonals, `${label} diagonals`)
  expectSameArray(p.offDiagonals, theirs.params.off_diagonals, `${label} offDiagonals`)
  expectSameArray(p.motor, theirs.params.motor, `${label} motor`)
  expectSameNumber(p.scale, theirs.params.scale, `${label} scale`)
  expect(p.orientation, `${label} orientation`).toBe(theirs.params.orientation)
  expect(p.fitType, `${label} fitType`).toBe(theirs.params.fit_type)
  if (!mine.valid) return
  compareSeries(mine.field, theirs as Series, `${label} field`)
  expectSameArray(mine.error, theirs.error, `${label} error`)
  expectSameNumber(mine.meanError, theirs.mean_error, `${label} meanError`)
  expectSameArray(mine.yaw, theirs.yaw, `${label} yaw`)
}

function compareAll(up: UpstreamMagfit, data: MagFitLog, result: MagFitResult): void {
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
      for (const kind of FIT_KINDS) compareFit(g.fits[kind], theirs.fits[j]![kind], `${label} ${g.name} ${kind}`)
    })
  }
}

/** Entries upstream would save: the first shown selection of each compass. */
function upstreamEntries(up: UpstreamMagfit, result: MagFitResult): ParamFileEntry[] {
  const entries: ParamFileEntry[] = []
  result.compasses.forEach((c, i) => {
    if (c === undefined) return
    const selection = up.evaluate<{ name: string; show: boolean }[]>(`MAG_Data[${i}].param_selection`).find((s) => s.show)
    if (selection === undefined) return
    for (const g of c.groups) {
      for (const kind of FIT_KINDS) {
        if (`${FIT_KIND_NAMES[kind]}, ${g.name}` !== selection.name) continue
        entries.push({ compassIndex: i, names: c.prepared.compass.names, params: g.fits[kind].params, fitName: selection.name })
      }
    }
  })
  return entries
}

function compareParamFile(up: UpstreamMagfit, result: MagFitResult): void {
  const entries = upstreamEntries(up, result)
  up.saved.length = 0
  up.alerts.length = 0
  up.confirms.length = 0
  up.evaluate('save_parameters()')
  const built = buildParamFile(entries)
  if (up.saved.length === 0) {
    expect(built.ok).toBe(false)
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

describe.each([
  ['copter-sitl.bin', () => readFixture('copter-sitl.bin')],
  ['synthetic log', () => buildSyntheticMagLog()]
])('oracle: %s', (name, getBuffer) => {
  let up: UpstreamMagfit
  let data: MagFitLog

  beforeAll(async () => {
    const buffer = getBuffer()
    up = await createUpstreamMagfit()
    await upstreamLoad(up, buffer)
    data = loadMagFitLog(buffer)
  })

  it('matches upstream load and default calculation', () => {
    const result = runMagFit(data, {
      timeStart: data.startTime,
      timeEnd: data.endTime,
      attitudeSource: data.defaultAttitudeSource!
    })
    compareAll(up, data, result)
    // Orientation warnings upstream raises with alert() are reported as data by the port.
    const warnings = result.compasses.flatMap((c) => c?.orientationCheck?.warning ?? [])
    expect(warnings).toEqual(up.alerts)
    compareParamFile(up, result)
  })

  it('matches upstream with a reduced window and orientation fixing', () => {
    const timeStart = data.startTime + (data.endTime - data.startTime) * 0.2
    const timeEnd = data.startTime + (data.endTime - data.startTime) * 0.85
    up.element('TimeStart')['value'] = String(timeStart)
    up.element('TimeEnd')['value'] = String(timeEnd)
    const orientation: OrientationOption[] = ['fix90', 'fix45', 'fix90']
    orientation.forEach((o, i) => up.setRadio(`input[name="MAG${i}orientation"]:checked`, o === 'fix90' ? '1' : '2'))
    up.alerts.length = 0
    up.evaluate('calculate()')
    // Upstream parses the input values back from strings.
    const result = runMagFit(data, {
      timeStart: parseFloat(String(timeStart)),
      timeEnd: parseFloat(String(timeEnd)),
      attitudeSource: data.defaultAttitudeSource!,
      orientation
    })
    compareAll(up, data, result)
    expect(up.alerts).toEqual([])
    compareParamFile(up, result)
    // On the synthetic log the orientation fix of compass 1 makes upstream ask for confirmation.
    if (name === 'synthetic log') expect(up.confirms[0]).toContain('changed from 0:None to 4:Yaw180')
  })
})

describe('oracle: motor compensation parameter file', () => {
  it('writes COMPASS_MOTCT 2 for a current fit like upstream', async () => {
    const buffer = buildSyntheticMagLog()
    const up = await createUpstreamMagfit()
    await upstreamLoad(up, buffer)
    const data = loadMagFitLog(buffer)
    const result = runMagFit(data, {
      timeStart: data.startTime,
      timeEnd: data.endTime,
      attitudeSource: data.defaultAttitudeSource!
    })
    // Select the current-compensated iron fit for compass 2 the way update_hidden does.
    const name = 'Offsets and iron, Battery 1 current'
    up.evaluate(`(() => {
      const sel = MAG_Data[1].param_selection
      const i = sel.findIndex((s) => s.name == ${JSON.stringify(name)})
      const s = sel.splice(i, 1)[0]
      s.show = true
      sel.splice(0, 0, s)
    })()`)
    compareParamFile(up, result)
    expect(up.saved[0]).toContain('COMPASS_MOTCT,2\n')
    expect(up.saved[0]).toContain('COMPASS_MOT2_Z,')
  })
})

describe('oracle sanity', () => {
  it('exercises the interesting paths on the synthetic log', async () => {
    const buffer = buildSyntheticMagLog()
    const up = await createUpstreamMagfit()
    await upstreamLoad(up, buffer)
    const data = loadMagFitLog(buffer)
    const result = runMagFit(data, {
      timeStart: data.startTime,
      timeEnd: data.endTime,
      attitudeSource: data.defaultAttitudeSource!,
      orientation: ['fix90']
    })
    // Wrong orientation of compass 1 is detected and fixed, compass 3 is confirmed.
    expect(result.compasses[0]!.orientationCheck!.isCorrect).toBe(false)
    expect(result.compasses[0]!.orientation).toBe(4)
    expect(result.compasses[2]!.orientationCheck!.isCorrect).toBe(true)
    // Every fit kind is valid for at least one compass, and a motor fit exists.
    for (const kind of FIT_KINDS) expect(result.compasses.some((c) => c!.groups.some((g) => g.fits[kind].valid))).toBe(true)
    expect(result.compasses[1]!.groups[1]!.type).toBe(2)
    compareParamFile(
      up,
      runMagFit(data, { timeStart: data.startTime, timeEnd: data.endTime, attitudeSource: 0 + data.defaultAttitudeSource! })
    )
    expect(up.saved.length).toBe(1)
  })
})
