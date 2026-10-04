/**
 * Real-log oracle, run only when `APWT_REAL_LOGS` names a directory of DataFlash `.bin` logs (the
 * logs are never part of the repository). For every log, upstream SysID.js (in node:vm with the
 * upstream JsDataflashParser and a fake Pyodide) and the port read the same bytes, and everything
 * up to the Python fit is compared as `log.test.ts` and `request.test.ts` compare it:
 *
 * - the message pickers and their fields;
 * - the flight data plot and the analysis window upstream's `load` fills in;
 * - the globals handed to Python for transfer function and state space identifications on the
 *   log's own messages, over the whole log and over a zoomed window.
 *
 * Documented differences are asserted as such: an instanced message (`IMU[0]`) is read where
 * upstream throws (docs/bug-proofs/sysid.md row 8), and gravity compensation of an output logged
 * at another rate than ATT uses the ATT sample nearest in time (row 3). Their reference is the
 * upstream page with exactly that fix applied (`instanceAwareParser`, `fixCompensation`).
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { MissingDataError } from './analysis/columns.js'
import { loadLog, type SysIdLog } from './analysis/log.js'
import { PRESET_IDS } from './analysis/presets.js'
import { stateSpaceInputs, transferFunctionInputs } from './analysis/request.js'
import {
  INITIAL_SETUP,
  generateFields,
  onLogLoaded,
  selectModel,
  writeSlot,
  type OutputFields,
  type PickerOptions,
  type Setup
} from './analysis/setup.js'
import type { StateSpaceInputs, TransferFunctionInputs } from './python/runtime.js'
import {
  instanceAwareParser,
  runUpstream,
  upstreamLoad,
  upstreamMessageList,
  upstreamParse,
  type UpstreamParser
} from './test-utils/upstream.js'

const dir = process.env['APWT_REAL_LOGS']
const files = dir
  ? readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.bin'))
      .sort()
  : []
const TIMEOUT = 900_000

function pickerOptions(log: SysIdLog): PickerOptions {
  const fields = new Map(log.messages.map((m) => [m.name, m.fields]))
  return { loaded: true, fieldsOf: (m) => fields.get(m), hasMessage: (m) => fields.has(m) }
}

/** First difference between two values (Object.is for numbers, deep for arrays and objects), or undefined. */
function firstDifference(mine: unknown, theirs: unknown, path = ''): string | undefined {
  if (Object.is(mine, theirs)) return undefined
  const isList = (v: unknown): v is ArrayLike<unknown> => Array.isArray(v) || ArrayBuffer.isView(v)
  if (isList(mine) && isList(theirs)) {
    if (mine.length !== theirs.length) return `${path}: length ${mine.length} vs ${theirs.length}`
    for (let i = 0; i < mine.length; i++) {
      const d = firstDifference(mine[i], theirs[i], `${path}[${i}]`)
      if (d !== undefined) return d
    }
    return undefined
  }
  return `${path}: ${String(mine)} vs ${String(theirs)}`
}

/** Expect the port's Python inputs to equal the globals upstream sets (as request.test.ts; NaN equals NaN). */
function expectSameGlobals(mine: Record<string, unknown>, theirs: Record<string, unknown>, skip: readonly string[] = []) {
  expect(Object.keys(mine).sort()).toEqual(Object.keys(theirs).sort())
  for (const key of Object.keys(theirs)) {
    if (skip.includes(key)) continue
    expect(firstDifference(mine[key], theirs[key], key), key).toBeUndefined()
  }
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

type Signal = { readonly message: string; readonly field: string }
type Output = Signal & Partial<Omit<OutputFields, 'message' | 'field'>>

interface Case {
  readonly name: string
  readonly input: Signal
  readonly outputs: readonly Output[]
}

const TF_CASES: readonly Case[] = [
  { name: 'RATE.ROut to ATT.Roll', input: { message: 'RATE', field: 'ROut' }, outputs: [{ message: 'ATT', field: 'Roll' }] },
  {
    name: 'RATE.POut to ATT.Pitch, multiplier, pitch compensation',
    input: { message: 'RATE', field: 'POut' },
    outputs: [
      {
        message: 'ATT',
        field: 'Pitch',
        multiplierOn: true,
        multiplier: '0.01745',
        compensationOn: true,
        compensationAxis: 'Pitch'
      }
    ]
  },
  {
    name: 'RATE.YOut to RATE.Y, multiplier, roll compensation',
    input: { message: 'RATE', field: 'YOut' },
    outputs: [
      { message: 'RATE', field: 'Y', multiplierOn: true, multiplier: '2', compensationOn: true, compensationAxis: 'Roll' }
    ]
  },
  { name: 'IMU[0].GyrX to RATE.R', input: { message: 'IMU[0]', field: 'GyrX' }, outputs: [{ message: 'RATE', field: 'R' }] },
  {
    name: 'CTUN.ThO to IMU[0].AccZ, pitch compensation',
    input: { message: 'CTUN', field: 'ThO' },
    outputs: [{ message: 'IMU[0]', field: 'AccZ', compensationOn: true, compensationAxis: 'Pitch' }]
  }
]

const SS_CASE: Case = {
  name: 'RATE.ROut to RATE.R and IMU[0].AccY with roll compensation',
  input: { message: 'RATE', field: 'ROut' },
  outputs: [
    { message: 'RATE', field: 'R', multiplierOn: true, multiplier: '0.01745' },
    { message: 'IMU[0]', field: 'AccY', compensationOn: true, compensationAxis: 'Roll' }
  ]
}

/**
 * Let the event loop run between long synchronous steps: Vitest's worker must answer its RPC
 * within 60 s, and awaiting already-settled promises does not let it.
 */
const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve))

const isInstanced = (s: Signal) => /\[\d+\]$/.test(s.message)
/** Compensated outputs read ATT by time in the port (row 3); identical to upstream when the output is ATT itself. */
const compensatesOtherRate = (c: Case) => c.outputs.some((o) => o.compensationOn === true && o.message !== 'ATT')

function writeCase(setup: Setup, form: 'tf' | 'ss', c: Case): Setup {
  let s = writeSlot(setup, form, { kind: 'input' }, (f) => ({ ...f, ...c.input }))
  c.outputs.forEach((o, index) => {
    s = writeSlot(s, form, { kind: 'output', index }, (f) => ({ ...f, ...o }))
  })
  return s
}

/**
 * Compare the port with upstream on one case: against the page with the documented fixes applied
 * always, and against the original page with the documented difference where the case hits one.
 */
async function compareCase(
  kind: 'tf' | 'ss',
  parser: UpstreamParser,
  setup: Setup,
  c: Case,
  mine: Record<string, unknown>
): Promise<void> {
  await yieldToEventLoop()
  const reference = await runUpstream(kind, instanceAwareParser(parser), setup, { fixCompensation: true })
  await yieldToEventLoop()
  expectSameGlobals(mine, reference.globals)
  const instanced = isInstanced(c.input) || c.outputs.some(isInstanced)
  if (instanced) {
    await expect(runUpstream(kind, parser, setup)).rejects.toThrow("Cannot read properties of undefined (reading 'length')")
    return
  }
  const original = await runUpstream(kind, parser, setup)
  await yieldToEventLoop()
  expectSameGlobals(mine, original.globals, compensatesOtherRate(c) ? ['output_data'] : [])
}

describe.skipIf(!dir)('SysID on real logs (APWT_REAL_LOGS)', () => {
  describe.each(files.length > 0 ? files : ['(no logs)'])('%s', (file) => {
    let bytes: Uint8Array
    let parser: UpstreamParser
    let log: SysIdLog
    let options: PickerOptions

    beforeAll(async () => {
      const raw = readFileSync(join(dir!, file))
      bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
      parser = await upstreamParse(bytes)
      log = loadLog(bytes.slice().buffer)
      options = pickerOptions(log)
    }, TIMEOUT)

    it('message pickers match upstream populate_log_message_select', () => {
      expect(log.messages.map((m) => m.name)).toEqual(upstreamMessageList(parser))
      for (const m of log.messages) expect([...m.fields], m.name).toEqual(parser.messageTypes[m.name]?.expressions)
    })

    it(
      'flight data and analysis window match upstream load',
      async () => {
        const up = await upstreamLoad(bytes)
        const series = [log.flight.roll, log.flight.pitch, log.flight.throttle, log.flight.altitude]
        series.forEach((s, i) => {
          const trace = up.flight[i]!
          expect(firstDifference(s?.time, trace.x, `trace ${i} x`)).toBeUndefined()
          expect(firstDifference(s?.values, trace.y, `trace ${i} y`)).toBeUndefined()
        })
        // App.tsx writes String(range) into the inputs, as upstream's `.value = start_time`.
        const range = log.timeRange
        expect(range === null ? ['', ''] : [String(range[0]), String(range[1])]).toEqual([up.startTime, up.endTime])
      },
      TIMEOUT
    )

    /** The window upstream's load fills in, and a zoom to the middle half (Math.floor/ceil, as its relayout handler). */
    const windows = (): { name: string; start: string; end: string }[] => {
      const range = log.timeRange
      if (range === null) return []
      const span = range[1] - range[0]
      return [
        { name: 'whole log', start: String(range[0]), end: String(range[1]) },
        {
          name: 'middle half',
          start: String(Math.floor(range[0] + span / 4)),
          end: String(Math.ceil(range[0] + (3 * span) / 4))
        }
      ]
    }

    const baseSetup = (w: { start: string; end: string }): Setup => ({
      ...onLogLoaded(INITIAL_SETUP),
      startTime: w.start,
      endTime: w.end,
      startFreq: '1',
      endFreq: '40',
      cutoffFreq: '80'
    })

    it.each(TF_CASES.map((c) => ({ c, label: c.name })))(
      'transfer function inputs: $label',
      async ({ c }) => {
        const ws = windows()
        expect(ws.length).toBeGreaterThan(0)
        for (const w of ws) {
          await yieldToEventLoop()
          let s = selectModel(baseSetup(w), 'transfer-function', options)
          s = writeCase(s, 'tf', c)
          s = { ...s, tf: { numerator: 'b0', denominator: 'a1*s + a0', params: 'b0 a1 a0' } }
          const mine = transferFunctionInputs(log.log, s)
          expect(mine.inputData.length, w.name).toBeGreaterThan(10)
          await compareCase('tf', parser, s, c, tfGlobals(mine))
        }
      },
      TIMEOUT
    )

    it(
      'state space presets: the log has no SIDD, so Submit fails where upstream throws',
      async () => {
        expect(log.messages.some((m) => m.name === 'SIDD')).toBe(false)
        const w = windows()[0]!
        for (const preset of PRESET_IDS) {
          let s = selectModel(baseSetup(w), 'state-space', options)
          s = { ...s, ss: { ...s.ss, preset } }
          const outcome = generateFields(s, options)
          expect(outcome.alert, preset).toBeNull()
          expect(outcome.error, preset).toBeNull()
          await expect(runUpstream('ss', parser, outcome.setup), preset).rejects.toThrow()
          expect(() => stateSpaceInputs(log.log, outcome.setup), preset).toThrow(MissingDataError)
        }
      },
      TIMEOUT
    )

    it(
      `state space inputs: MR_Roll layout on ${SS_CASE.name}`,
      async () => {
        for (const w of windows()) {
          await yieldToEventLoop()
          let s = selectModel(baseSetup(w), 'state-space', options)
          s = generateFields({ ...s, ss: { ...s.ss, preset: 'MR_Roll' } }, options).setup
          s = writeCase(s, 'ss', SS_CASE)
          const result = stateSpaceInputs(log.log, s)
          expect(result.ok).toBe(true)
          if (!result.ok) return
          expect(result.inputs.inputData.length, w.name).toBeGreaterThan(10)
          await compareCase('ss', parser, s, SS_CASE, ssGlobals(result.inputs))
        }
      },
      TIMEOUT
    )
  })
})
