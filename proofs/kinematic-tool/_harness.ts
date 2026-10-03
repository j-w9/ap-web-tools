// Runs the original KinematicTool page script (copter or plane) in node:vm with a stub DOM and
// Plotly, the original control.wasm and the original Ruckig build. Adapted from the Kinematic Tool
// oracle harness, but loading everything from `upstream/` so it does not depend on the port.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createContext, runInContext } from 'node:vm'

export const upstreamDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../upstream')
export const readUpstream = (rel: string): string => readFileSync(resolve(upstreamDir, rel), 'utf8')
const readBytes = (rel: string): Uint8Array<ArrayBuffer> => Uint8Array.from(readFileSync(resolve(upstreamDir, rel)))

export interface Trace {
  x?: number[]
  y?: number[]
}

export interface Plot {
  data: Trace[]
}

export interface Plots {
  ang_pos: Plot
  ang_vel: Plot
  ang_accel: Plot
  ang_jerk: Plot
}

export interface Run {
  plots: Plots
  /** Plot ids passed to `Plotly.redraw`, in order. */
  redrawn: string[]
  /** What `run_attitude()` rejected with, if anything. */
  error: unknown
  /** What the page passed to `console.log`. */
  logs: string[]
}

export interface Page {
  /** Set the radios and inputs (by element id), then run `run_attitude()` as an `onchange` would. */
  run(radios: { axis: string; mode: string }, values: Record<string, number | string>): Promise<Run>
}

type RuckigFactory = (args: { wasmBinary: Uint8Array }) => Promise<unknown>

function isRuckigModule(value: unknown): value is { default: RuckigFactory } {
  return typeof value === 'object' && value !== null && 'default' in value && typeof value.default === 'function'
}

export async function loadPage(page: 'copter' | 'plane'): Promise<Page> {
  const wasm = await WebAssembly.instantiate(readBytes('KinematicTool/ardupilot/control.wasm'), {})
  const exports = wasm.instance.exports
  const fn = (name: string): ((...args: number[]) => number) => {
    const f = exports[name]
    if (typeof f !== 'function') throw new Error(`control.wasm does not export ${name}`)
    return f as (...args: number[]) => number
  }
  fn('emscripten_stack_init')()
  fn('__wasm_call_ctors')()
  const controlModule = {
    _sqrt_controller_wrapper: fn('sqrt_controller_wrapper'),
    _shape_angle_vel_accel_wrapper: fn('shape_angle_vel_accel_wrapper'),
    _shape_pos_vel_accel_wrapper: fn('shape_pos_vel_accel_wrapper')
  }
  const imported: unknown = await import(pathToFileURL(resolve(upstreamDir, 'KinematicTool/Ruckig/ruckig.js')).href)
  if (!isRuckigModule(imported)) throw new Error('unexpected Ruckig module shape')
  const ruckig = await imported.default({ wasmBinary: readBytes('KinematicTool/Ruckig/ruckig.wasm') })

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
  let logs: string[] = []
  const noop = () => undefined
  const context = createContext({
    console: { log: (...args: unknown[]) => logs.push(args.map(String).join(' ')) },
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
  runInContext(readUpstream('Libraries/Array_Math.js'), context)
  const source = readUpstream(page === 'copter' ? 'KinematicTool/KinematicTool.js' : 'KinematicTool/plane/KinematicTool.js')
  runInContext(source.replace("import('./Ruckig/ruckig.js')", '__importRuckig()'), context)
  runInContext('initial_load()', context)

  return {
    async run(nextRadios, values) {
      radios = nextRadios
      for (const [id, value] of Object.entries(values)) element(id).value = String(value)
      redrawn = []
      logs = []
      let error: unknown = undefined
      try {
        await (runInContext('run_attitude()', context) as Promise<void>)
      } catch (e) {
        error = e
      }
      const plots = structuredClone(runInContext('({ ang_pos, ang_vel, ang_accel, ang_jerk })', context) as Plots)
      return { plots, redrawn, error, logs }
    }
  }
}

/** The copter page's default input values (`KinematicTool/index.html`). */
export const COPTER_DEFAULTS: Record<string, string> = {
  desired_pos: '30',
  desired_vel: '0',
  end_time: '1',
  initial_pos: '0',
  initial_vel: '0',
  ATC_RATE_R_MAX: '0',
  ATC_ACC_R_MAX: '1100',
  ATC_RATE_P_MAX: '0',
  ATC_ACC_P_MAX: '1100',
  ATC_RATE_Y_MAX: '0',
  ATC_ACC_Y_MAX: '270',
  ACRO_RP_RATE_TC: '0',
  PILOT_Y_RATE_TC: '0',
  ATC_INPUT_TC: '0.15'
}
