// Proof harness, adapted from apps/rotation-check's oracle loader: runs the vendored upstream
// RotationCheck page (Matrix3.js, RotationCheck.js and the inline script of index.html) in a
// node:vm context behind a minimal fake DOM and Plotly, and exposes `update()`.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'

export interface UpstreamTrace {
  x: number[]
  y: number[]
  z: number[]
}

interface FakeElement {
  value: string
  disabled: boolean
  innerHTML: string
  setAttribute(): void
  appendChild(): void
}

export interface UpstreamRotationPage {
  /** index.html `Rotations`: value to label. */
  rotations: Record<string, string>
  /** index.html `euler`: [roll, pitch, yaw] degrees per standard rotation. */
  euler: ([number, number, number] | undefined)[]
  /** Set the drop-down and the three angle boxes (strings, as a number input holds them) and run `update()`. */
  update(rotation: string, roll: string, pitch: string, yaw: string): void
  /** `rotations_plot.data`: traces 6..11 are the rotated X, Y, Z cones and lines. */
  traces(): UpstreamTrace[]
}

export function loadRotationPage(): UpstreamRotationPage {
  const here = dirname(fileURLToPath(import.meta.url))
  const dir = resolve(here, '../../upstream/RotationCheck')
  const matrix3 = readFileSync(resolve(dir, 'Matrix3.js'), 'utf8')
  const page = readFileSync(resolve(dir, 'RotationCheck.js'), 'utf8')
  const html = readFileSync(resolve(dir, 'index.html'), 'utf8')
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? '')
  const inline = scripts.find((s) => s.includes('let Rotations'))
  if (inline === undefined) throw new Error('index.html inline script not found')

  const make = (): FakeElement => ({
    value: '',
    disabled: false,
    innerHTML: '',
    setAttribute() {},
    appendChild() {}
  })
  const elements = new Map<string, FakeElement>()
  for (const id of ['rotations', 'EulerRoll', 'EulerPitch', 'EulerYaw', 'plot']) elements.set(id, make())
  const document = { getElementById: (id: string) => elements.get(id) ?? make(), createElement: make }
  const window = { addEventListener() {} }
  const Plotly = { purge() {}, newPlot() {}, redraw() {} }
  const context = createContext({ document, window, Plotly })
  const api = runInContext(
    `${matrix3}\n${page}\n${inline}\n;({ rotations: Rotations, euler, reset, update, plot: () => rotations_plot })`,
    context,
    { filename: 'upstream-rotation-check.js' }
  ) as {
    rotations: Record<string, string>
    euler: ([number, number, number] | undefined)[]
    reset(): void
    update(): void
    plot(): { data: UpstreamTrace[] }
  }
  const set = (id: string, v: string): void => {
    const el = elements.get(id)
    if (el === undefined) throw new Error(`no element ${id}`)
    el.value = v
  }
  // body onload="reset(); update()"
  set('rotations', '0')
  api.reset()
  api.update()
  return {
    rotations: api.rotations,
    euler: api.euler,
    update(rotation, roll, pitch, yaw) {
      set('rotations', rotation)
      set('EulerRoll', roll)
      set('EulerPitch', pitch)
      set('EulerYaw', yaw)
      api.update()
    },
    traces: () => api.plot().data
  }
}
