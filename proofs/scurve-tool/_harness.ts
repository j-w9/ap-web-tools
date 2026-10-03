// Runs the original SCurveTool.js (with Libraries/Array_Math.js and the original wpnav.js glue and
// wpnav.wasm) in node:vm with a stub DOM and Plotly. Adapted from the S-Curve Tool oracle harness,
// but loading everything from `upstream/` so it does not depend on the port.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'

export const upstreamDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../upstream')
export const readUpstream = (rel: string): string => readFileSync(resolve(upstreamDir, rel), 'utf8')

export interface Trace {
  type?: string
  x: number[]
  y: number[]
  z: number[]
  meta?: number[]
  name?: string
  hovertemplate?: string
  line?: { color: number[] | string; colorbar?: { title: string }; showscale?: boolean }
}

export interface Curve {
  time: number[]
  pos: number[]
}

export interface Result {
  /** `wp_pos_plot.data`: waypoints, target path, then any spheres. */
  path: Trace[]
  /** `wp_pos_plot.layout.scene` axis titles. */
  axisTitles: { x: string; y: string; z: string }
  /** `SCurveLog`. */
  curves: Curve[]
}

interface Element {
  value: string
  checked: boolean
}

interface Globals {
  initial_load(): void
  replot: () => Promise<void>
  wp_pos_plot: {
    data: Trace[]
    layout: { scene: Record<'xaxis' | 'yaxis' | 'zaxis', { title: { text: string } }> }
  }
  SCurveLog: Curve[]
}

/** Every input of `SCurveTool/index.html` with its default value. */
export const DEFAULTS: Readonly<Record<string, string>> = {
  first_wp_x: '0',
  first_wp_y: '0',
  first_wp_z: '300',
  curr_wp_x: '300',
  curr_wp_y: '300',
  curr_wp_z: '150',
  next_wp_x: '70',
  next_wp_y: '35',
  next_wp_z: '80',
  last_wp_x: '100',
  last_wp_y: '250',
  last_wp_z: '80',
  ATC_RATE_R_MAX: '0',
  ATC_RATE_P_MAX: '0',
  ATC_ACC_R_MAX: '1100',
  ATC_ACC_P_MAX: '1100',
  ATC_INPUT_TC: '0.15',
  ATC_RATE_FF_ENAB: '1',
  PSC_JERK_NE: '5.0',
  PSC_JERK_D: '5.0',
  PSC_NE_POS_P: '1.0',
  PSC_D_ACC_FLTT: '0',
  PSC_D_ACC_FLTE: '20',
  WP_JERK: '1.0',
  WP_ACC_Z: '1.0',
  WP_ACC: '2.5',
  WP_ACC_CNR: '0',
  WP_SPD: '10',
  WP_SPD_UP: '2.5',
  WP_SPD_DN: '1.5',
  WP_RADIUS_M: '50.0'
}

/** Default checkbox states: only "colour by velocity" is ticked. */
export const DEFAULT_CHECKS: Readonly<Record<string, boolean>> = {
  display_wp_radius: false,
  display_wp_vel: true,
  display_wp_accel: false,
  display_wp_jerk: false
}

let instance: { globals: Globals; elements: Map<string, Element> } | undefined

function load() {
  if (instance) return instance
  const elements = new Map<string, Element>()
  const getElementById = (id: string): Element => {
    let el = elements.get(id)
    if (!el) {
      el = { value: '', checked: false }
      elements.set(id, el)
    }
    return el
  }
  const context = createContext({
    window: {},
    console,
    WebAssembly,
    TextDecoder,
    setTimeout,
    clearTimeout,
    document: { getElementById },
    Plotly: { purge() {}, newPlot() {}, redraw() {} },
    link_plot_axis_range() {},
    link_plot_reset() {},
    loading_call: (f: () => Promise<void>) => f(),
    __wasmBinary: new Uint8Array(readFileSync(resolve(upstreamDir, 'SCurveTool/ardupilot/wpnav.wasm')))
  })
  const source = [
    readUpstream('SCurveTool/ardupilot/wpnav.js'),
    // The page calls WPNavModule() with no arguments and lets the glue fetch the wasm.
    'var __factory = WPNavModule; WPNavModule = () => __factory({ wasmBinary: __wasmBinary });',
    readUpstream('Libraries/Array_Math.js'),
    readUpstream('SCurveTool/SCurveTool.js'),
    ';this'
  ].join('\n')
  const globals = runInContext(source, context, { filename: 'upstream-scurve.js' }) as Globals
  globals.initial_load()
  instance = { globals, elements }
  return instance
}

/** Run the original `replot()` with these input values (by element id) and return what it plots. */
export async function replot(values: Record<string, string>, checks: Record<string, boolean> = {}): Promise<Result> {
  const { globals, elements } = load()
  for (const [id, value] of Object.entries({ ...DEFAULTS, ...values })) elements.set(id, { value, checked: false })
  for (const [id, checked] of Object.entries({ ...DEFAULT_CHECKS, ...checks })) elements.set(id, { value: '', checked })
  await globals.replot()
  const scene = globals.wp_pos_plot.layout.scene
  return structuredClone({
    path: globals.wp_pos_plot.data,
    axisTitles: { x: scene.xaxis.title.text, y: scene.yaxis.title.text, z: scene.zaxis.title.text },
    curves: globals.SCurveLog
  })
}
