// Test-only: runs upstream SCurveTool.js (with Libraries/Array_Math.js and the same wasm glue) in a
// node:vm context with a stub DOM and Plotly, so the port can be compared on identical inputs.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInContext } from 'node:vm'
import { GLUE_PATH, glueContext, wasmBinary } from '../../wasm/test-utils/node.js'
import { PARAMS, type ParamValues } from '../params.js'
import type { Mission } from '../waypoints.js'

const here = dirname(fileURLToPath(import.meta.url))
const upstreamDir = resolve(here, '../../../../../upstream')

/** Upstream's checkbox ids for the display options. */
export interface UpstreamDisplay {
  display_wp_radius: boolean
  display_wp_vel: boolean
  display_wp_accel: boolean
  display_wp_jerk: boolean
}

export interface UpstreamTrace {
  type?: string
  x: number[]
  y: number[]
  z: number[]
  i?: number[]
  j?: number[]
  k?: number[]
  name?: string
  hovertemplate?: string
  line?: { color: number[] | string; colorbar?: { title: string }; showscale?: boolean }
}

export interface UpstreamCurve {
  time: number[]
  pos: number[]
  vel: number[]
  accel: number[]
  jerk: number[]
  snap: number[]
}

export interface UpstreamResult {
  /** `wp_pos_plot.data`: waypoints, target path, then any spheres. */
  path: UpstreamTrace[]
  /** `wp_pos_plot.layout.scene` axis ranges. */
  ranges: { x: number[]; y: number[]; z: number[] }
  /** `SCurveLog`. */
  curves: UpstreamCurve[]
}

interface Element {
  id: string
  value: string
  checked: boolean
}

interface UpstreamGlobals {
  initial_load(): void
  replot(): Promise<void>
  wp_pos_plot: { data: UpstreamTrace[]; layout: { scene: Record<'xaxis' | 'yaxis' | 'zaxis', { range: number[] }> } }
  SCurveLog: UpstreamCurve[]
}

const WAYPOINT_IDS = ['first_wp', 'curr_wp', 'next_wp', 'last_wp'] as const

/** Deep copy out of the vm realm (keeping -0) so vitest compares plain objects. */
function plain<T>(value: T): T {
  return structuredClone(value)
}

let instance: { globals: UpstreamGlobals; elements: Map<string, Element> } | undefined

function load() {
  if (instance) return instance
  const elements = new Map<string, Element>()
  const getElementById = (id: string): Element => {
    let el = elements.get(id)
    if (!el) {
      el = { id, value: '', checked: false }
      elements.set(id, el)
    }
    return el
  }
  const binary = wasmBinary()
  const context = glueContext({
    document: { getElementById },
    Plotly: { purge() {}, newPlot() {}, redraw() {} },
    link_plot_axis_range() {},
    link_plot_reset() {},
    loading_call: (f: () => Promise<void>) => f(),
    __wasmBinary: binary
  })
  const source = [
    readFileSync(GLUE_PATH, 'utf8'),
    // Upstream calls WPNavModule() with no arguments and lets the glue fetch the wasm.
    'var __factory = WPNavModule; WPNavModule = () => __factory({ wasmBinary: __wasmBinary });',
    readFileSync(resolve(upstreamDir, 'Libraries/Array_Math.js'), 'utf8'),
    readFileSync(resolve(upstreamDir, 'SCurveTool/SCurveTool.js'), 'utf8'),
    ';this'
  ].join('\n')
  const globals = runInContext(source, context, { filename: 'upstream-scurve.js' }) as UpstreamGlobals
  globals.initial_load()
  instance = { globals, elements }
  return instance
}

/** Run upstream `replot()` with these inputs and return what it would plot. */
export async function runUpstream(mission: Mission, params: ParamValues, display: UpstreamDisplay): Promise<UpstreamResult> {
  const { globals, elements } = load()
  const set = (id: string, value: string, checked = false) => elements.set(id, { id, value, checked })
  WAYPOINT_IDS.forEach((id, i) => {
    const w = mission[i as 0 | 1 | 2 | 3]
    set(`${id}_x`, String(w.north))
    set(`${id}_y`, String(w.east))
    set(`${id}_z`, String(w.up))
  })
  for (const p of PARAMS) set(p.name, String(params[p.name]))
  for (const [id, checked] of Object.entries(display)) set(id, '', checked)

  await globals.replot()
  const scene = globals.wp_pos_plot.layout.scene
  return plain({
    path: globals.wp_pos_plot.data,
    ranges: { x: scene.xaxis.range, y: scene.yaxis.range, z: scene.zaxis.range },
    curves: globals.SCurveLog
  })
}
