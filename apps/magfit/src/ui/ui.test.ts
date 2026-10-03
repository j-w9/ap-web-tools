import { describe, expect, it } from 'vitest'
import { buildSyntheticMagLog } from '../test-utils/synthetic-mag-log.js'
import { createUpstreamMagfit, upstreamLoad } from '../test-utils/upstream.js'
import { loadMagFitLog } from '../analysis/load.js'
import { runMagFit } from '../analysis/magfit.js'
import {
  compassCalibrations,
  errorBarsVisible,
  fitId,
  initialSelection,
  reconcileSelection,
  savedCalibration,
  toggleCalibration,
  type CompassSelection
} from './calibrations.js'
import { paramRows } from './params-table.js'
import { nextSaveStep, saveCandidates } from './save.js'

const buffer = buildSyntheticMagLog()
const data = loadMagFitLog(buffer)
const run = (orientation: ('check' | 'fix90')[] = []) =>
  runMagFit(data, {
    timeStart: data.startTime,
    timeEnd: data.endTime,
    attitudeSource: data.defaultAttitudeSource ?? 0,
    orientation
  })
const result = run()

describe('calibration selection', () => {
  const c1 = result.compasses[1]
  if (!c1) throw new Error('compass 2 missing')
  const cals = compassCalibrations(c1)

  it('lists the existing calibration then every fit in upstream order', () => {
    expect(cals.map((c) => c.label)).toEqual([
      'Existing calibration',
      'Offsets, No motor comp',
      'Offsets and scale, No motor comp',
      'Offsets and iron, No motor comp',
      'Offsets, Battery 1 current',
      'Offsets and scale, Battery 1 current',
      'Offsets and iron, Battery 1 current'
    ])
  })

  it('starts like upstream: existing plus the default fit, which is saved', () => {
    const sel = initialSelection(c1)
    expect([...sel.shown]).toEqual(['existing', fitId(0, 'offsets')])
    expect(savedCalibration(sel, cals)?.label).toBe('Offsets, No motor comp')
  })

  it('saves the most recently ticked fit and falls back when it is unticked', () => {
    let sel: CompassSelection = initialSelection(c1)
    sel = toggleCalibration(sel, fitId(1, 'iron'), true)
    expect(savedCalibration(sel, cals)?.label).toBe('Offsets and iron, Battery 1 current')
    // Like upstream, recalculating rebuilds the priority order: the first ticked fit in upstream
    // order is saved again, not the last one picked.
    const after = reconcileSelection(sel, c1)
    expect(savedCalibration(after, cals)?.label).toBe('Offsets, No motor comp')
    sel = toggleCalibration(sel, fitId(1, 'iron'), false)
    expect(savedCalibration(sel, cals)?.label).toBe('Offsets, No motor comp')
    sel = toggleCalibration(sel, fitId(0, 'offsets'), false)
    expect(savedCalibration(sel, cals)).toBeUndefined()
  })

  it('keeps ticks on fits that become invalid, with their stale plot data, and can save them', () => {
    const c0 = result.compasses[0]
    if (!c0) throw new Error('compass 1 missing')
    const cals0 = compassCalibrations(c0)
    const iron = cals0.find((c) => c.id === fitId(0, 'iron'))
    expect(iron?.valid).toBe(false)
    let sel = toggleCalibration(initialSelection(c0), fitId(0, 'offsets'), false)
    sel = toggleCalibration(sel, fitId(0, 'iron'), true)
    const after = reconcileSelection(sel, c0)
    expect(after.shown.has(fitId(0, 'iron'))).toBe(true)
    // Upstream order puts offsets first again, re-ticked by default.
    expect(savedCalibration(after, cals0)?.id).toBe(fitId(0, 'offsets'))
    const onlyIron = toggleCalibration(after, fitId(0, 'offsets'), false)
    expect(savedCalibration(onlyIron, cals0)?.id).toBe(fitId(0, 'iron'))
    // An invalid fit keeps the plot data it had when it was last valid (here: borrowed from a
    // calculation where the same fit id was valid).
    const previous = compassCalibrations(c1)
    const before = previous.find((c) => c.id === fitId(0, 'iron'))
    if (!before?.valid) throw new Error('expected a valid iron fit on compass 2')
    const now = compassCalibrations(c0, previous).find((c) => c.id === fitId(0, 'iron'))
    expect(now?.valid === false ? now.stale?.field : undefined).toBe(before.field)
    expect(now?.valid === false ? compassCalibrations(c0).find((c) => c.id === now.id) : undefined).toMatchObject({
      stale: undefined
    })
  })

  it('hides a compass bar group only once every tick has been removed', () => {
    let sel = initialSelection(c1)
    expect(errorBarsVisible(sel)).toBe(true)
    sel = toggleCalibration(sel, 'existing', false)
    expect(errorBarsVisible(sel)).toBe(true)
    sel = toggleCalibration(sel, fitId(0, 'offsets'), false)
    expect(errorBarsVisible(sel)).toBe(false)
    expect(errorBarsVisible(reconcileSelection(sel, c1))).toBe(true)
  })
})

describe('parameter table and save plan', () => {
  it('writes the same file as upstream for the default selection', async () => {
    const up = await createUpstreamMagfit()
    await upstreamLoad(up, buffer)
    up.evaluate('save_parameters()')
    const selections = result.compasses.map((c) => (c ? initialSelection(c) : undefined))
    const candidates = saveCandidates(result.compasses, selections, ['noChange', 'noChange', 'noChange'])
    const answers = up.confirms.map(() => true)
    const step = nextSaveStep(candidates, answers)
    expect(step.kind === 'done' && step.file.ok && step.file.text).toBe(up.saved[0])
    expect(candidates.flatMap((c) => (c.warning === '' ? [] : [c.warning]))).toEqual(up.confirms)
  })

  it('reports orientation changes and use overrides', () => {
    const fixed = run(['fix90'])
    const selections = fixed.compasses.map((c) => (c ? initialSelection(c) : undefined))
    const candidates = saveCandidates(fixed.compasses, selections, ['dontUse', 'noChange', 'use'])
    const first = nextSaveStep(candidates, [])
    expect(first.kind === 'confirm' && first.text).toContain('changed from 0:None to 4:Yaw180')
    const step = nextSaveStep(
      candidates,
      candidates.flatMap((c) => (c.warning === '' ? [] : [true]))
    )
    const text = step.kind === 'done' && step.file.ok ? step.file.text : ''
    expect(text).toContain('COMPASS_USE,0\n')
    expect(text).toContain('COMPASS_USE3,1\n')
    // Declining the confirmation leaves that compass out, as upstream's confirm() does.
    const declined = nextSaveStep(candidates, [false, ...candidates.slice(1).flatMap((c) => (c.warning === '' ? [] : [true]))])
    const declinedText = declined.kind === 'done' && declined.file.ok ? declined.file.text : ''
    expect(declinedText).not.toContain('COMPASS_USE,0\n')
    expect(declinedText).toContain('COMPASS_USE3,1\n')
  })

  it('highlights changed values and shows existing values when nothing is selected', () => {
    const c0 = result.compasses[0]
    const c1 = result.compasses[1]
    if (!c0 || !c1) throw new Error('compass missing')
    const sel = savedCalibration(initialSelection(c0), compassCalibrations(c0))
    const rows = paramRows([
      { names: c0.prepared.compass.names, existing: c0.prepared.compass.params, selected: sel?.params },
      { names: c1.prepared.compass.names, existing: c1.prepared.compass.params, selected: undefined }
    ])
    const offsetX = rows[0]
    expect(offsetX?.label).toBe('Offset X')
    expect(offsetX?.cells[0]?.name).toBe('COMPASS_OFS_X')
    expect(offsetX?.cells[0]?.changed).toBe(true)
    expect(offsetX?.cells[1]).toEqual({ name: 'COMPASS_OFS2_X', text: '-100', changed: false })
    expect(rows.at(-1)?.cells[1]?.text).toBe('0:None')
  })
})
