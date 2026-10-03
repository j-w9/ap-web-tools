// Loads one tool's original filter code (with Libraries/Array_Math.js) into its own node:vm context,
// as packages/filters/src/test-utils/upstream.ts does (copied so proofs do not depend on code being
// edited). The page's dynamic import of the log parser is dropped. `get_form` reads the stub
// `document`, whose inputs are set with `setForm`.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const upstreamDir = resolve(here, '../../upstream')

const SCRIPTS = {
  FilterTool: 'FilterTool/filters.js',
  AnalyticTune: 'AnalyticTune/AnalyticTune.js'
} as const

export type FilterScriptTool = keyof typeof SCRIPTS

export interface FilterScript {
  /** Evaluate code in the script's global scope. */
  run(code: string): unknown
  /** Set a page input read by `get_form`. */
  setForm(id: string, value: string): void
}

export function loadFilterScript(tool: FilterScriptTool): FilterScript {
  const source = ['Libraries/Array_Math.js', SCRIPTS[tool]]
    .map((f) => readFileSync(resolve(upstreamDir, f), 'utf8').replace(/^.*\bimport\(.*$/gm, ''))
    .join('\n;\n')
  const form = new Map<string, { value: string }>()
  const getElementById = (id: string) => {
    let e = form.get(id)
    if (e === undefined) {
      e = { value: '' }
      form.set(id, e)
    }
    return e
  }
  const context = createContext({
    document: { getElementById, cookie: '' },
    console: { log: () => undefined }
  })
  runInContext(source, context, { filename: `upstream-${tool}.js` })
  return {
    run: (code) => runInContext(code, context) as unknown,
    setForm: (id, value) => {
      getElementById(id).value = value
    }
  }
}
