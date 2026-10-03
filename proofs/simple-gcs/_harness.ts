/**
 * Runs pieces of the original SimpleGCS (`upstream/SimpleGCS/`) unchanged in `node:vm` with fake
 * browser globals. Loader lines copied from `apps/simple-gcs/src/test-utils/upstream.ts` and the
 * Simple GCS oracle tests (`google-maps.oracle.test.ts`, `reader.oracle.test.ts`).
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

export const UPSTREAM = resolve(dirname(fileURLToPath(import.meta.url)), '../../upstream')
export const REPO = resolve(UPSTREAM, '..')
const require = createRequire(import.meta.url)

export const upstreamSource = (path: string): string => readFileSync(resolve(UPSTREAM, path), 'utf8')

/** Text from `start` to the brace closing the first `{` at or after it. */
function braceMatched(text: string, start: number, what: string): string {
  let depth = 0
  for (let i = text.indexOf('{', start); i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}' && --depth === 0) return text.slice(start, i + 1)
  }
  throw new Error(`unbalanced ${what}`)
}

/** Source of `function name(...) { ... }` (top level or nested) in an upstream file. */
export function functionSource(file: string, name: string): string {
  const text = upstreamSource(file)
  const start = text.indexOf(`function ${name}(`)
  if (start === -1) throw new Error(`${name} not found in ${file}`)
  return braceMatched(text, start, name)
}

/** Source of a class method `name(...) { ... }` (its first definition) in an upstream file. */
export function methodSource(file: string, name: string): string {
  const text = upstreamSource(file)
  const match = new RegExp(`^\\s+${name}\\([^)]*\\)\\s*\\{`, 'm').exec(text)
  if (match === null) throw new Error(`${name} not found in ${file}`)
  return braceMatched(text, match.index + match[0].indexOf(name), name).trim()
}

/** Upstream `modules/MAVLink/mavlink.js` (its CommonJS path), the dialect SimpleGCS loads. */
export function upstreamMavlink20(): Record<string, unknown> {
  const mod = require(resolve(UPSTREAM, 'modules/MAVLink/mavlink.js')) as { mavlink20: Record<string, unknown> }
  return mod.mavlink20
}

/** Upstream `SimpleGCS/util.js` `window.GMapsLoader` on a fake window and document. */
export function upstreamGMapsLoader() {
  const scripts: { src: string }[] = []
  const win: Record<string, unknown> = {}
  const document = {
    createElement: () => ({ src: '', async: false, defer: false, onerror: null }),
    head: { appendChild: (s: { src: string }) => void scripts.push(s) }
  }
  runInNewContext(upstreamSource('SimpleGCS/util.js'), { window: win, document, encodeURIComponent, Promise, Error })
  return { loader: win.GMapsLoader as { load(key: string): Promise<void> }, scripts, win }
}
