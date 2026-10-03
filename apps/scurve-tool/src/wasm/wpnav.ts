/**
 * Typed access to ArduPilot's AC_WPNav compiled to WebAssembly (upstream `SCurveTool/ardupilot/`).
 *
 * `wpnav-glue.js` is Emscripten's classic-script glue, kept verbatim, so it is loaded with a `<script>`
 * tag rather than imported; `wpnav.wasm` is located through Vite's `?url`.
 */
import type { WpNavEngine } from '../analysis/engine.js'
import type { WPNavModuleFactory } from './wpnav-glue.js'
import { createEngine } from './wpnav-engine.js'
import glueUrl from './wpnav-glue.js?url'
import wasmUrl from './wpnav.wasm?url'

function loadClassicScript(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = url
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error(`Could not load ${url}`))
    document.head.appendChild(script)
  })
}

let loading: Promise<WpNavEngine> | undefined

/** Load the glue and the wasm once per page and return the engine. */
export function loadWpNav(): Promise<WpNavEngine> {
  loading ??= (async () => {
    if (window.WPNavModule === undefined) await loadClassicScript(glueUrl)
    const factory: WPNavModuleFactory | undefined = window.WPNavModule
    if (factory === undefined) throw new Error('The WPNav WebAssembly glue did not define WPNavModule')
    const module = await factory({ locateFile: (path) => (path.endsWith('.wasm') ? wasmUrl : path) })
    return createEngine(module)
  })().catch((e: unknown) => {
    loading = undefined
    throw e
  })
  return loading
}
