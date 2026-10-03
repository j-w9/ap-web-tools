import { describe, expect, it } from 'vitest'
import { buildSyntheticMagLog } from '../test-utils/synthetic-mag-log.js'
import { createUpstreamMagfit, upstreamLoad } from '../test-utils/upstream.js'
import { loadMagFitLog } from '../analysis/load.js'
import { runMagFit } from '../analysis/magfit.js'
import {
  compassCalibrations,
  fitId,
  initialSelection,
  reconcileSelection,
  savedCalibration,
  toggleCalibration,
  type CompassSelection
} from './calibrations.js'
import { paramRows } from './params-table.js'
import { planSave } from './save.js'

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
    const after = reconcileSelection(sel, c1)
    expect(savedCalibration(after, cals)?.label).toBe('Offsets and iron, Battery 1 current')
    sel = toggleCalibration(sel, fitId(1, 'iron'), false)
    expect(savedCalibration(sel, cals)?.label).toBe('Offsets, No motor comp')
    sel = toggleCalibration(sel, fitId(0, 'offsets'), false)
    expect(savedCalibration(sel, cals)).toBeUndefined()
  })

  it('drops picks that become invalid', () => {
    const c0 = result.compasses[0]
    if (!c0) throw new Error('compass 1 missing')
    const sel = toggleCalibration(initialSelection(c0), fitId(0, 'iron'), true)
    expect(reconcileSelection(sel, c0).shown.has(fitId(0, 'iron'))).toBe(false)
  })
})

describe('parameter table and save plan', () => {
  it('writes the same file as upstream for the default selection', async () => {
    const up = await createUpstreamMagfit()
    await upstreamLoad(up, buffer)
    up.evaluate('save_parameters()')
    const selections = result.compasses.map((c) => (c ? initialSelection(c) : undefined))
    const plan = planSave(result.compasses, selections, ['noChange', 'noChange', 'noChange'])
    expect(plan.file.ok && plan.file.text).toBe(up.saved[0])
    expect(plan.warnings).toEqual(up.confirms)
  })

  it('reports orientation changes and use overrides', () => {
    const fixed = run(['fix90'])
    const selections = fixed.compasses.map((c) => (c ? initialSelection(c) : undefined))
    const plan = planSave(fixed.compasses, selections, ['dontUse', 'noChange', 'use'])
    expect(plan.warnings[0]).toContain('changed from 0:None to 4:Yaw180')
    expect(plan.file.ok && plan.file.text).toContain('COMPASS_USE,0\n')
    expect(plan.file.ok && plan.file.text).toContain('COMPASS_USE3,1\n')
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
