// Test-only: runs the upstream SysID.js run_transfer_function_ID / run_SS_ID in a vm context with
// a fake page (fields by id, as upstream's index.html creates them), the upstream
// JsDataflashParser and a fake Pyodide that records the globals upstream hands to Python.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'
import type { Setup } from '../analysis/setup.js'

const here = dirname(fileURLToPath(import.meta.url))
const upstreamDir = resolve(here, '../../../../upstream')

export interface UpstreamParser {
  processData(buffer: ArrayBuffer, msgs: string[]): unknown
  messageTypes: Record<string, { expressions: string[]; instances?: Record<string, string> }>
  get(name: string, field: string): unknown
  get_instance(name: string, instance: number, field: string): unknown
}

/**
 * The parser with `get('NAME[n]', field)` answered by its own `get_instance(NAME, n, field)`: what
 * upstream would read with the instanced-message bug fixed (docs/bug-proofs/sysid.md, row 8).
 */
export function instanceAwareParser(parser: UpstreamParser): UpstreamParser {
  return Object.assign(Object.create(parser) as UpstreamParser, {
    get(name: string, field: string): unknown {
      const m = /^(.+)\[(\d+)\]$/.exec(name)
      return m ? parser.get_instance(m[1]!, Number(m[2]), field) : parser.get(name, field)
    }
  })
}
type UpstreamCtor = new (sendPostMessage: boolean) => UpstreamParser

/** Parse with the upstream JsDataflashParser, as SysID.js `load` does. */
export async function upstreamParse(bytes: Uint8Array): Promise<UpstreamParser> {
  const g = globalThis as Record<string, unknown>
  g['self'] ??= { addEventListener: () => undefined, postMessage: () => undefined }
  const mod = (await import(/* @vite-ignore */ resolve(upstreamDir, 'modules/JsDataflashParser/parser.js'))) as {
    default: UpstreamCtor
  }
  const log = console.log
  console.log = () => undefined
  try {
    const parser = new mod.default(false)
    parser.processData(bytes.slice().buffer, [])
    return parser
  } finally {
    console.log = log
  }
}

/** Upstream `populate_log_message_select`'s message list for a parsed log. */
export function upstreamMessageList(parser: UpstreamParser): string[] {
  const types: string[] = []
  for (const [key, value] of Object.entries(parser.messageTypes)) if (!('instances' in value)) types.push(key)
  return types.sort((a, b) => a.localeCompare(b))
}

interface FakeElement {
  value: string
  checked: boolean
}

/**
 * The page's fields as upstream's DOM would hold them for `setup`. The transfer function form's
 * fields come first in the document, so they win `getElementById` lookups of shared ids.
 */
export function pageFromSetup(setup: Setup): Map<string, FakeElement> {
  const page = new Map<string, FakeElement>()
  const add = (id: string, value: string, checked = false) => {
    if (!page.has(id)) page.set(id, { value, checked })
  }
  add('starttime', setup.startTime)
  add('endtime', setup.endTime)
  add('startfreq', setup.startFreq)
  add('endfreq', setup.endFreq)
  add('cutofffreq', setup.cutoffFreq)
  add('customNumerator', setup.tf.numerator)
  add('customDenominator', setup.tf.denominator)
  add('tf_params', setup.tf.params)
  add('num_Outputs', setup.ss.outputs)
  add('A_order', setup.ss.order)
  add('num_params', setup.ss.params)
  add('num_cons', setup.ss.constraints)

  const addInput = (s: { message: string; field: string }) => {
    add('input_name_1', s.message)
    add('input_field_1', s.field)
  }
  const addOutput = (
    i: number,
    o: {
      message: string
      field: string
      multiplierOn: boolean
      multiplier: string
      compensationOn: boolean
      compensationAxis: string
    }
  ) => {
    add(`output_name_${i}`, o.message)
    add(`output_field_${i}`, o.field)
    add(`multiplier_checkbox_${i}`, '', o.multiplierOn)
    add(`multiplier_${i}`, o.multiplier)
    add(`compensation_checkbox_${i}`, '', o.compensationOn)
    add(`axis_dropdown_${i}`, o.compensationAxis)
  }
  if (setup.tfSignals) {
    addInput(setup.tfSignals.input)
    addOutput(1, setup.tfSignals.output)
  }
  if (setup.ss.signals) {
    addInput(setup.ss.signals.input)
    setup.ss.signals.outputs.forEach((o, i) => addOutput(i + 1, o))
  }
  setup.ss.paramNames.forEach((n, i) => add(`param_name_${i + 1}`, n))
  setup.ss.bounds.forEach((b, i) => {
    add(`Bound_min_${i + 1}`, b.min)
    add(`Bound_max_${i + 1}`, b.max)
  })
  setup.ss.constraintFields.forEach((c, i) => {
    add(`Constraint_A_${i + 1}`, c.a)
    add(`Constraint_B_${i + 1}`, c.b)
  })
  const m = setup.ss.matrices
  if (m) {
    for (const [id, matrix] of [
      ['matrixA', m.a],
      ['matrixB', m.b],
      ['H0', m.h0],
      ['H1', m.h1]
    ] as const) {
      matrix.forEach((row, i) => row.forEach((cell, j) => add(`${id}_r${i}_c${j}`, cell)))
    }
  }
  return page
}

export interface UpstreamRun {
  /** Globals passed to `pyodide.globals.set`, converted to this realm. */
  globals: Record<string, unknown>
  alerts: string[]
  output: string[]
}

/** Copy vm-realm data into this realm (arrays and plain values). */
function toRealm(value: unknown): unknown {
  if (value !== null && typeof value === 'object' && typeof (value as { length?: unknown }).length === 'number') {
    return Array.from(value as ArrayLike<unknown>, toRealm)
  }
  return value
}

/** Run upstream's `run_transfer_function_ID` or `run_SS_ID` on `setup`. Rejects where upstream throws. */
export async function runUpstream(kind: 'tf' | 'ss', parser: UpstreamParser, setup: Setup): Promise<UpstreamRun> {
  const page = pageFromSetup(setup)
  const run: UpstreamRun = { globals: {}, alerts: [], output: [] }
  const document = {
    getElementById: (id: string) => page.get(id) ?? null,
    querySelector: (selector: string) => {
      const match = /input\[name=([^\]]+)\]/.exec(selector)
      return (match && page.get(match[1]!)) ?? null
    }
  }
  const pyodide = {
    globals: {
      set: (name: string, value: unknown) => {
        run.globals[name] = toRealm(value)
      },
      get: () => []
    },
    runPython: () => undefined
  }
  const source = readFileSync(resolve(upstreamDir, 'SysID/SysID.js'), 'utf8').replace(
    /^import\(.*$/m,
    '// dynamic parser import removed for the test'
  )
  const context = createContext({
    document,
    console: { log: () => undefined },
    alert: (text: string) => run.alerts.push(text),
    addToOutput: (text: string) => run.output.push(text),
    Plotly: { newPlot: () => undefined }
  })
  runInContext(source + '\n;globalThis.__setPyodide = (p) => { pyodide = p }', context, { filename: 'SysID.js' })
  const ctx = context as Record<string, unknown>
  ;(ctx['__setPyodide'] as (p: unknown) => void)(pyodide)
  const fn = ctx[kind === 'tf' ? 'run_transfer_function_ID' : 'run_SS_ID'] as (p: UpstreamParser) => Promise<void>
  await fn(parser)
  return run
}
