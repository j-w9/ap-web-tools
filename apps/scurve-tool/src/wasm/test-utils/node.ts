// Test-only: instantiates the verbatim Emscripten glue in a node:vm context. The glue was built
// for the web, so the context gets a `window` to pass its environment check and the wasm bytes
// are handed over directly instead of fetched.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext, type Context } from 'node:vm'
import type { WpNavEngine } from '../../analysis/engine.js'
import type { WPNavModuleFactory, WPNavModuleInstance } from '../wpnav-glue.js'
import { createEngine } from '../wpnav-engine.js'

const here = dirname(fileURLToPath(import.meta.url))
export const GLUE_PATH = resolve(here, '../wpnav-glue.js')
export const WASM_PATH = resolve(here, '../wpnav.wasm')

/** A fresh vm context with what the web-targeted glue expects. */
export function glueContext(extra: Record<string, unknown> = {}): Context {
  return createContext({ window: {}, console, WebAssembly, TextDecoder, setTimeout, clearTimeout, ...extra })
}

/** Run the glue in `context` and return its factory. */
export function loadGlue(context: Context): WPNavModuleFactory {
  return runInContext(`${readFileSync(GLUE_PATH, 'utf8')}\n;WPNavModule`, context, { filename: 'wpnav-glue.js' })
}

export function wasmBinary(): Uint8Array {
  return new Uint8Array(readFileSync(WASM_PATH))
}

let cached: Promise<WPNavModuleInstance> | undefined

/** The module, instantiated once per test file. */
export function nodeModule(): Promise<WPNavModuleInstance> {
  return (cached ??= loadGlue(glueContext())({ wasmBinary: wasmBinary() }))
}

export async function nodeEngine(): Promise<WpNavEngine> {
  return createEngine(await nodeModule())
}
