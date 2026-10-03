// Test-only: loads the vendored upstream AnalyticTune page script (with Libraries/Array_Math.js,
// fft.js and Param_Helpers.js) into a node:vm context with a stub DOM built from upstream's
// index.html, so the TypeScript port can be compared against it on identical inputs. Each call
// returns a fresh, isolated instance.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'
import FFT from 'fft.js'

const here = dirname(fileURLToPath(import.meta.url))
export const upstreamDir = resolve(here, '../../../../../upstream')

export type Pair = [number[], number[]]

/** An upstream filter object (any of the constructors). */
export interface UpstreamFilter {
  sample_rate: number
  transfer(z: Pair, z1: Pair, z2: Pair, useDb?: boolean, unwrap?: boolean): Pair
  notches?: { center_freq_hz: number; bandwidth_hz: number; initialised: boolean }[]
}

export interface UpstreamFftSet {
  center: number[]
  [key: string]: Pair[] | number[]
}

/** The page's global state after a calculation. */
export interface UpstreamPageState {
  calc: Record<string, Pair | number[]>
  pred: Record<string, Pair>
  sidSets: { axis: ArrayLike<number>; tlen: ArrayLike<number>; tstart: number[]; tend: number[] }
  vehicleType: string
  pageAxis: string
  sidAxis: number
  aspeed: number
  eas2tas: number
  useAngMessage: boolean
  fftPlot: { data: { x: number[]; y: number[]; visible: boolean }[] }
  fftPlotPhase: { data: { x: number[]; y: number[]; visible: boolean }[] }
  fftPlotCoh: { data: { x: number[]; y: number[]; visible: boolean }[] }
  flightData: { data: { x?: ArrayLike<number>; y?: ArrayLike<number> }[]; layout: { xaxis: { range?: number[] } } }
  dataSet: Record<string, unknown> & { FFT: { bins: number[]; center: number[]; average_sample_rate: number } }
}

export interface UpstreamAnalyticTune {
  PID(sampleRate: number, kP: number, kI: number, kD: number, fltE: number, fltD: number): UpstreamFilter
  Ang_P(sampleRate: number, kP: number): UpstreamFilter
  feedforward(sampleRate: number, kFF: number, kFFD: number): UpstreamFilter
  LPF_1P(sampleRate: number, cutoff: number): UpstreamFilter
  DigitalBiquadFilter(sampleRate: number, cutoff: number): UpstreamFilter
  NotchFilterusingQ(sampleRate: number, center: number, q: number, att: number): UpstreamFilter
  NotchFilter(sampleRate: number, center: number, bandwidth: number, att: number): UpstreamFilter
  get_filters(sampleRate: number): UpstreamFilter[]
  evaluate_transfer_functions(
    groups: UpstreamFilter[][],
    freqMax: number,
    freqStep: number,
    useDb: boolean,
    unwrapPhase: boolean
  ): { attenuation: number[]; phase: number[]; freq: number[]; H_total: Pair }
  unwrap(phase: number[]): number[]
  nearestIndex(arr: ArrayLike<number>, target: number): number
  calculate_freq_resp_from_FFT(
    input: Pair[],
    output: Pair[],
    start: number,
    end: number,
    meanLength: number,
    windowSize: number,
    sampleRate: number
  ): [Pair, number[]]
  calculate_predicted_TF(hAcft: Pair, sampleRate: number, windowSize: number): Pair[]
  param_to_string(value: number): string

  /** Set a form input value as the page would read it. */
  setForm(id: string, value: number | string): void
  getForm(id: string): string
  setChecked(id: string, checked: boolean): void
  /** Set module-level page variables the way the page's own handlers do. */
  setPageAxis(axis: string): void
  setVehicleType(vehicle: string): void
  setSidAxis(axis: number): void
  setAirspeed(aspeed: number, eas2tas: number): void
  setupPlots(): void
  /** Run upstream `save_parameters` and return the saved file's name and text. */
  saveParameters(): { name: string; text: string }
  loadLog(buffer: ArrayBuffer): void
  calculate(): void
  redraw(): void
  state(): UpstreamPageState
}

/** Default value and checked state of every element id in upstream's index.html. */
export interface UpstreamFormDefaults {
  readonly values: ReadonlyMap<string, string>
  readonly checked: ReadonlySet<string>
  readonly ids: ReadonlySet<string>
  readonly steps: ReadonlyMap<string, string>
  /** Ids of number inputs, in form order. */
  readonly numbers: readonly string[]
}

let htmlCache: string | undefined
function upstreamHtml(): string {
  htmlCache ??= readFileSync(resolve(upstreamDir, 'AnalyticTune/index.html'), 'utf8')
  return htmlCache
}

export function upstreamFormDefaults(): UpstreamFormDefaults {
  const html = upstreamHtml()
  const values = new Map<string, string>()
  const steps = new Map<string, string>()
  const checked = new Set<string>()
  const numbers: string[] = []
  for (const m of html.matchAll(/<input\b[^>]*>/g)) {
    const tag = m[0]
    const id = /\bid="([^"]*)"/.exec(tag)?.[1]
    if (id === undefined) continue
    const value = /\bvalue="([^"]*)"/.exec(tag)?.[1]
    if (value !== undefined) values.set(id, value)
    const step = /\bstep="([^"]*)"/.exec(tag)?.[1]
    if (step !== undefined) steps.set(id, step)
    if (/\schecked\b/.test(tag)) checked.add(id)
    if (/\btype="number"/.test(tag)) numbers.push(id)
  }
  const ids = new Set([...html.matchAll(/\bid="([^"]*)"/g)].map((m) => m[1]!))
  return { values, checked, ids, steps, numbers }
}

export function upstreamParamFile(): string {
  return readFileSync(resolve(upstreamDir, 'AnalyticTune/params.json'), 'utf8')
}

let sourceCache: string | undefined
function upstreamSource(): string {
  if (sourceCache !== undefined) return sourceCache
  const libs = ['Libraries/Array_Math.js', 'Libraries/fft.js', 'Libraries/Param_Helpers.js'].map((f) =>
    readFileSync(resolve(upstreamDir, f), 'utf8')
  )
  // The page imports its log parser as an ES module; the test injects it instead.
  const page = readFileSync(resolve(upstreamDir, 'AnalyticTune/AnalyticTune.js'), 'utf8').replace(/^import\(.*$/m, '')
  const stubs = `
function parameter_set_value(name, value) {
  const param = document.getElementById(name)
  if (param == null) return false
  param.value = value
  return true
}
function set_bitmask_size(name, size) {}
function plot_default_color(i) { return '#000000' }
function link_plot_axis_range(link) {}
function link_plot_reset(link) {}
`
  sourceCache =
    [...libs, stubs, page].join('\n;\n') +
    `
;({
  PID: (...a) => new PID(...a),
  Ang_P: (...a) => new Ang_P(...a),
  feedforward: (...a) => new feedforward(...a),
  LPF_1P: (...a) => new LPF_1P(...a),
  DigitalBiquadFilter: (...a) => new DigitalBiquadFilter(...a),
  NotchFilterusingQ: (...a) => new NotchFilterusingQ(...a),
  NotchFilter: (...a) => new NotchFilter(...a),
  get_filters, evaluate_transfer_functions, unwrap, nearestIndex, calculate_freq_resp_from_FFT,
  calculate_predicted_TF, param_to_string,
  setPageAxis: (a) => { page_axis = a },
  setVehicleType: (v) => { vehicle_type = v },
  setSidAxis: (a) => set_sid_axis(a),
  setAirspeed: (a, e) => { aspeed = a; eas2tas = e },
  setupPlots: () => setup_plots(),
  saveParameters: () => { save_parameters(); return __saved() },
  loadLog: (buffer) => load_log(buffer),
  calculate: () => calculate_freq_resp(),
  redraw: () => redraw_freq_resp(),
  state: () => ({
    calc: calc_freq_resp, pred: pred_freq_resp, sidSets: sid_sets, vehicleType: vehicle_type,
    pageAxis: page_axis, sidAxis: sid_axis, aspeed, eas2tas, useAngMessage: use_ANG_message,
    fftPlot: fft_plot, fftPlotPhase: fft_plot_Phase, fftPlotCoh: fft_plot_Coh, flightData: flight_data,
    dataSet: data_set
  })
})`
  return sourceCache
}

/** Upstream `ParameterMetadata.js` lookup: descend through prefix groups to the exact name. */
export function findMetadata(tree: Record<string, unknown>, name: string): Record<string, unknown> | undefined {
  for (const [key, value] of Object.entries(tree)) {
    if (!name.startsWith(key)) continue
    if (key === name) return value as Record<string, unknown>
    const found = findMetadata(value as Record<string, unknown>, name)
    if (found) return found
  }
  return undefined
}

/** Minimal element: value is stored as a string, as the DOM does. */
class StubElement {
  private text = ''
  checked = false
  disabled = false
  hidden = false
  style: Record<string, string> = {}
  dataset: Record<string, string> = {}
  children: unknown[] = []
  get value(): string {
    return this.text
  }
  set value(v: unknown) {
    this.text = String(v)
  }
  appendChild(child: unknown): unknown {
    this.children.push(child)
    return child
  }
  replaceChildren(...children: unknown[]): void {
    this.children = children.filter((c) => c !== undefined)
  }
  setAttribute(): void {
    // Attributes are not modelled.
  }
  on(): void {
    // Plot events are not modelled.
  }
}

type UpstreamApi = Omit<UpstreamAnalyticTune, 'setForm' | 'getForm' | 'setChecked'>

/** Load a fresh upstream AnalyticTune page into its own vm context. `parser` is the upstream DataflashParser class. */
export function loadAnalyticTuneUpstream(parser?: unknown): UpstreamAnalyticTune {
  const defaults = upstreamFormDefaults()
  const elements = new Map<string, StubElement>()
  for (const id of defaults.ids) {
    const e = new StubElement()
    e.value = defaults.values.get(id) ?? ''
    e.checked = defaults.checked.has(id)
    elements.set(id, e)
  }
  const element = (id: string): StubElement => {
    const e = elements.get(id)
    if (e === undefined) throw new Error(`No upstream element ${id}`)
    return e
  }
  // The "params" form: upstream's metadata loader turns enumerated parameters into drop-downs.
  const html = upstreamHtml()
  const formHtml = html.slice(html.indexOf('<form id="params"'), html.indexOf('</form>'))
  const formIds = [...formHtml.matchAll(/<input\b[^>]*\bid="([^"]*)"/g)].map((m) => m[1]!)
  const metadata = JSON.parse(upstreamParamFile()) as Record<string, unknown>
  const isDropDown = (id: string) => findMetadata(metadata, id)?.Values !== undefined && id !== 'SCHED_LOOP_RATE'
  const formElements = (tag: string) =>
    formIds.filter((id) => (tag === 'select') === isDropDown(id)).map((id) => Object.assign(element(id), { id }))
  let saved = { name: '', text: '' }
  const context = createContext({
    document: {
      forms: { params: { getElementsByTagName: formElements } },
      getElementById: (id: string) => elements.get(id) ?? null,
      createElement: () => new StubElement(),
      createTextNode: (text: unknown) => ({ text })
    },
    Plotly: { purge: () => undefined, newPlot: () => undefined, redraw: () => undefined },
    FFTJS: FFT,
    DataflashParser: parser,
    alert: (msg: string) => {
      throw new Error(`upstream alert: ${msg}`)
    },
    console: { log: () => undefined },
    performance: { now: () => 0 },
    Blob: class {
      readonly text: string
      constructor(parts: string[]) {
        this.text = parts.join('')
      }
    },
    saveAs: (blob: { text: string }, name: string) => {
      saved = { name, text: blob.text }
    },
    __saved: () => saved
  })
  const api = runInContext(upstreamSource(), context, { filename: 'upstream-analytic-tune.js' }) as UpstreamApi
  return {
    ...api,
    setForm: (id, value) => {
      element(id).value = value
    },
    getForm: (id) => element(id).value,
    setChecked: (id, checked) => {
      element(id).checked = checked
    }
  }
}

/** The upstream JsDataflashParser class, loaded as the page loads it. */
export async function loadUpstreamParser(): Promise<unknown> {
  // parser.js registers a Worker message listener at module scope.
  const g: Record<string, unknown> = globalThis
  g['self'] ??= { addEventListener: () => undefined, postMessage: () => undefined }
  const path = resolve(upstreamDir, 'modules/JsDataflashParser/parser.js')
  const mod: { default: unknown } = await import(/* @vite-ignore */ path)
  return mod.default
}
