// Test-only: loads the vendored upstream FilterTool JavaScript (with Libraries/Array_Math.js)
// into a node:vm context with a stub DOM, so the TypeScript port can be compared against it on
// identical inputs. Each call returns a fresh, isolated instance.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'
import { patchChainedSpread } from './chained-spread.js'

const here = dirname(fileURLToPath(import.meta.url))
const upstreamDir = resolve(here, '../../../../../upstream')

type Pair = [number[], number[]]

/** An upstream filter object after `transfer` has run. */
export interface UpstreamFilter {
  enabled?: boolean
  sample_rate: number
  attenuation?: number[]
  phase?: number[]
  P_attenuation?: number[]
  P_phase?: number[]
  I_attenuation?: number[]
  I_phase?: number[]
  D_attenuation?: number[]
  D_phase?: number[]
  notches?: { center_freq_hz: number; bandwidth_hz: number; initialised: boolean }[]
}

export interface UpstreamFilterTool {
  /** Set a form input value as the page would read it. */
  setForm(id: string, value: number): void
  get_filters(sampleRate: number): UpstreamFilter[]
  PID(sampleRate: number, kP: number, kI: number, kD: number, fltE: number, fltD: number): UpstreamFilter
  evaluate_transfer_functions(
    groups: UpstreamFilter[][],
    freqMax: number,
    freqStep: number,
    useDb: boolean,
    unwrapPhase: boolean
  ): { attenuation: number[]; phase: number[]; freq: number[] }
  unwrap(phase: number[]): number[]
  param_to_string(value: number): string
  complex_abs(x: Pair): number[]
}

let source: string | undefined

function upstreamSource(): string {
  if (source !== undefined) return source
  const files = ['Libraries/Array_Math.js', 'Libraries/Param_Helpers.js', 'FilterTool/filters.js']
  source =
    files.map((f) => readFileSync(resolve(upstreamDir, f), 'utf8')).join('\n;\n') +
    '\n;({ get_filters, evaluate_transfer_functions, unwrap, param_to_string, complex_abs,' +
    ' PID: (...a) => new PID(...a) })'
  return source
}

export interface LoadOptions {
  /** Apply `patchChainedSpread` (the reference for the port's fix of the proven chained-spread bug). */
  fixChainedSpread?: boolean
}

/** Load a fresh upstream FilterTool into its own vm context. */
export function loadFilterToolUpstream(options: LoadOptions = {}): UpstreamFilterTool {
  const form = new Map<string, { value: string }>()
  const element = (id: string) => {
    let e = form.get(id)
    if (e === undefined) {
      e = { value: '0' }
      form.set(id, e)
    }
    return e
  }
  const context = createContext({
    document: { getElementById: element, cookie: '' },
    console: { log: () => undefined }
  })
  const source = options.fixChainedSpread === true ? patchChainedSpread(upstreamSource()) : upstreamSource()
  const api = runInContext(source, context, { filename: 'upstream-filter-tool.js' })
  return {
    ...api,
    setForm: (id: string, value: number) => {
      element(id).value = String(value)
    }
  }
}

/** Upstream parameter defaults as page inputs, for a fresh instance. */
export function upstreamParamFile(): string {
  return readFileSync(resolve(upstreamDir, 'FilterTool/params.json'), 'utf8')
}
