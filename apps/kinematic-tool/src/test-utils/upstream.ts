// Test-only: runs the upstream KinematicTool pages' JavaScript inside node:vm, with a stub DOM and
// Plotly, the same control.wasm and Ruckig build, so the port can be compared on identical inputs.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'
import RuckigModuleFactory from '../wasm/ruckig.js'
import { readWasm } from './wasm.js'

const upstreamDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../upstream')
const read = (rel: string): string => readFileSync(resolve(upstreamDir, rel), 'utf8')

export interface UpstreamTrace {
  x?: ArrayLike<number>
  y?: ArrayLike<number>
  visible?: boolean
}

export interface UpstreamPlot {
  data: UpstreamTrace[]
  layout: { shapes?: { y0?: number; visible: boolean }[] }
}

export interface UpstreamPlots {
  ang_pos: UpstreamPlot
  ang_vel: UpstreamPlot
  ang_accel: UpstreamPlot
  ang_jerk: UpstreamPlot
}

export interface UpstreamRun {
  plots: UpstreamPlots
  /** Plot ids passed to `Plotly.redraw` during the run, in order. */
  redrawn: string[]
  /** What `run_attitude()` threw, if it did (upstream then shows its generic error alert). */
  error: unknown
}

export interface UpstreamPage {
  /**
   * Set the radios and inputs, then run `run_attitude()` as an input's `onchange` would.
   * @param values element id to input text, e.g. `{ desired_pos: 30, ATC_INPUT_TC: '' }`;
   *   ids not given keep their previous value (initially `'0'`)
   */
  run(radios: { axis: string; mode: string }, values: Record<string, number | string>): Promise<UpstreamRun>
}

/** Load one upstream page once, so a sequence of runs sees the state earlier runs left behind. */
export async function loadUpstreamPage(page: 'copter' | 'plane'): Promise<UpstreamPage> {
  const wasm = await WebAssembly.instantiate(readWasm('control.wasm'), {})
  const exports = wasm.instance.exports as Record<string, ((...args: number[]) => number) | undefined>
  const fn = (name: string) => {
    const f = exports[name]
    if (!f) throw new Error(`control.wasm does not export ${name}`)
    return f
  }
  fn('emscripten_stack_init')()
  fn('__wasm_call_ctors')()
  // The members upstream calls on the Emscripten module, which are the raw exports.
  const controlModule = {
    _sqrt_controller_wrapper: fn('sqrt_controller_wrapper'),
    _shape_angle_vel_accel_wrapper: fn('shape_angle_vel_accel_wrapper'),
    _shape_pos_vel_accel_wrapper: fn('shape_pos_vel_accel_wrapper')
  }
  const ruckig = await RuckigModuleFactory({ wasmBinary: readWasm('ruckig.wasm') })

  const elements = new Map<string, { value: string; disabled: boolean; hidden: boolean }>()
  const element = (id: string) => {
    let el = elements.get(id)
    if (!el) {
      el = { value: '0', disabled: false, hidden: false }
      elements.set(id, el)
    }
    return el
  }
  let radios = { axis: 'R', mode: 'angle' }
  let redrawn: string[] = []
  const noop = () => undefined
  const context = createContext({
    console: { ...console, log: noop },
    document: {
      getElementById: element,
      querySelector: (selector: string) => ({ value: selector.includes('"axis"') ? radios.axis : radios.mode })
    },
    Plotly: { purge: noop, newPlot: noop, redraw: (id: string) => redrawn.push(id) },
    link_plot_axis_range: noop,
    link_plot_reset: noop,
    ControlModule: () => Promise.resolve(controlModule),
    __importRuckig: () => Promise.resolve({ default: () => Promise.resolve(ruckig) })
  })
  runInContext(read('Libraries/Array_Math.js'), context)
  const source = read(page === 'copter' ? 'KinematicTool/KinematicTool.js' : 'KinematicTool/plane/KinematicTool.js')
  runInContext(source.replace("import('./Ruckig/ruckig.js')", '__importRuckig()'), context)
  runInContext('initial_load()', context)

  return {
    async run(nextRadios, values) {
      radios = nextRadios
      for (const [id, value] of Object.entries(values)) element(id).value = String(value)
      redrawn = []
      let error: unknown = undefined
      try {
        await (runInContext('run_attitude()', context) as Promise<void>)
      } catch (e) {
        error = e
      }
      // Deep copy, so later runs cannot change what this one returned.
      const plots = structuredClone(runInContext('({ ang_pos, ang_vel, ang_accel, ang_jerk })', context) as UpstreamPlots)
      return { plots, redrawn, error }
    }
  }
}
