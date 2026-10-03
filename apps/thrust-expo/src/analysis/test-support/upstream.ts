// Test-only: runs the vendored upstream ThrustExpo.js (with Array_Math.js and Param_Helpers.js)
// in a node:vm context behind a minimal fake DOM, Plotly, Tabulator and FileSaver, so the
// TypeScript port can be compared against the real page logic on identical inputs.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'

export interface UpstreamTrace {
  x: ArrayLike<number>
  y: ArrayLike<number>
  name: string
}

export interface UpstreamShape {
  x0: number
  y0: number
  y1: number
  visible?: boolean
  line: { color: string }
}

export interface UpstreamAnnotation {
  x: number
  text: string
}

interface UpstreamPlot {
  data: UpstreamTrace[]
  layout: { shapes: UpstreamShape[] | null; annotations?: UpstreamAnnotation[] | null }
}

interface UpstreamParam {
  value: number | null
  save: boolean
}

export type UpstreamRow = Partial<Record<'pwm' | 'thrust' | 'voltage' | 'current', number | string>>

interface UpstreamExports {
  params: Record<string, UpstreamParam>
  thrustExpoPlot: UpstreamPlot
  thrustErrorPlot: UpstreamPlot
  thrustPwmPlot: UpstreamPlot
  updatePlotData(expo?: number | null): void
  loadExample(): void
  reset(): void
  saveParamFile(): void
  loadParamFile(input: { files: { text: string }[] }): void
  createSpinMarkers(usePwm: boolean): { shapes: UpstreamShape[]; annotations: UpstreamAnnotation[] }
}

/** A fake `<input>`: coerces values to strings like a number input and dispatches listeners. */
class FakeInput {
  readonly name: string
  private text = ''
  private readonly listeners = new Map<string, ((this: FakeInput, e: Event) => void)[]>()
  constructor(readonly id: string) {
    this.name = id
  }
  get value(): string {
    return this.text
  }
  set value(v: unknown) {
    const s = String(v)
    // A number input sanitises anything that is not a valid number to the empty string.
    this.text = s === '' || Number.isNaN(Number(s)) ? '' : s
  }
  addEventListener(type: string, fn: (this: FakeInput, e: Event) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn])
  }
  dispatchEvent(e: Event): void {
    for (const fn of this.listeners.get(e.type) ?? []) fn.call(this, e)
  }
}

// index.html `.param-row input` elements, in document order.
const INPUT_IDS = [
  'MOT_SPIN_ARM',
  'MOT_SPIN_MIN',
  'MOT_SPIN_MAX',
  'MOT_PWM_MIN',
  'MOT_PWM_MAX',
  'MOT_THST_EXPO',
  'MOTOR_COUNT',
  'MOT_THST_HOVER',
  'COPTER_AUW'
]

export interface UpstreamPage {
  readonly api: UpstreamExports
  input(id: string): FakeInput
  setRows(rows: UpstreamRow[]): void
  /** Text of the last saved parameter file. */
  savedText(): Promise<string>
}

/** A fresh upstream page, initialised and reset as on DOMContentLoaded. */
export function loadUpstreamPage(): UpstreamPage {
  const here = dirname(fileURLToPath(import.meta.url))
  const root = resolve(here, '../../../../../upstream')
  const source =
    readFileSync(resolve(root, 'Libraries/Array_Math.js'), 'utf8') +
    '\n' +
    readFileSync(resolve(root, 'Libraries/Param_Helpers.js'), 'utf8') +
    '\n' +
    readFileSync(resolve(root, 'ThrustExpo/ThrustExpo.js'), 'utf8') +
    `
;thrustTable = __table
initParamInputs()
initThrustExpoPlot()
initThrustErrorPlot()
initThrustPwmPlot()
reset()
;({ params, thrustExpoPlot, thrustErrorPlot, thrustPwmPlot, updatePlotData, loadExample, reset, saveParamFile, loadParamFile, createSpinMarkers })`

  const elements = new Map<string, FakeInput>()
  for (const id of [...INPUT_IDS, 'paramFile']) elements.set(id, new FakeInput(id))
  let tableData: UpstreamRow[] = []
  const table = {
    getData: () => tableData,
    setData: (d: UpstreamRow[]) => {
      tableData = d
    },
    addRow: (r: UpstreamRow) => {
      tableData.push(r)
    },
    on: () => undefined
  }
  let saved: Blob | undefined

  const context = createContext({
    __table: table,
    document: {
      getElementById: (id: string) => elements.get(id) ?? null,
      querySelectorAll: () => INPUT_IDS.map((id) => elements.get(id)),
      addEventListener: () => undefined
    },
    window: { addEventListener: () => undefined },
    Plotly: { react: () => undefined, newPlot: () => undefined, purge: () => undefined, relayout: () => undefined },
    Event,
    Blob,
    saveAs: (blob: Blob) => {
      saved = blob
    },
    FileReader: class {
      onload: ((e: { target: { result: string } }) => void) | null = null
      readAsText(file: { text: string }) {
        this.onload?.({ target: { result: file.text } })
      }
    },
    load_param_inputs: () => undefined,
    tippy: () => undefined
  })
  const api = runInContext(source, context, { filename: 'ThrustExpo.js' }) as UpstreamExports

  return {
    api,
    input: (id) => {
      const el = elements.get(id)
      if (!el) throw new Error(`no input ${id}`)
      return el
    },
    setRows: (rows) => {
      tableData = rows
    },
    savedText: async () => {
      if (!saved) throw new Error('nothing saved')
      return saved.text()
    }
  }
}
