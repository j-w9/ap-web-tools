/**
 * End-to-end oracle: run upstream MAGFit (magfit.js in a vm with a stub DOM) and the port on the
 * same logs and require identical results at every stage.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { compareAll, compareParamFile, correctUpstreamMotorTimeBase } from '../test-utils/oracle-compare.js'
import { buildSyntheticMagLog } from '../test-utils/synthetic-mag-log.js'
import { createUpstreamMagfit, readFixture, upstreamLoad, type UpstreamMagfit } from '../test-utils/upstream.js'
import { FIT_KINDS } from './fit.js'
import { loadMagFitLog, type MagFitLog } from './load.js'
import { motorSourceAt } from './motor.js'
import { runMagFit } from './magfit.js'
import type { OrientationOption } from './orientation.js'
import {
  compassCalibrations,
  initialSelection,
  reconcileSelection,
  savedCalibration,
  toggleCalibration,
  fitId
} from '../ui/calibrations.js'

describe.each([
  ['copter-sitl.bin', () => readFixture('copter-sitl.bin')],
  ['synthetic log', () => buildSyntheticMagLog()],
  // Compasses sampled at different times and rates: upstream resamples the battery current at
  // compass 1's times for every compass (proven bug, fixed: see correctUpstreamMotorTimeBase), and
  // compass 3 has half the samples.
  [
    'synthetic log, compasses on different time bases',
    () => buildSyntheticMagLog({ duration: 60, magOffsetUs: [0, 37_000, 61_000], magEvery: [1, 1, 2] })
  ],
  // Missing parameters read as undefined upstream and NaN in the port.
  [
    'synthetic log, missing parameters',
    () =>
      buildSyntheticMagLog({
        duration: 60,
        omitParams: ['COMPASS_ORIENT', 'COMPASS_ORIENT2', 'COMPASS_SCALE2', 'EK3_PRIMARY']
      })
  ]
])('oracle: %s', (name, getBuffer) => {
  let up: UpstreamMagfit
  let data: MagFitLog

  beforeAll(async () => {
    const buffer = getBuffer()
    up = await createUpstreamMagfit()
    await upstreamLoad(up, buffer)
    const patched = correctUpstreamMotorTimeBase(up)
    expect(patched > 0).toBe(name === 'synthetic log, compasses on different time bases')
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

describe('oracle: load failures', () => {
  it('stops like upstream when an iron matrix parameter is missing', async () => {
    const buffer = buildSyntheticMagLog({ duration: 20, omitParams: ['COMPASS_DIA3_X'] })
    const up = await createUpstreamMagfit()
    await expect(upstreamLoad(up, buffer)).rejects.toThrow('Input data contains non-numeric values')
    expect(() => loadMagFitLog(buffer)).toThrow('Input data contains non-numeric values')
  })

  it('loads a compass with no iron parameters (upstream crashes: proven bug, fixed)', async () => {
    // docs/bug-proofs/magfit.md row 4, proofs/magfit/crashes.test.ts.
    const names = ['X', 'Y', 'Z'].flatMap((a) => [`COMPASS_DIA_${a}`, `COMPASS_ODI_${a}`])
    const buffer = buildSyntheticMagLog({ duration: 30, omitParams: names })
    const upFails = await createUpstreamMagfit()
    await expect(upstreamLoad(upFails, buffer)).rejects.toThrow('Input data contains non-numeric values')
    // Corrected: the iron step is skipped, as upstream does for all-zero diagonals. Compare with
    // upstream on the same log with those parameters set to 0.
    const zeros = buildSyntheticMagLog({ duration: 30, paramValues: Object.fromEntries(names.map((n) => [n, 0])) })
    const up = await createUpstreamMagfit()
    await upstreamLoad(up, zeros)
    const data = loadMagFitLog(buffer)
    expect(data.compasses[0]!.params.diagonals.every(Number.isNaN)).toBe(true)
    compareAll(
      up,
      data,
      runMagFit(data, { timeStart: data.startTime, timeEnd: data.endTime, attitudeSource: data.defaultAttitudeSource! })
    )
  })

  it('still stops like upstream when only part of an iron matrix is missing', async () => {
    const buffer = buildSyntheticMagLog({ duration: 20, omitParams: ['COMPASS_DIA2_X'] })
    const up = await createUpstreamMagfit()
    await expect(upstreamLoad(up, buffer)).rejects.toThrow('Input data contains non-numeric values')
    expect(() => loadMagFitLog(buffer)).toThrow('Input data contains non-numeric values')
  })

  it('loads a battery current without compass 1 (upstream crashes: proven bug, fixed)', async () => {
    const buffer = buildSyntheticMagLog({ duration: 20, compasses: [1, 2] })
    const up = await createUpstreamMagfit()
    await expect(upstreamLoad(up, buffer)).rejects.toThrow("Cannot read properties of undefined (reading 'time')")
    const data = loadMagFitLog(buffer)
    const source = data.motorSources[0]!
    expect(source.atCompass[0]).toBeUndefined()
    expect(Array.from(source.atCompass[1]!)).toEqual(Array.from(motorSourceAt(source, data.compasses[1]!.time)))
    expect(Array.from(source.atCompass[2]!)).toEqual(Array.from(motorSourceAt(source, data.compasses[2]!.time)))
    const result = runMagFit(data, {
      timeStart: data.startTime,
      timeEnd: data.endTime,
      attitudeSource: data.defaultAttitudeSource!
    })
    expect(result.compasses[1]!.groups.map((g) => g.name)).toEqual(['No motor comp', 'Battery 1 current'])
    expect(result.compasses[1]!.groups[1]!.fits.offsets.valid).toBe(true)
  })

  it('reports a missing location with the upstream text', async () => {
    const buffer = buildSyntheticMagLog({ duration: 20, origin: false })
    const up = await createUpstreamMagfit()
    await upstreamLoad(up, buffer)
    expect(up.alerts).toEqual(['Could not get earth field for Lat: undefined Lng: undefined'])
    expect(() => loadMagFitLog(buffer)).toThrow(up.alerts[0])
  })
})

describe('oracle: analysis window edge cases', () => {
  // Upstream parses the TimeStart/TimeEnd inputs with parseFloat and fits whatever range of
  // samples that gives, including an empty input (NaN) and an end before the start.
  let up: UpstreamMagfit
  let data: MagFitLog
  beforeAll(async () => {
    const buffer = buildSyntheticMagLog({ duration: 30 })
    up = await createUpstreamMagfit()
    await upstreamLoad(up, buffer)
    data = loadMagFitLog(buffer)
  })

  it.each([
    ['equal start and end', '15', '15'],
    ['end just before start, inside one sample interval', '15.05', '15.02'],
    ['empty inputs', '', ''],
    ['empty start input', '', '20'],
    ['empty end input', '10', ''],
    ['short window', '10', '13.3'],
    ['end well before start', '20', '10']
  ])('%s', (_label, start, end) => {
    up.element('TimeStart')['value'] = start
    up.element('TimeEnd')['value'] = end
    let upstreamError: unknown
    try {
      up.evaluate('calculate()')
    } catch (e) {
      upstreamError = e
    }
    const run = () =>
      runMagFit(data, { timeStart: parseFloat(start), timeEnd: parseFloat(end), attitudeSource: data.defaultAttitudeSource! })
    if (upstreamError !== undefined) {
      expect(run).toThrow()
      return
    }
    compareAll(up, data, run())
  })
})

describe('oracle: calibration selection across a recalculation', () => {
  it('keeps the last pick after recalculating (upstream resets it), then matches upstream', async () => {
    const buffer = buildSyntheticMagLog({ duration: 60 })
    const up = await createUpstreamMagfit()
    await upstreamLoad(up, buffer)
    const data = loadMagFitLog(buffer)
    const options = { timeStart: data.startTime, timeEnd: data.endTime, attitudeSource: data.defaultAttitudeSource! }
    const result = runMagFit(data, options)
    const c1 = result.compasses[1]!

    // Tick "Offsets and iron, Battery 1 current" of compass 2 through upstream update_hidden.
    const tick = (group: number, kind: string, checked: boolean): void => {
      up.evaluate(`(() => {
        const show = MAG_Data[1].fits[${group}].${kind}.show
        const name = fit_types.${kind} + ', ' + MAG_Data[1].fits[${group}].name
        show.checked = ${checked}
        show.dataset = { index: String(MAG_Data[1].param_selection.find((s) => s.name == name).index) }
        update_hidden(show)
      })()`)
    }
    const upSaved = (): string | undefined =>
      up.evaluate<{ name: string; show: boolean }[]>('MAG_Data[1].param_selection').find((s) => s.show)?.name

    tick(1, 'iron', true)
    let sel = toggleCalibration(initialSelection(c1), fitId(1, 'iron'), true)
    expect(savedCalibration(sel, compassCalibrations(c1))?.label).toBe(upSaved())

    // Recalculating: upstream rebuilds param_selection in fit order and saves the first ticked fit
    // in that order, contrary to its tooltip; the port keeps the pick order (proven bug, fixed:
    // docs/bug-proofs/magfit.md row 3, proofs/magfit/selection.test.ts).
    up.evaluate('calculate()')
    const again = runMagFit(data, options).compasses[1]!
    sel = reconcileSelection(sel, again)
    expect(upSaved()).toBe('Offsets, No motor comp')
    expect(savedCalibration(sel, compassCalibrations(again))?.label).toBe('Offsets and iron, Battery 1 current')

    // Unticking the first shown fit falls back to the next ticked one in priority order.
    tick(0, 'offsets', false)
    sel = toggleCalibration(sel, fitId(0, 'offsets'), false)
    expect(savedCalibration(sel, compassCalibrations(again))?.label).toBe(upSaved())
  })
})
