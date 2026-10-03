/** Browser loading of the two wasm modules from their bundled, content-hashed URLs. */
import controlWasmUrl from './control.wasm?url'
import ruckigWasmUrl from './ruckig.wasm?url'
import { instantiateControl, type ControlLib } from './control.js'
import { instantiateRuckig, type RuckigLib } from './ruckig-planner.js'

export interface KinematicLibs {
  control: ControlLib
  ruckig: RuckigLib
}

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Could not download ${url} (HTTP ${response.status}).`)
  return response.arrayBuffer()
}

export async function loadKinematicLibs(): Promise<KinematicLibs> {
  const [control, ruckig] = await Promise.all([
    fetchBytes(controlWasmUrl).then(instantiateControl),
    instantiateRuckig({ url: ruckigWasmUrl })
  ])
  return { control, ruckig }
}
