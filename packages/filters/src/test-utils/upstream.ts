// Test-only: loads one upstream tool's filter code (with Libraries/Array_Math.js) into its own
// node:vm context, so the shared models can be compared with each tool's original on identical
// inputs. Only the filter constructors and helpers are used, so no DOM stub is needed; the page's
// dynamic import of the log parser is dropped.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const upstreamDir = resolve(here, '../../../../upstream')

export type Pair = [number[], number[]]

/** The upstream script each tool's filters live in. */
const SCRIPTS = {
  FilterTool: 'FilterTool/filters.js',
  AnalyticTune: 'AnalyticTune/AnalyticTune.js',
  FilterReview: 'FilterReview/FilterReview.js'
} as const

export type UpstreamTool = keyof typeof SCRIPTS

/** Handle on one tool's upstream script. */
export interface UpstreamScript {
  /** Evaluate code in the script's global scope. */
  run(code: string): unknown
  /** Set a global visible to `run`. */
  set(name: string, value: unknown): void
}

/** Load a fresh, isolated copy of a tool's upstream script. */
export function loadUpstream(tool: UpstreamTool): UpstreamScript {
  const source = ['Libraries/Array_Math.js', SCRIPTS[tool]]
    .map((f) => readFileSync(resolve(upstreamDir, f), 'utf8').replace(/^.*\bimport\(.*$/gm, ''))
    .join('\n;\n')
  const context = createContext({ console: { log: () => undefined } })
  runInContext(source, context, { filename: `upstream-${tool}.js` })
  return {
    run: (code) => runInContext(code, context),
    set: (name, value) => {
      ;(context as Record<string, unknown>)[name] = value
    }
  }
}

/**
 * Upstream `evaluate_transfer_functions` on one group of filters built by `construct` (an
 * expression evaluated in the script, e.g. `[new PID(400, 0.1, 0, 0, 0, 0)]`).
 */
export function evaluateUpstream(
  up: UpstreamScript,
  construct: string,
  freqMax: number,
  freqStep: number
): { freq: number[]; H_total?: Pair; attenuation: number[]; phase: number[] } {
  return up.run(`evaluate_transfer_functions([[${construct}]], ${freqMax}, ${freqStep}, false, false)`) as {
    freq: number[]
    H_total?: Pair
    attenuation: number[]
    phase: number[]
  }
}
