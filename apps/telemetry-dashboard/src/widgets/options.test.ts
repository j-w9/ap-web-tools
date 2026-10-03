// Oracle: the port's reading of stored widget options against upstream's widget constructors run
// in node:vm (see test-support/upstream-widgets.ts), for well-formed and malformed options.
import { describe, expect, it } from 'vitest'
import { constructUpstreamWidget, type UpstreamWidgetOutcome, type UpstreamWidgetType } from '../test-support/upstream-widgets.js'
import { jsString } from '../layout/json.js'
import { customHtmlOptions, menuOptions, readBaseOptions, sandboxOptions, subgridOptions, type OptionsObject } from './options.js'

function plain(value: unknown): unknown {
  return value === undefined ? undefined : structuredClone(value)
}

/** What the port does with the same options, in the shape the upstream harness reports. */
function portOutcome(type: UpstreamWidgetType, raw: unknown): UpstreamWidgetOutcome {
  try {
    const base = (options: OptionsObject) => {
      const b = readBaseOptions(options, type)
      return { about: b.about, nameHtml: b.name, formDefinition: b.formDefinition, formContent: b.formContent }
    }
    switch (type) {
      case 'WidgetSandBox': {
        const { options, script } = sandboxOptions(raw)
        return { record: { ...base(options), scriptText: script } }
      }
      case 'WidgetCustomHTML': {
        const { options, srcdoc } = customHtmlOptions(raw)
        return { record: { ...base(options), srcdoc } }
      }
      case 'WidgetSubGrid': {
        const { options, content } = subgridOptions(raw)
        return {
          record: {
            ...base(options),
            gridRows: content?.rows,
            gridColumns: content?.columns,
            // Upstream starts `widgets_to_load` at null and sets it only with a size.
            widgetsToLoad: content === null ? null : content.widgets
          }
        }
      }
      case 'WidgetMenu':
        return { record: base(menuOptions(raw)) }
    }
  } catch (error) {
    return { threw: error instanceof Error ? error.message : String(error) }
  }
}

function normalise(outcome: UpstreamWidgetOutcome): unknown {
  if ('threw' in outcome) return outcome
  const r = outcome.record
  return {
    ...Object.fromEntries(Object.entries(r).map(([k, v]) => [k, plain(v)])),
    // The DOM converts what is assigned to `srcdoc` to a string.
    ...('srcdoc' in r ? { srcdoc: jsString(r.srcdoc) } : {})
  }
}

const OPTIONS: readonly unknown[] = [
  undefined,
  null,
  'abc',
  5,
  true,
  [],
  ['x'],
  {},
  { about: null },
  { about: 'text' },
  { about: 7 },
  { about: { name: '<b>Speed</b>', info: 3 } },
  { about: { name: null } },
  { about: {} },
  { form: 'https://example.com/form' },
  { form: null, form_content: 3 },
  { form: { components: [{ key: 'a', type: 'textfield' }] }, form_content: { a: 1 } },
  { form_content: { a: 1 } },
  { form: [], form_content: [] },
  { sandbox: 5 },
  { sandbox: null },
  { sandbox: 'handle_msg = 1' },
  { custom_HTML: null },
  { custom_HTML: ['a', null, 2] },
  { custom_HTML: '<p>hi</p>' },
  { form_content: 5 },
  { form_content: 'rows' },
  { form_content: null },
  { form_content: [] },
  { form_content: { rows: '3', columns: 2 }, widgets: null },
  { form_content: { rows: 2, columns: 2 }, widgets: { 0: { type: 'WidgetSandBox' } } },
  { form_content: { rows: 2, columns: 2 } },
  { form_content: { rows: 2 } },
  { widgets: {} }
]

const TYPES: readonly UpstreamWidgetType[] = ['WidgetSandBox', 'WidgetCustomHTML', 'WidgetSubGrid', 'WidgetMenu']

describe('widget options against upstream constructors', () => {
  for (const type of TYPES) {
    it(`${type} reads, keeps and rejects options as upstream`, async () => {
      for (const raw of OPTIONS) {
        const theirs = await constructUpstreamWidget(type, structuredClone(raw))
        const ours = portOutcome(type, structuredClone(raw))
        expect(normalise(ours), `${type} ${JSON.stringify(raw)}`).toEqual(normalise(theirs))
      }
    })
  }
})
