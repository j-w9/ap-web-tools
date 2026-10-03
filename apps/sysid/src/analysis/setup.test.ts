import { describe, expect, it } from 'vitest'
import { PRESETS } from './presets.js'
import {
  INITIAL_SETUP,
  NO_LOG,
  SIZE_ALERT,
  generateFields,
  readSlot,
  selectModel,
  slotOwner,
  type PickerOptions,
  type Setup
} from './setup.js'

const LOG: PickerOptions = {
  loaded: true,
  fieldsOf: (m) => (m === 'RATE' ? ['TimeUS', 'ROut', 'YOut'] : m === 'SIDD' ? ['TimeUS', 'Gx', 'Gz', 'Ay'] : undefined),
  hasMessage: (m) => m === 'RATE' || m === 'SIDD'
}

const ss = (patch: Partial<Setup['ss']>, from: Setup = INITIAL_SETUP): Setup => {
  const s = selectModel(from, 'state-space', LOG)
  return { ...s, ss: { ...s.ss, ...patch } }
}

describe('generateFields (upstream "Generate fields")', () => {
  it('manual entry with no output count alerts', () => {
    const outcome = generateFields(ss({ outputs: '' }), LOG)
    expect(outcome.alert).toBe(SIZE_ALERT)
    expect(outcome.setup.ss.signals).toBeNull()
  })

  it('a bad order alerts after the other fields are created', () => {
    const outcome = generateFields(ss({ outputs: '2', params: '3', constraints: '1', order: '0' }), LOG)
    expect(outcome.alert).toBe(SIZE_ALERT)
    expect(outcome.setup.ss.signals?.outputs).toHaveLength(2)
    expect(outcome.setup.ss.paramNames).toHaveLength(3)
    expect(outcome.setup.ss.matrices).toBeNull()
  })

  it('manual entry creates empty tables of the given sizes', () => {
    const { setup, alert } = generateFields(ss({ outputs: '2', params: '', constraints: '', order: '3' }), LOG)
    expect(alert).toBeNull()
    expect(setup.ss.matrices?.a).toEqual([
      ['', '', ''],
      ['', '', ''],
      ['', '', '']
    ])
    expect(setup.ss.matrices?.h0).toHaveLength(2)
    expect(setup.ss.paramNames).toEqual([])
    expect(readSlot(setup, { kind: 'output', index: 1 })?.message).toBe('None')
  })

  it('a preset fills sizes, signals, parameters, bounds and matrices', () => {
    const { setup } = generateFields(ss({ preset: 'MR_Roll' }), LOG)
    expect(setup.ss.order).toBe('4')
    expect(setup.ss.paramNames).toEqual(PRESETS.MR_Roll.params)
    expect(readSlot(setup, { kind: 'input' })).toEqual({ message: 'RATE', field: 'ROut' })
    expect(readSlot(setup, { kind: 'output', index: 0 })).toMatchObject({
      field: 'Gx',
      multiplierOn: true,
      multiplier: '0.01745'
    })
    expect(readSlot(setup, { kind: 'output', index: 1 })).toMatchObject({ field: 'Ay', compensationOn: true })
    expect(setup.ss.matrices?.a).toEqual(PRESETS.MR_Roll.a)
  })

  it('a preset whose message is not in the log leaves the picker empty, as select.value does', () => {
    const noSidd: PickerOptions = { ...LOG, hasMessage: (m) => m === 'RATE' }
    const { setup } = generateFields(ss({ preset: 'MR_Yaw' }), noSidd)
    expect(readSlot(setup, { kind: 'output', index: 0 })).toMatchObject({ message: '', field: '' })
  })

  it('a preset with no log loaded stops where upstream throws', () => {
    const outcome = generateFields(ss({ preset: 'MR_Yaw' }), NO_LOG)
    expect(outcome.error).not.toBeNull()
    expect(outcome.setup.ss.paramNames).toEqual(PRESETS.MR_Yaw.params)
    expect(outcome.setup.ss.matrices).toBeNull()
  })

  it('after opening the transfer function form, presets write into its input and first output', () => {
    const tf = selectModel(INITIAL_SETUP, 'transfer-function', LOG)
    const { setup } = generateFields(ss({ preset: 'MR_Yaw' }, tf), LOG)
    expect(slotOwner(setup, { kind: 'input' })).toBe('tf')
    expect(setup.tfSignals?.input).toEqual({ message: 'RATE', field: 'YOut' })
    expect(setup.ss.signals?.input).toEqual({ message: 'None', field: 'None' })
  })
})
