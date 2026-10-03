import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { buildSyntheticSidLog } from '../test-utils/synthetic-sid.js'
import { runUpstream, upstreamParse, type UpstreamParser } from '../test-utils/upstream.js'
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
    s = writeSlot(s, { kind: 'input' }, (f) => ({ ...f, message: 'RATE', field: 'YOut' }))
    s = writeSlot(s, { kind: 'output', index: 0 }, (f) => ({ ...f, message: 'SIDD', field: 'Gz', ...output }))
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

  it('transfer function: instanced and unselected messages fail where upstream throws', async () => {
    for (const [message, field] of [
      ['IMU[0]', 'GyrZ'],
      ['None', 'None'],
      ['EMPT', 'Never']
    ] as const) {
      const setup = writeSlot(tfSetup({}), { kind: 'input' }, (f) => ({ ...f, message, field }))
      await expect(runUpstream('tf', parser, setup)).rejects.toThrow()
      expect(() => transferFunctionInputs(log.log, setup)).toThrow(MissingDataError)
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
      expectSameGlobals(ssGlobals(result.inputs), (await runUpstream('ss', parser, setup)).globals)
    }
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
    s = writeSlot(s, { kind: 'input' }, (f) => ({ ...f, message: 'RATE', field: 'ROut' }))
    s = writeSlot(s, { kind: 'output', index: 0 }, (f) => ({
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
