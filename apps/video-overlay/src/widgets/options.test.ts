// Oracle: the port's reading of stored widget options against upstream's VideoOverlay widget
// constructors (and the TelemetryDashboard classes they extend) run in node:vm over a recording
// fake DOM, for well-formed and malformed options.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createContext, runInContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { upstreamDir } from '../test-utils/upstream.js'
import { anyString, type OptionsObject } from './json.js'
import { customHtmlOptions, readBaseOptions, sandboxOptions, subgridOptions } from './options.js'

type Outcome = { readonly threw: string } | { readonly record: Readonly<Record<string, unknown>> }

class FakeElement {
  readonly style: Record<string, unknown> = {}
  readonly classList = { add: (): void => undefined }
  readonly assigned: Record<string, unknown> = {}
  private readonly queried = new Map<string, FakeElement>()
  appendChild(): void {}
  addEventListener(): void {}
  removeChild(): void {}
  querySelector(selector: string): FakeElement {
    let found = this.queried.get(selector)
    if (found === undefined) {
      found = new FakeElement()
      this.queried.set(selector, found)
    }
    return found
  }
  set innerHTML(value: unknown) {
    this.assigned.innerHTML = value
  }
  set srcdoc(value: unknown) {
    this.assigned.srcdoc = value
  }
  get srcdoc(): unknown {
    return this.assigned.srcdoc
  }
}

const FILES = [
  'TelemetryDashboard/Widgets/Base_Class.js',
  'TelemetryDashboard/Widgets/SandBox.js',
  'TelemetryDashboard/Widgets/CustomHTML.js',
  'TelemetryDashboard/Widgets/SubGrid.js',
  'VideoOverlay/Widgets/SandBox.js',
  'VideoOverlay/Widgets/CustomHTML.js',
  'VideoOverlay/Widgets/SubGrid.js'
]

type VoType = 'WidgetSandBoxVideoOverlay' | 'WidgetCustomHTMLVideoOverlay' | 'WidgetSubGridVideoOverlay'

async function upstreamOutcome(type: VoType, options: unknown): Promise<Outcome> {
  const forms: { definition?: unknown; content?: unknown } = {}
  const grid = { on: () => undefined, getGridItems: () => [], enable: () => undefined, disable: () => undefined }
  const context: Record<string, unknown> = {
    HTMLElement: FakeElement,
    customElements: { define: () => undefined },
    document: { createElement: () => new FakeElement(), getElementById: () => ({ content: {} }), importNode: () => ({}) },
    tippy: () => ({ destroy: () => undefined, show: () => undefined, hide: () => undefined, setProps: () => undefined }),
    Formio: {
      createForm: (_div: unknown, definition: unknown) => {
        forms.definition = definition
        return Promise.resolve({
          form: {},
          submission: { data: {} },
          setForm: () => Promise.resolve(),
          setSubmission: (submission: { data: unknown }) => {
            forms.content = submission.data
            return new Promise(() => undefined)
          },
          on: () => undefined
        })
      }
    },
    GridStack: { init: () => grid },
    grid_set_edit: () => undefined,
    clear_grid: () => undefined,
    get_widgets: () => ({}),
    widget_dropped: () => undefined,
    setTimeout: () => 0,
    log: null
  }
  const vm = createContext(context)
  for (const file of FILES) runInContext(readFileSync(join(upstreamDir, file), 'utf8'), vm)
  context.options = options
  let widget: Record<string, unknown>
  try {
    widget = runInContext(`new ${type}(options)`, vm) as Record<string, unknown>
  } catch (error) {
    return { threw: String(Reflect.get(Object(error), 'message')) }
  }
  for (let i = 0; i < 5; i++) await Promise.resolve()
  const tip = widget.tippy_div as FakeElement
  const iframe = widget.iframe as FakeElement | undefined
  return {
    record: {
      about: widget.about,
      nameHtml: tip.querySelector('span[id="NameSpan"]').assigned.innerHTML,
      formDefinition: forms.definition,
      formContent: forms.content,
      ...(type === 'WidgetSandBoxVideoOverlay' ? { script: widget.script_text } : {}),
      ...(type === 'WidgetCustomHTMLVideoOverlay' ? { srcdoc: anyString(iframe?.srcdoc) } : {}),
      ...(type === 'WidgetSubGridVideoOverlay'
        ? { gridRows: widget.grid_rows, gridColumns: widget.grid_columns, widgetsToLoad: widget.widgets_to_load }
        : {})
    }
  }
}

function portOutcome(type: VoType, raw: unknown): Outcome {
  try {
    const base = (options: OptionsObject) => {
      const b = readBaseOptions(options, type)
      return { about: b.about, nameHtml: b.name, formDefinition: b.formDefinition, formContent: b.formContent }
    }
    switch (type) {
      case 'WidgetSandBoxVideoOverlay': {
        const { options, script } = sandboxOptions(raw)
        return { record: { ...base(options), script } }
      }
      case 'WidgetCustomHTMLVideoOverlay': {
        const { options, srcdoc } = customHtmlOptions(raw)
        return { record: { ...base(options), srcdoc } }
      }
      case 'WidgetSubGridVideoOverlay': {
        const { options, content } = subgridOptions(raw)
        return {
          record: {
            ...base(options),
            gridRows: content?.rows,
            gridColumns: content?.columns,
            widgetsToLoad: content === null ? null : content.widgets
          }
        }
      }
    }
  } catch (error) {
    return { threw: error instanceof Error ? error.message : String(error) }
  }
}

function normalise(outcome: Outcome): unknown {
  if ('threw' in outcome) return outcome
  return Object.fromEntries(Object.entries(outcome.record).map(([k, v]) => [k, v === undefined ? undefined : structuredClone(v)]))
}

const OPTIONS: readonly unknown[] = [
  undefined,
  null,
  'abc',
  5,
  false,
  [],
  {},
  { about: null },
  { about: 'text' },
  { about: { name: '<i>Alt</i>', info: null } },
  { form: 'https://example.com/form' },
  { form: null, form_content: [] },
  { form: { components: [] }, form_content: { a: 1 } },
  { form_content: { a: 1 } },
  { sandbox: null },
  { sandbox: 3 },
  { sandbox: 'setTime = 1' },
  { custom_HTML: null },
  { custom_HTML: [1, null] },
  { form_content: 5 },
  { form_content: null },
  { form_content: { rows: '3', columns: 2 }, widgets: null },
  { form_content: { rows: 2, columns: 2 }, widgets: { 0: {} } },
  { form_content: { columns: 2 } }
]

const TYPES: readonly VoType[] = ['WidgetSandBoxVideoOverlay', 'WidgetCustomHTMLVideoOverlay', 'WidgetSubGridVideoOverlay']

describe('VideoOverlay widget options against upstream constructors', () => {
  for (const type of TYPES) {
    it(`${type} reads, keeps and rejects options as upstream`, async () => {
      for (const raw of OPTIONS) {
        const theirs = await upstreamOutcome(type, structuredClone(raw))
        expect(normalise(portOutcome(type, structuredClone(raw))), `${type} ${JSON.stringify(raw)}`).toEqual(normalise(theirs))
      }
    })
  }
})
