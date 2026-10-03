/**
 * Formio configuration for widget forms and the form builder, ported from upstream
 * `VideoOverlay/WidgetEdit.js` (`init_editor`): a colour-picker component and trimmed-down edit
 * forms for the builder's components.
 *
 * Candidate to share with telemetry-dashboard (its WidgetEdit.js does the same).
 */
import Formio, { type EditFormNode, type FormioStatic } from 'formiojs/dist/formio.full.min.js'
import type { JsonObject } from './json.js'

export { Formio }
export type { FormioStatic }

let configured = false

/** Register the colour component (upstream `class Color extends input_component`). */
function registerColorComponent(): void {
  const InputComponent = Formio.Components.components.input
  const inputEditForm = InputComponent.editForm()

  class Color extends InputComponent {
    static override schema(...extend: JsonObject[]): JsonObject {
      return InputComponent.schema(
        { type: 'color', label: 'color', key: 'color', inputType: 'color', mask: false, data: '#000000' },
        ...extend
      )
    }

    static get builderInfo(): JsonObject {
      return {
        title: 'Color picker',
        icon: 'palette',
        group: 'basic',
        documentation: '/userguide/#textfield',
        weight: 0,
        schema: Color.schema()
      }
    }

    static override editForm = (): EditFormNode => inputEditForm

    // Fix annoying warning about value="" being invalid for color inputs
    override setValue(value: unknown): unknown {
      return super.setValue(value === '' ? '#000000' : value)
    }

    override renderElement(value: unknown, index: number): string {
      return super.renderElement(value, index).replace('value=""', 'value="#000000"')
    }
  }

  // `use` here is Formio's plugin registration, not a React hook.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  Formio.use({ components: { color: Color } })
}

/** Keep only the listed tabs and fields of a component's edit form (upstream `strip_component`). */
function stripComponent(name: string, whiteList: Readonly<Record<string, readonly string[]>>, blackList?: string): void {
  const component = Formio.Components.components[name]
  if (component === undefined) return
  const item = component.editForm()
  const tabsNode = item.components?.[0]
  if (tabsNode === undefined) return

  const tabs = Object.keys(whiteList)
  tabsNode.components = (tabsNode.components ?? []).filter((comp) => comp.key !== undefined && tabs.includes(comp.key))
  for (const comp of tabsNode.components) {
    const keep = comp.key === undefined ? undefined : whiteList[comp.key]
    if (keep === undefined) continue
    comp.components = (comp.components ?? []).filter((c) => c.key !== undefined && keep.includes(c.key))
  }

  // Upstream passes a single string as the black list; `includes` then matches substrings of it.
  const recursiveStrip = (node: EditFormNode, keysToRemove: string): void => {
    if (node.components === undefined) return
    node.components = node.components.filter((comp) => !(comp.key !== undefined && keysToRemove.includes(comp.key)))
    for (const comp of node.components) recursiveStrip(comp, keysToRemove)
  }
  if (blackList !== undefined) recursiveStrip(item, blackList)

  component.editForm = () => item
}

/** Configure Formio once, before any widget form is created. */
export function configureFormio(): void {
  if (configured) return
  configured = true
  registerColorComponent()

  const basic = { display: ['label', 'description', 'tooltip'], data: ['defaultValue'], api: ['key'] }
  stripComponent('textfield', basic)
  stripComponent('number', basic)
  stripComponent('checkbox', basic)
  stripComponent(
    'selectboxes',
    { display: ['label', 'description', 'tooltip'], data: ['defaultValue', 'values'], api: ['key'] },
    'shortcut'
  )
  stripComponent('select', { display: ['label', 'description', 'tooltip'], data: ['defaultValue', 'data.values'], api: ['key'] })
  stripComponent('file', { display: ['label', 'description', 'tooltip'], data: ['multiple'], api: ['key'] })
  stripComponent(
    'radio',
    { display: ['label', 'description', 'tooltip'], data: ['defaultValue', 'values'], api: ['key'] },
    'shortcut'
  )
  stripComponent('color', basic)

  stripComponent('htmlelement', { display: ['label', 'tag', 'content'], api: ['key'] })
  stripComponent('columns', { display: ['label', 'columns', 'tooltip'], api: ['key'] })
  stripComponent('fieldset', { display: ['legend', 'tooltip'], api: ['key'] })
  stripComponent('panel', { display: ['title', 'tooltip'], api: ['key'] })
  stripComponent('table', { display: ['label', 'numRows', 'numCols'], api: ['key'] })
  stripComponent('tabs', { display: ['label', 'components'], api: ['key'] })
}

/** Builder options (upstream `options` in `init_editor`). */
export const BUILDER_OPTIONS: JsonObject = {
  noDefaultSubmitButton: true,
  builder: {
    advanced: false,
    premium: false,
    data: false,
    basic: {
      title: 'Inputs',
      default: true,
      components: {
        password: false,
        button: false,
        textarea: false,
        file: {
          title: 'file',
          key: 'file',
          icon: 'file',
          schema: { label: 'Upload', type: 'file', key: 'file', input: true, storage: 'base64' }
        }
      }
    },
    layout: { default: true, components: { content: false, well: false } }
  }
}
