import { describe, expect, it } from 'vitest'
import { PRESETS } from './presets.js'
import {
  INITIAL_SETUP,
  NO_LOG,
  SIZE_ALERT,
  generateClick,
  generateFields,
  readSlot,
  selectModel,
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
    expect(readSlot(setup, 'ss', { kind: 'output', index: 1 })?.message).toBe('None')
  })

  it('a preset fills sizes, signals, parameters, bounds and matrices', () => {
    const { setup } = generateFields(ss({ preset: 'MR_Roll' }), LOG)
    expect(setup.ss.order).toBe('4')
    expect(setup.ss.paramNames).toEqual(PRESETS.MR_Roll.params)
    expect(readSlot(setup, 'ss', { kind: 'input' })).toEqual({ message: 'RATE', field: 'ROut' })
    expect(readSlot(setup, 'ss', { kind: 'output', index: 0 })).toMatchObject({
      field: 'Gx',
      multiplierOn: true,
      multiplier: '0.01745'
    })
    expect(readSlot(setup, 'ss', { kind: 'output', index: 1 })).toMatchObject({ field: 'Ay', compensationOn: true })
    expect(setup.ss.matrices?.a).toEqual(PRESETS.MR_Roll.a)
  })

  it('a preset whose message is not in the log leaves the picker empty, as select.value does', () => {
    const noSidd: PickerOptions = { ...LOG, hasMessage: (m) => m === 'RATE' }
    const { setup } = generateFields(ss({ preset: 'MR_Yaw' }), noSidd)
    expect(readSlot(setup, 'ss', { kind: 'output', index: 0 })).toMatchObject({ message: '', field: '' })
  })

  it('a preset with no log loaded stops where upstream throws', () => {
    const outcome = generateFields(ss({ preset: 'MR_Yaw' }), NO_LOG)
    expect(outcome.error).not.toBeNull()
    expect(outcome.setup.ss.paramNames).toEqual(PRESETS.MR_Yaw.params)
    expect(outcome.setup.ss.matrices).toBeNull()
  })

  // Proven upstream bug fixed (docs/bug-proofs/sysid.md, row 2). Upstream's result for this input
  // (the preset fills the hidden transfer function form) is asserted in proofs/sysid
  // ("after Transfer function was selected, the Multirotor Yaw preset fills the hidden form").
  it('after opening the transfer function form, presets still write into the state space form', () => {
    const tf = selectModel(INITIAL_SETUP, 'transfer-function', LOG)
    const { setup } = generateFields(ss({ preset: 'MR_Yaw' }, tf), LOG)
    expect(setup.ss.signals?.input).toEqual({ message: 'RATE', field: 'YOut' })
    expect(setup.tfSignals?.input).toEqual({ message: 'None', field: 'None' })
    expect(generateFields(ss({ preset: 'MR_Yaw' }), LOG).setup.ss.signals).toEqual(setup.ss.signals)
  })
})

// Upstream's ss_select change handler adds another "Generate fields" click handler each time
// State space is selected (docs/bug-proofs/sysid.md, row 4, NOT PROVEN, so reproduced). Upstream's
// two alerts for this sequence are asserted in proofs/sysid ("after ss, tf, ss one click runs the
// generator twice").
describe('generateClick (every installed handler runs)', () => {
  const toggled = (patch: Partial<Setup['ss']>): Setup => {
    let s = selectModel(INITIAL_SETUP, 'state-space', LOG)
    s = selectModel(s, 'transfer-function', LOG)
    return ss(patch, s)
  }

  it('counts one handler per State space selection', () => {
    expect(INITIAL_SETUP.generateHandlers).toBe(0)
    expect(ss({}).generateHandlers).toBe(1)
    expect(toggled({}).generateHandlers).toBe(2)
  })

  it('a single handler raises one alert', () => {
    expect(generateClick(ss({ outputs: '' }), LOG).alerts).toEqual([SIZE_ALERT])
  })

  it('after ss, tf, ss a bad click raises the alert twice', () => {
    expect(generateClick(toggled({ outputs: '' }), LOG).alerts).toEqual([SIZE_ALERT, SIZE_ALERT])
  })

  it('after ss, tf, ss a valid click leaves the fields as one run does', () => {
    const setup = toggled({ preset: 'MR_Roll' })
    const twice = generateClick(setup, LOG)
    expect(twice.alerts).toEqual([])
    expect(twice.setup).toEqual(generateFields(setup, LOG).setup)
  })
})
