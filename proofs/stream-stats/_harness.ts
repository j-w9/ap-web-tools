/**
 * Runs the original Stream Stats (`StreamStats/StreamStats.js` with `Array_Math.js` and
 * `mavlink_msgs.js`) in a `node:vm` context with a minimal fake DOM and Plotly. The `.bin` path is
 * driven with the original JsDataflashParser. Loader lines copied from
 * `apps/stream-stats/src/analysis/test-support/upstream.ts`.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const upstream = join(here, '..', '..', 'upstream')

/** Stand-in for every DOM element the page touches. */
class FakeElement {
  hidden = false
  innerHTML = ''
  checked = false
  disabled = false
  value = ''
  readonly children: unknown[] = []
  get previousElementSibling(): FakeElement {
    return new FakeElement()
  }
  get parentElement(): FakeElement {
    return new FakeElement()
  }
  appendChild(child: unknown): unknown {
    this.children.push(child)
    return child
  }
  replaceChildren(): void {
    this.children.length = 0
  }
  setAttribute(): void {}
  addEventListener(): void {}
  removeAllListeners(): void {}
}

export interface Trace {
  x: number[] | null
  y: number[] | null
  name?: string
  hovertemplate?: string
}

export interface PieTrace {
  labels: string[]
  values: number[]
  hovertemplate: string
}

interface Context {
  plot_log(): void
  reset(): void
  log: unknown
  data_rates: { data: Trace[]; layout: { yaxis: { title: { text: string } } } }
  total_rate: { data: Trace[] }
  log_stats: { data: PieTrace[] }
}

export interface StreamStatsPage {
  /** Set the Window size box and the Bits per second / Messages per second radio. */
  setSettings(windowSize: string, bits: boolean): void
  /** Assign the page's `log` and run `plot_log()` (what `load_log` does after parsing). */
  plotLog(log: unknown): void
  rates(): Trace[]
  rateAxis(): string
  total(): Trace
  composition(): PieTrace
  /** Text nodes appended to the LOGSTATS element. */
  logStatsText(): string[]
}

/** A fresh page (each has its own globals). */
export function loadStreamStats(): StreamStatsPage {
  // Drop the dynamic import of the parser: vm contexts can not import; the log is passed in.
  const page = readFileSync(join(upstream, 'StreamStats/StreamStats.js'), 'utf8').replace(
    /^import\(.*$/m,
    '// import removed for tests'
  )
  const source = [
    readFileSync(join(upstream, 'Libraries/Array_Math.js'), 'utf8'),
    readFileSync(join(upstream, 'StreamStats/mavlink_msgs.js'), 'utf8'),
    page,
    `;({
      plot_log, reset,
      get log() { return log }, set log(v) { log = v },
      get data_rates() { return data_rates },
      get total_rate() { return total_rate },
      get log_stats() { return log_stats }
    })`
  ].join('\n')

  const elements = new Map<string, FakeElement>()
  const element = (id: string): FakeElement => {
    let el = elements.get(id)
    if (el === undefined) {
      el = new FakeElement()
      elements.set(id, el)
    }
    return el
  }
  // index.html defaults: value="10", Bits per second checked.
  element('WindowSize').value = '10'
  element('Unit_bps').checked = true

  const noop = (): undefined => undefined
  const context = createContext({
    console: { log: noop },
    performance: { now: () => 0 },
    alert: noop,
    document: {
      getElementById: element,
      createElement: () => new FakeElement(),
      createTextNode: (text: string) => ({ text })
    },
    Plotly: { purge: noop, newPlot: noop, redraw: noop },
    link_plot_axis_range: noop,
    link_plot_reset: noop,
    open_in_update: noop
  })
  const ctx = runInContext(source, context, { filename: 'StreamStats.js' }) as Context
  ctx.reset()

  return {
    setSettings: (windowSize, bits) => {
      element('WindowSize').value = windowSize
      element('Unit_bps').checked = bits
    },
    plotLog: (log) => {
      ctx.log = log
      ctx.plot_log()
    },
    rates: () => ctx.data_rates.data,
    rateAxis: () => ctx.data_rates.layout.yaxis.title.text,
    total: () => ctx.total_rate.data[0]!,
    composition: () => ctx.log_stats.data[0]!,
    logStatsText: () => (element('LOGSTATS').children as { text: string }[]).map((c) => c.text)
  }
}

/** The original JsDataflashParser, as `load_log` uses it (`new DataflashParser(); processData(buf, [])`). */
export async function parseWithOriginal(bytes: Uint8Array): Promise<unknown> {
  if (!('self' in globalThis)) {
    Object.defineProperty(globalThis, 'self', {
      value: { addEventListener: () => undefined, postMessage: () => undefined },
      configurable: true
    })
  }
  const mod = (await import(/* @vite-ignore */ join(upstream, 'modules/JsDataflashParser/parser.js'))) as {
    default: new () => { processData(b: ArrayBuffer, m: string[]): unknown }
  }
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const orig = console.log
  console.log = () => undefined
  try {
    const log = new mod.default()
    log.processData(copy.buffer, [])
    return log
  } finally {
    console.log = orig
  }
}
