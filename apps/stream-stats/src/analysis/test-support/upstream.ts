/**
 * Test-only: runs the vendored upstream Stream Stats (StreamStats.js, mavlink_msgs.js and
 * Array_Math.js) in a `node:vm` context with a minimal fake DOM and Plotly, so the port can be
 * compared with it on identical inputs. Pattern from `packages/signal/src/test-utils/upstream.ts`.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'

/** Stand-in for every DOM element upstream touches. */
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
  get parentElement(): FakeElement {
    return new FakeElement()
  }
}

export interface UpstreamTrace {
  x: number[] | null
  y: number[] | null
  name?: string
  type?: string
}

export interface UpstreamMsg {
  time: number[]
  size: number[]
  version: Set<number>
  signed: boolean | number
  include: FakeElement
}

export interface UpstreamComp {
  next_seq: number
  received: number
  dropped: number
  msg: Record<string, UpstreamMsg>
  version: Set<number>
  signed: boolean | number
  include: FakeElement
}

export interface UpstreamFakeBinLog {
  stats(): Record<string, { count: number; msg_size: number; size: number }>
  messageTypes: Record<string, { expressions: string[]; instances?: Record<string, unknown> }>
  get(name: string, field: string): number[]
  get_instance(name: string, instance: string, field: string): number[]
  data: { byteLength: number }
}

export interface UpstreamStreamStats {
  /** Run `load_tlog` (and its `plot_tlog`) on a buffer. */
  loadTlog(buffer: ArrayBuffer): void
  /** Re-run `plot_tlog` after changing settings or include checkboxes. */
  plotTlog(): void
  /** Run `plot_log` with an upstream-shaped log object. */
  plotLog(log: UpstreamFakeBinLog): void
  setSettings(binWidth: number, bits: boolean): void
  system(): Record<string, Record<string, UpstreamComp>>
  rates(): UpstreamTrace[]
  total(): UpstreamTrace
  composition(): { labels: string[]; values: number[] }
  alerts: string[]
  bin_count(
    time: number[],
    size: number | number[],
    width: number,
    total: { count: number[]; low_bin: number; high_bin: number }
  ): {
    time: number[]
    count: number[]
  }
  total_count(
    total: { count: number[]; low_bin: number; high_bin: number },
    width: number
  ): { time: number[] | null; count: number[] | null }
}

interface Context {
  load_tlog(buffer: ArrayBuffer): void
  plot_tlog(): void
  plot_log(): void
  reset(): void
  bin_count: UpstreamStreamStats['bin_count']
  total_count: UpstreamStreamStats['total_count']
  log: UpstreamFakeBinLog | null
  system: Record<string, Record<string, UpstreamComp>>
  data_rates: { data: UpstreamTrace[] }
  total_rate: { data: UpstreamTrace[] }
  log_stats: { data: { labels: string[]; values: number[] }[] }
}

/** Fresh upstream instance (each has its own globals). */
export function loadUpstream(): UpstreamStreamStats {
  const here = dirname(fileURLToPath(import.meta.url))
  const root = resolve(here, '../../../../../upstream')
  // Drop the dynamic import of the DataFlash parser: vm contexts cannot import, and the
  // `.bin` path is driven with a fake log object instead.
  const streamStats = readFileSync(resolve(root, 'StreamStats/StreamStats.js'), 'utf8').replace(
    /^import\(.*$/m,
    '// import removed for tests'
  )
  const source = [
    readFileSync(resolve(root, 'Libraries/Array_Math.js'), 'utf8'),
    readFileSync(resolve(root, 'StreamStats/mavlink_msgs.js'), 'utf8'),
    streamStats,
    // Expose script-scope bindings (let/function) through accessors.
    `;({
      load_tlog, plot_tlog, plot_log, reset, bin_count, total_count,
      get log() { return log }, set log(v) { log = v },
      get system() { return system },
      get data_rates() { return data_rates },
      get total_rate() { return total_rate },
      get log_stats() { return log_stats }
    })`
  ].join('\n')

  const elements = new Map<string, FakeElement>()
  const element = (id: string) => {
    let el = elements.get(id)
    if (el === undefined) {
      el = new FakeElement()
      elements.set(id, el)
    }
    return el
  }
  element('WindowSize').value = '10'
  element('Unit_bps').checked = true

  const alerts: string[] = []
  const noop = () => undefined
  const context = createContext({
    console: { log: noop },
    performance: { now: () => 0 },
    alert: (m: string) => alerts.push(m),
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
  const ctx = runInContext(source, context, { filename: 'upstream-stream-stats.js' }) as Context
  ctx.reset()

  return {
    loadTlog: (buffer) => ctx.load_tlog(buffer),
    plotTlog: () => ctx.plot_tlog(),
    plotLog: (log) => {
      ctx.log = log
      ctx.plot_log()
    },
    setSettings: (binWidth, bits) => {
      element('WindowSize').value = String(binWidth)
      element('Unit_bps').checked = bits
    },
    system: () => ctx.system,
    rates: () => ctx.data_rates.data,
    total: () => ctx.total_rate.data[0]!,
    composition: () => ctx.log_stats.data[0]!,
    alerts,
    bin_count: (...args) => ctx.bin_count(...args),
    total_count: (...args) => ctx.total_count(...args)
  }
}

/** The upstream message and component tables. */
export function loadUpstreamTables(): {
  messages: ({ name: string; CRC: number } | undefined)[]
  components: (string | undefined)[]
} {
  const here = dirname(fileURLToPath(import.meta.url))
  const source = readFileSync(resolve(here, '../../../../../upstream/StreamStats/mavlink_msgs.js'), 'utf8')
  const context = createContext({})
  return runInContext(`${source}\n;({ messages: mavlink_msgs, components: MAV_COMPONENT })`, context) as {
    messages: ({ name: string; CRC: number } | undefined)[]
    components: (string | undefined)[]
  }
}
