import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { LogWriter } from '@apwt/dataflash/testing'
import { buildSyntheticSidLog } from '../test-utils/synthetic-sid.js'
import { instanceAwareParser, runUpstream, upstreamParse, type UpstreamParser } from '../test-utils/upstream.js'
import type { StateSpaceInputs, TransferFunctionInputs } from '../python/runtime.js'
import { MissingDataError } from './columns.js'
import { loadLog, type SysIdLog } from './log.js'
import { stateSpaceInputs, transferFunctionInputs } from './request.js'
import { INITIAL_SETUP, generateFields, onLogLoaded, selectModel, writeSlot, type PickerOptions, type Setup } from './setup.js'

function pickerOptions(log: SysIdLog): PickerOptions {
  const fields = new Map(log.messages.map((m) => [m.name, m.fields]))
  return { loaded: true, fieldsOf: (m) => fields.get(m), hasMessage: (m) => fields.has(m) }
}

/** Expect the port's Python inputs to equal the globals upstream sets (NaN equals NaN). */
function expectSameGlobals(mine: Record<string, unknown>, theirs: Record<string, unknown>) {
  expect(Object.keys(mine).sort()).toEqual(Object.keys(theirs).sort())
  for (const key of Object.keys(theirs)) expect(mine[key], key).toEqual(theirs[key])
}

function tfGlobals(i: TransferFunctionInputs): Record<string, unknown> {
  return {
    input_data: i.inputData,
    output_data: i.outputData,
    time_data: i.timeData,
    numerator: i.numerator,
    denominator: i.denominator,
    symbols: i.symbols,
    t_start: i.tStart,
    t_end: i.tEnd,
    f_start: i.fStart,
    f_end: i.fEnd,
    f_cutoff: i.fCutoff
  }
}

function ssGlobals(i: StateSpaceInputs): Record<string, unknown> {
  return {
    input_data: i.inputData,
    output_data: i.outputData,
    time_data: i.timeData,
    numInputs: i.numInputs,
    numOutputs: i.numOutputs,
    sym_var: i.symVar,
    matrixA: i.matrixA,
    matrixB: i.matrixB,
    matrixH0: i.matrixH0,
    matrixH1: i.matrixH1,
    orderA: i.orderA,
    bounds_array: i.bounds,
    con_str: i.constraints,
    t_start: i.tStart,
    t_end: i.tEnd,
    f_start: i.fStart,
    f_end: i.fEnd,
    f_cutoff: i.fCutoff
  }
}

describe('Python inputs match upstream (synthetic SID log)', () => {
  const bytes = buildSyntheticSidLog()
  let parser: UpstreamParser
  let log: SysIdLog
  let base: Setup

  beforeAll(async () => {
    parser = await upstreamParse(bytes)
    log = loadLog(bytes.slice().buffer)
    base = {
      ...onLogLoaded(INITIAL_SETUP),
      startTime: '8.2',
      endTime: '23.7',
      startFreq: '2',
      endFreq: '60',
      cutoffFreq: '120'
    }
  })

  const tfSetup = (output: Partial<NonNullable<Setup['tfSignals']>['output']>): Setup => {
    let s = selectModel(base, 'transfer-function', pickerOptions(log))
    s = writeSlot(s, 'tf', { kind: 'input' }, (f) => ({ ...f, message: 'RATE', field: 'YOut' }))
    s = writeSlot(s, 'tf', { kind: 'output', index: 0 }, (f) => ({ ...f, message: 'SIDD', field: 'Gz', ...output }))
    return { ...s, tf: { numerator: 'b1*s + b0', denominator: 'a2*s**2 + a1*s + a0', params: 'b1 b0 a2 a1 a0' } }
  }

  it.each([
    ['plain', {}],
    ['multiplier', { multiplierOn: true, multiplier: '0.01745' }],
    ['empty multiplier (ignored)', { multiplierOn: true, multiplier: '' }],
    ['roll compensation', { field: 'Ay', compensationOn: true, compensationAxis: 'Roll' as const }],
    [
      'pitch compensation with multiplier',
      { field: 'Ax', multiplierOn: true, multiplier: '2', compensationOn: true, compensationAxis: 'Pitch' as const }
    ]
  ])('transfer function: %s', async (_, output) => {
    const setup = tfSetup(output)
    const theirs = await runUpstream('tf', parser, setup)
    expectSameGlobals(tfGlobals(transferFunctionInputs(log.log, setup)), theirs.globals)
    expect(theirs.output).toEqual(['File Submitted successfully. Please wait!!!!!!'])
  })

  it('transfer function: window running past the end of ATT gives NaN, as upstream', async () => {
    const setup = { ...tfSetup({ field: 'Ay', compensationOn: true, compensationAxis: 'Roll' as const }), endTime: '25' }
    const mine = transferFunctionInputs(log.log, setup)
    expect(mine.outputData.some(Number.isNaN)).toBe(true)
    expectSameGlobals(tfGlobals(mine), (await runUpstream('tf', parser, setup)).globals)
  })

  it('transfer function: empty and non-numeric times', async () => {
    for (const [startTime, endTime] of [
      ['', '10'],
      ['abc', '12'],
      ['4', '']
    ] as const) {
      const setup = { ...tfSetup({}), startTime, endTime }
      expectSameGlobals(tfGlobals(transferFunctionInputs(log.log, setup)), (await runUpstream('tf', parser, setup)).globals)
    }
  })

  it('transfer function: unselected and empty messages fail where upstream throws', async () => {
    for (const [message, field] of [
      ['None', 'None'],
      ['EMPT', 'Never']
    ] as const) {
      const setup = writeSlot(tfSetup({}), 'tf', { kind: 'input' }, (f) => ({ ...f, message, field }))
      await expect(runUpstream('tf', parser, setup)).rejects.toThrow()
      expect(() => transferFunctionInputs(log.log, setup)).toThrow(MissingDataError)
    }
  })

  // Proven upstream bug fixed (docs/bug-proofs/sysid.md, row 8): upstream offers IMU[0] but
  // `get('IMU[0]', ...)` returns nothing and Submit throws. The port reads instance 0, as upstream
  // would if `get` resolved the name through the parser's own `get_instance`.
  it('transfer function: an instanced message reads that instance (upstream throws)', async () => {
    for (const message of ['IMU[0]', 'IMU[1]']) {
      const setup = writeSlot(tfSetup({}), 'tf', { kind: 'input' }, (f) => ({ ...f, message, field: 'GyrZ' }))
      await expect(runUpstream('tf', parser, setup)).rejects.toThrow("Cannot read properties of undefined (reading 'length')")
      const corrected = instanceAwareParser(parser)
      const mine = transferFunctionInputs(log.log, setup)
      expect(mine.inputData.length).toBeGreaterThan(100)
      expectSameGlobals(tfGlobals(mine), (await runUpstream('tf', corrected, setup)).globals)
    }
  })

  const ssSetup = (preset: 'MR_Yaw' | 'MR_Roll' | 'MR_Pitch' | 'MR_Vertical', openTfFirst: boolean): Setup => {
    const options = pickerOptions(log)
    let s = openTfFirst ? tfSetup({}) : base
    s = selectModel(s, 'state-space', options)
    s = { ...s, ss: { ...s.ss, preset } }
    const outcome = generateFields(s, options)
    expect(outcome.alert).toBeNull()
    expect(outcome.error).toBeNull()
    return outcome.setup
  }

  it.each(['MR_Yaw', 'MR_Roll', 'MR_Pitch', 'MR_Vertical'] as const)('state space preset %s', async (preset) => {
    for (const openTfFirst of [false, true]) {
      const setup = ssSetup(preset, openTfFirst)
      const result = stateSpaceInputs(log.log, setup)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      // With the transfer function form opened first, upstream's preset filled the hidden form and
      // Submit read it back, so upstream ran on the preset's signals all the same. The port keeps
      // them in the state space form (row 2 fix); the page upstream would build is the one without
      // the transfer function form's fields.
      const page = openTfFirst ? { ...setup, tfSignals: null } : setup
      expectSameGlobals(ssGlobals(result.inputs), (await runUpstream('ss', parser, page)).globals)
    }
  })

  // Proven upstream bug fixed (docs/bug-proofs/sysid.md, row 2): after Transfer function has been
  // selected, upstream's state space Submit reads the hidden transfer function fields ("None") and
  // throws. The port reads the state space form, giving what upstream gives when the transfer
  // function form was never opened.
  it('state space: Submit reads its own form after Transfer function was selected (upstream throws)', async () => {
    const options = pickerOptions(log)
    let s = selectModel(base, 'transfer-function', options)
    s = selectModel(s, 'state-space', options)
    s = { ...s, ss: { ...s.ss, outputs: '1', order: '1', params: '1', constraints: '0' } }
    s = generateFields(s, options).setup
    s = writeSlot(s, 'ss', { kind: 'input' }, (f) => ({ ...f, message: 'RATE', field: 'YOut' }))
    s = writeSlot(s, 'ss', { kind: 'output', index: 0 }, (f) => ({ ...f, message: 'SIDD', field: 'Gz' }))
    s = {
      ...s,
      ss: {
        ...s.ss,
        paramNames: ['a'],
        bounds: [{ min: '-1', max: '1' }],
        matrices: s.ss.matrices && { ...s.ss.matrices, a: [['a']], b: [['1']], h0: [['1']], h1: [['0']] }
      }
    }
    expect(s.tfSignals?.input).toEqual({ message: 'None', field: 'None' })
    await expect(runUpstream('ss', parser, s)).rejects.toThrow("Cannot read properties of undefined (reading 'length')")
    const result = stateSpaceInputs(log.log, s)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.inputs.inputData.length).toBeGreaterThan(100)
    expectSameGlobals(ssGlobals(result.inputs), (await runUpstream('ss', parser, { ...s, tfSignals: null })).globals)
  })

  it('state space: sizes edited after generating read missing cells as null and NaN bounds', async () => {
    const setup = ssSetup('MR_Yaw', false)
    const edited: Setup = {
      ...setup,
      ss: {
        ...setup.ss,
        order: '3',
        params: '4',
        constraints: '0',
        bounds: setup.ss.bounds.map((b, i) => (i === 1 ? { min: '', max: 'x' } : b)),
        matrices: setup.ss.matrices && {
          ...setup.ss.matrices,
          a: [
            ['Nr', ' 1e1 '],
            ['', '-wlag']
          ]
        }
      }
    }
    const result = stateSpaceInputs(log.log, edited)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.inputs.constraints).toEqual([[]])
    expectSameGlobals(ssGlobals(result.inputs), (await runUpstream('ss', parser, edited)).globals)
  })

  it('state space: bad output count gives upstream alert', async () => {
    const setup = ssSetup('MR_Yaw', false)
    for (const outputs of ['', '0', '-1']) {
      const edited = { ...setup, ss: { ...setup.ss, outputs } }
      const result = stateSpaceInputs(log.log, edited)
      const theirs = await runUpstream('ss', parser, edited)
      expect(result).toEqual({ ok: false, alert: theirs.alerts[0] })
      expect(theirs.globals).toEqual({})
    }
  })

  it('state space: more outputs than generated fails where upstream throws', async () => {
    const setup = ssSetup('MR_Yaw', false)
    const edited = { ...setup, ss: { ...setup.ss, outputs: '2' } }
    await expect(runUpstream('ss', parser, edited)).rejects.toThrow()
    expect(() => stateSpaceInputs(log.log, edited)).toThrow(MissingDataError)
  })
})

describe('Python inputs match upstream (real SITL log)', () => {
  it('transfer function from RATE to ATT', async () => {
    const raw = readFileSync(resolve(__dirname, '../../../../packages/dataflash/test-fixtures/copter-sitl.bin'))
    const bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
    const parser = await upstreamParse(bytes)
    const log = loadLog(bytes.slice().buffer)
    const range = log.timeRange
    expect(range).not.toBeNull()
    let s = selectModel(onLogLoaded(INITIAL_SETUP), 'transfer-function', pickerOptions(log))
    s = { ...s, startTime: String(range?.[0]), endTime: '60', startFreq: '1', endFreq: '50', cutoffFreq: '100' }
    s = writeSlot(s, 'tf', { kind: 'input' }, (f) => ({ ...f, message: 'RATE', field: 'ROut' }))
    s = writeSlot(s, 'tf', { kind: 'output', index: 0 }, (f) => ({
      ...f,
      message: 'ATT',
      field: 'Roll',
      multiplierOn: true,
      multiplier: '0.5',
      compensationOn: true
    }))
    const mine = transferFunctionInputs(log.log, s)
    expect(mine.inputData.length).toBeGreaterThan(100)
    expectSameGlobals(tfGlobals(mine), (await runUpstream('tf', parser, s)).globals)
  })
})

// Proven upstream bug fixed (docs/bug-proofs/sysid.md, row 3): upstream compensates output sample j
// with ATT[att_ind1 + j], which with a 20 Hz output and 10 Hz ATT reads attitude from twice the
// time and then runs off the end of ATT (NaN) although ATT covers the window. The port uses the ATT
// sample nearest in time.
describe('gravity compensation with ATT logged slower than the output', () => {
  function misalignedLog(): Uint8Array {
    const w = new LogWriter()
    w.defineFormat(0x80, 'FMT', 'BBnNZ', 'Type,Length,Name,Format,Columns')
    w.defineFormat(0x86, 'ATT', 'Qff', 'TimeUS,Roll,Pitch')
    w.defineFormat(0x87, 'RATE', 'Qf', 'TimeUS,YOut')
    w.defineFormat(0x88, 'SIDD', 'Qf', 'TimeUS,Ay')
    // RATE and SIDD at 20 Hz for 2 s; ATT at 10 Hz over the same 2 s, Roll = its sample number.
    for (let i = 0; i < 40; i++) {
      const t = i * 50_000
      w.write('RATE', [t, i])
      w.write('SIDD', [t, 0])
      if (i % 2 === 0) w.write('ATT', [t, i / 2, 0])
    }
    w.write('ATT', [2_000_000, 20, 0])
    return w.toBytes()
  }

  it('each sample uses the ATT sample nearest in time (upstream reads ATT[j], then NaN)', async () => {
    const bytes = misalignedLog()
    const parser = await upstreamParse(bytes)
    const log = loadLog(bytes.slice().buffer)
    let s = selectModel({ ...onLogLoaded(INITIAL_SETUP), startTime: '0', endTime: '2' }, 'transfer-function', pickerOptions(log))
    s = writeSlot(s, 'tf', { kind: 'input' }, (f) => ({ ...f, message: 'RATE', field: 'YOut' }))
    s = writeSlot(s, 'tf', { kind: 'output', index: 0 }, (f) => ({
      ...f,
      message: 'SIDD',
      field: 'Ay',
      compensationOn: true,
      compensationAxis: 'Roll'
    }))
    const k = (Math.PI / 180) * 9.81
    const theirs = (await runUpstream('tf', parser, s)).globals['output_data'] as number[]
    expect(theirs).toHaveLength(39)
    expect(theirs[10]).toBeCloseTo(k * 10, 12) // 0.50 s compensated with the attitude logged at 1.00 s
    expect(theirs.slice(21).every(Number.isNaN)).toBe(true) // 1.05 s on: NaN although ATT covers it

    const mine = transferFunctionInputs(log.log, s)
    // Sample j is at j * 50 ms; the nearest 10 Hz ATT sample is j / 2 (ties go to the earlier one).
    expect(mine.outputData).toEqual(Array.from({ length: 39 }, (_, j) => k * Math.floor(j / 2)))
    // Everything else is what upstream hands to Python.
    const { output_data: _mineOut, ...mineRest } = tfGlobals(mine)
    const { output_data: _theirOut, ...theirRest } = (await runUpstream('tf', parser, s)).globals
    expectSameGlobals(mineRest, theirRest)
  })
})
