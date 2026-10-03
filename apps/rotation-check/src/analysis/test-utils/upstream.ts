// Test-only: loads the vendored upstream RotationCheck (Matrix3.js and the inline script of
// index.html) into a vm context so the TypeScript port can be compared against it.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'

export interface UpstreamVec {
  x: number
  y: number
  z: number
}

export interface UpstreamMatrix3 {
  a: UpstreamVec
  b: UpstreamVec
  c: UpstreamVec
  from_euler(roll: number, pitch: number, yaw: number): void
  to_euler(): UpstreamVec
  from_rotation(rotation: number): boolean
  to_euler312(): UpstreamVec
  from_euler312(roll: number, pitch: number, yaw: number): void
  rotate(v: [number, number, number]): [number, number, number]
}

export interface Upstream {
  newMatrix3(): UpstreamMatrix3
  /** index.html `Rotations`: value → label. */
  rotations: Record<string, string>
  /** index.html `euler`: [roll, pitch, yaw] degrees per standard rotation, parsed from the labels. */
  euler: ([number, number, number] | undefined)[]
}

let cached: Upstream | undefined

export function loadUpstream(): Upstream {
  if (cached !== undefined) return cached
  const here = dirname(fileURLToPath(import.meta.url))
  const dir = resolve(here, '../../../../../upstream/RotationCheck')
  const matrix3 = readFileSync(resolve(dir, 'Matrix3.js'), 'utf8')
  const html = readFileSync(resolve(dir, 'index.html'), 'utf8')
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? '')
  const inline = scripts.find((s) => s.includes('let Rotations'))
  if (inline === undefined) throw new Error('index.html inline script not found')

  // Just enough DOM for the drop-down population the script does on load.
  const element = { setAttribute() {}, appendChild() {}, innerHTML: '' }
  const document = { getElementById: () => element, createElement: () => ({ ...element }) }
  const window = { addEventListener() {} }
  const context = createContext({ document, window })
  cached = runInContext(`${matrix3}\n${inline}\n;({ newMatrix3: () => new Matrix3(), rotations: Rotations, euler })`, context, {
    filename: 'upstream-rotation-check.js'
  }) as Upstream
  return cached
}
