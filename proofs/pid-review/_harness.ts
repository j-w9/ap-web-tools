// Test-only: loads upstream PIDReview.js (with Libraries/Array_Math.js and fft.js) into a node:vm
// context with a minimal fake DOM, so single page functions can be run on hand-built inputs.
// Adapted from apps/pid-review/src/test-utils/upstream.ts (copied, not imported).
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'
import FFT from 'fft.js'

const here = dirname(fileURLToPath(import.meta.url))
const upstreamDir = resolve(here, '../../upstream')
const read = (rel: string): string => readFileSync(resolve(upstreamDir, rel), 'utf8')

/** Minimal element: the properties PIDReview.js reads and writes. `Spec_*` ids form one radio group. */
export class FakeElement {
  private isChecked = false
  disabled = false
  value = ''
  readonly style: Record<string, string> = {}
  readonly children: unknown[] = []
  constructor(
    readonly id: string,
    private readonly registry: Map<string, FakeElement>
  ) {}
  get checked(): boolean {
    return this.isChecked
  }
  set checked(value: boolean) {
    this.isChecked = value
    if (!value || !this.id.startsWith('Spec_')) return
    for (const [id, el] of this.registry) {
      if (el !== this && id.startsWith('Spec_')) el.isChecked = false
    }
  }
  setAttribute(): void {}
  appendChild(child: unknown): void {
    this.children.push(child)
  }
  replaceChildren(): void {
    this.children.length = 0
  }
}

/** Handle on one upstream PID Review script instance. */
export interface PidReviewPage {
  /** Evaluate code in the page's global scope. */
  run(code: string): unknown
  /** Set a global visible to `run`. */
  set(name: string, value: unknown): void
  /** The element with this id (created on first use). */
  element(id: string): FakeElement
}

/** Load a fresh copy of upstream PIDReview.js. */
export function loadPidReview(): PidReviewPage {
  const registry = new Map<string, FakeElement>()
  const element = (id: string): FakeElement => {
    let el = registry.get(id)
    if (el === undefined) {
      el = new FakeElement(id, registry)
      registry.set(id, el)
    }
    return el
  }
  const noop = (): undefined => undefined
  const context = createContext({
    console: { log: noop },
    document: {
      getElementById: element,
      createElement: () => new FakeElement('', new Map()),
      createTextNode: (text: unknown) => ({ text })
    },
    Plotly: { redraw: noop, newPlot: noop, purge: noop },
    FFTJS: FFT,
    plot_default_color: (i: number) => `#color${String(i)}`
  })
  const page = read('PIDReview/PIDReview.js').replace(
    /^const import_done = import\(.*$/m,
    'const import_done = Promise.resolve()'
  )
  if (page.includes("import('")) throw new Error('upstream PIDReview.js import line not found')
  for (const [name, source] of [
    ['Array_Math.js', read('Libraries/Array_Math.js')],
    ['fft.js', read('Libraries/fft.js')],
    ['PIDReview.js', page]
  ] as const) {
    runInContext(source, context, { filename: name })
  }
  return {
    run: (code): unknown => runInContext(code, context) as unknown,
    set: (name, value) => {
      ;(context as Record<string, unknown>)[name] = value
    },
    element
  }
}
