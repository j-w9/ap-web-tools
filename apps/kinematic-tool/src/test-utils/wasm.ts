// Test-only: instantiate the bundled wasm modules in node from their bytes.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { instantiateControl, type ControlLib } from '../wasm/control.js'
import { instantiateRuckig, type RuckigLib } from '../wasm/ruckig-planner.js'

const wasmDir = resolve(dirname(fileURLToPath(import.meta.url)), '../wasm')

export function readWasm(name: 'control.wasm' | 'ruckig.wasm'): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(readFileSync(resolve(wasmDir, name)))
}

export async function loadTestLibs(): Promise<{ control: ControlLib; ruckig: RuckigLib }> {
  const [control, ruckig] = await Promise.all([
    instantiateControl(readWasm('control.wasm')),
    instantiateRuckig({ bytes: readWasm('ruckig.wasm') })
  ])
  return { control, ruckig }
}
