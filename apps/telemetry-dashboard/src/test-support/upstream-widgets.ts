/**
 * Test-only: upstream's widget classes (Widgets/Base_Class.js, SandBox.js, CustomHTML.js,
 * SubGrid.js, Menu.js) run in a `node:vm` context over a recording fake DOM, so the port's reading
 * of widget options can be compared with what the original constructors did.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createContext, runInContext } from 'node:vm'
import { UPSTREAM_DIR } from './upstream-mavlink.js'

/** What one upstream constructor did with its options. */
export interface UpstreamWidgetRecord {
  /** `this.about` */
  readonly about: unknown
  /** The value assigned to the popup's name span (`innerHTML`). */
  readonly nameHtml: unknown
  /** The definition passed to `Formio.createForm` and `setForm`. */
  readonly formDefinition: unknown
  /** The data passed to `setSubmission`. */
  readonly formContent: unknown
  /** Sandbox `script_text`, custom HTML `iframe.srcdoc`, sub grid size and widgets. */
  readonly scriptText?: unknown
  readonly srcdoc?: unknown
  readonly gridRows?: unknown
  readonly gridColumns?: unknown
  readonly widgetsToLoad?: unknown
}

export type UpstreamWidgetOutcome = { readonly threw: string } | { readonly record: UpstreamWidgetRecord }

/** A fake element: any property can be set; queried children are fake elements too. */
class FakeElement {
  readonly style: Record<string, unknown> = {}
  readonly classList = { add: (): void => undefined }
  readonly assigned: Record<string, unknown> = {}
  private readonly queried = new Map<string, FakeElement>()
  readonly children: unknown[] = []
  appendChild(child: unknown): unknown {
    this.children.push(child)
    return child
  }
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

const FILES = ['Base_Class.js', 'SandBox.js', 'CustomHTML.js', 'SubGrid.js', 'Menu.js']

export type UpstreamWidgetType = 'WidgetSandBox' | 'WidgetCustomHTML' | 'WidgetSubGrid' | 'WidgetMenu'

/** Constructs `new <type>(options)` with upstream's classes and reports what it did. */
export async function constructUpstreamWidget(type: UpstreamWidgetType, options: unknown): Promise<UpstreamWidgetOutcome> {
  const forms: { definition?: unknown; content?: unknown } = {}
  const fakeGrid = { on: () => undefined, getGridItems: () => [], enable: () => undefined, disable: () => undefined }
  const context: Record<string, unknown> = {
    HTMLElement: FakeElement,
    customElements: { define: () => undefined },
    document: {
      createElement: () => new FakeElement(),
      getElementById: () => ({ content: {} }),
      importNode: () => ({})
    },
    tippy: () => ({ destroy: () => undefined, show: () => undefined, hide: () => undefined, setProps: () => undefined }),
    Formio: {
      createForm: (_div: unknown, definition: unknown) => {
        forms.definition = definition
        return Promise.resolve({
          form: {},
          submission: { data: {} },
          setForm: () => Promise.resolve(),
          // Recorded; never resolves, so no form callbacks run.
          setSubmission: (submission: { data: unknown }) => {
            forms.content = submission.data
            return new Promise(() => undefined)
          },
          on: () => undefined
        })
      }
    },
    GridStack: { init: () => fakeGrid },
    grid_set_edit: () => undefined,
    clear_grid: () => undefined,
    get_widgets: () => ({}),
    widget_dropped: () => undefined,
    ResizeObserver: class {
      observe(): void {}
    }
  }
  const vm = createContext(context)
  for (const file of FILES) runInContext(readFileSync(resolve(UPSTREAM_DIR, 'TelemetryDashboard/Widgets', file), 'utf8'), vm)
  context.options = options
  let widget: Record<string, unknown> & FakeElement
  try {
    widget = runInContext(`new ${type}(options)`, vm) as Record<string, unknown> & FakeElement
  } catch (error) {
    return {
      threw:
        error instanceof Error || (typeof error === 'object' && error !== null)
          ? String(Reflect.get(error, 'message'))
          : String(error)
    }
  }
  // Let `createForm(...).then(setForm).then(setSubmission)` run.
  for (let i = 0; i < 5; i++) await Promise.resolve()
  const tip = widget.tippy_div as FakeElement
  const iframe = widget.iframe as FakeElement | undefined
  return {
    record: {
      about: widget.about,
      nameHtml: tip.querySelector('span[id="NameSpan"]').assigned.innerHTML,
      formDefinition: forms.definition,
      formContent: forms.content,
      ...(type === 'WidgetSandBox' ? { scriptText: widget.script_text } : {}),
      ...(type === 'WidgetCustomHTML' ? { srcdoc: iframe?.srcdoc } : {}),
      ...(type === 'WidgetSubGrid'
        ? { gridRows: widget.grid_rows, gridColumns: widget.grid_columns, widgetsToLoad: widget.widgets_to_load }
        : {})
    }
  }
}
