/**
 * Formio configuration shared by widget option forms and the form builder (upstream
 * `init_editor` in WidgetEdit.js): the three custom components (`mavlinkmsg`, `mavlinkfield`,
 * `color`), the trimmed builder palette and the trimmed component settings.
 *
 * The custom data scripts are kept character for character: they are evaluated by Formio, and
 * the same scripts are stored inside every saved form that uses these components.
 */
import Formio from 'formiojs/dist/formio.full.min.js'
import type { ComponentClass, ComponentSchema, EditForm } from 'formiojs/dist/formio.full.min.js'
import type { JsonObject } from '../layout/json.js'
import type { LegacyMavlink20 } from '../mavlink/legacy-namespace.js'

export { Formio }

function component(name: string): ComponentClass {
  const found = Formio.Components.components[name]
  if (found === undefined) throw new Error(`Formio component ${name} is missing`)
  return found
}

/** Options for the "MAVLink message" select: every message, `NAME (id)`, sorted by label. */
export function mavlinkMessageOptions(mavlink20: LegacyMavlink20): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = []
  for (const entry of Object.values(mavlink20.map)) {
    const msg = new entry.type()
    const id = String(msg._id)
    options.push({ value: id, label: msg._name + ' (' + id + ')' })
  }
  options.sort((a, b) => a.label.localeCompare(b.label))
  return options
}

const MESSAGE_KEY_SCRIPT = `// Search the form and add the key of any mavlinkmsg items
values = []

function recursive_search(obj) {
    if (obj.type == "mavlinkmsg") {
        values.push(obj.key)
    }

    if (!("components" in obj)) {
        return
    }
    for (let comp of obj.components) {
        recursive_search(comp)
    }
}

recursive_search(instance.options.editForm)

if (values.length == 0) {
    values = ["No MAVLink message items found"]
}
`

const FIELD_VALUES_SCRIPT = `
// Get the target key
if (component.MAVLinkMsgSelect == undefined) {
    return [ "Invalid MAVLink message item key" ]
}
const key = component.MAVLinkMsgSelect

// Get the value of form item with that key
const id = submission.data[component.MAVLinkMsgSelect]

// Function to get fields for given message id
function get_fields(id) {
    for (const msg_map of Object.values(mavlink20.map)) {
        const msg = new msg_map.type
        if (String(msg._id) == id) {
            return msg.fieldnames
        }
    }
    return [ "Unknown message" ]
}

// Get the fields for the give message id
values = get_fields(id)
`

/** Settings tabs and the components each keeps (upstream `strip_component` white lists). */
type WhiteList = Readonly<Record<string, readonly string[]>>

/** Keeps only white-listed tabs and settings, removes black-listed keys anywhere, and freezes the result. */
function stripComponent(target: ComponentClass, whiteList: WhiteList, blackList?: string): void {
  const item: EditForm = target.editForm()
  const tabsHolder = item.components[0]
  if (tabsHolder === undefined) return
  const tabs = Object.keys(whiteList)
  tabsHolder.components = (tabsHolder.components ?? []).filter((comp) => tabs.includes(comp.key ?? ''))
  for (const comp of tabsHolder.components) {
    const keep = whiteList[comp.key ?? '']
    if (keep === undefined) continue
    comp.components = (comp.components ?? []).filter((c) => keep.includes(c.key ?? ''))
  }
  if (blackList !== undefined) {
    // Upstream passed a string, so `includes` is a substring test on the key.
    const recursiveStrip = (obj: { components?: ComponentSchema[] }): void => {
      if (obj.components === undefined) return
      obj.components = obj.components.filter((comp) => !blackList.includes(comp.key ?? '\u0000'))
      for (const comp of obj.components) recursiveStrip(comp)
    }
    recursiveStrip(item)
  }
  target.editForm = () => item
}

let registered = false

/** Registers the custom components and trims the builder (once per page, as upstream did at load). */
export function setupFormio(mavlink20: LegacyMavlink20): void {
  if (registered) return
  registered = true

  const messageOptions = mavlinkMessageOptions(mavlink20)

  const msgSelectComponent = component('select')
  const msgSelectEditForm = msgSelectComponent.editForm()

  class Mavlinkmsg extends msgSelectComponent {
    static override schema(...extend: JsonObject[]): JsonObject {
      return msgSelectComponent.schema(
        { type: 'mavlinkmsg', label: 'mavlinkmsg', key: 'mavlinkmsg', data: { values: messageOptions } },
        ...extend
      )
    }
    static override get builderInfo(): JsonObject {
      return {
        title: 'MAVLink message',
        icon: 'envelope',
        group: 'basic',
        documentation: '/userguide/#textfield',
        weight: 0,
        schema: Mavlinkmsg.schema()
      }
    }
    static override editForm = (): EditForm => msgSelectEditForm
  }

  const fieldSelectComponent = component('select')
  const fieldSelectEditForm = fieldSelectComponent.editForm()
  fieldSelectEditForm.components[0]?.components?.[1]?.components?.unshift({
    label: 'MAVLink message input key',
    widget: 'choicesjs',
    description: 'Key for a MAVLink message item, field options are populated from this item',
    tableView: true,
    dataSrc: 'custom',
    data: { custom: MESSAGE_KEY_SCRIPT },
    validateWhenHidden: false,
    key: 'MAVLinkMsgSelect',
    type: 'select',
    input: true
  })

  class Mavlinkfield extends fieldSelectComponent {
    static override schema(...extend: JsonObject[]): JsonObject {
      return fieldSelectComponent.schema(
        {
          type: 'mavlinkfield',
          label: 'mavlinkfield',
          key: 'mavlinkfield',
          dataSrc: 'custom',
          data: { custom: FIELD_VALUES_SCRIPT }
        },
        ...extend
      )
    }
    static override get builderInfo(): JsonObject {
      return {
        title: 'MAVLink field',
        icon: 'envelope',
        group: 'basic',
        documentation: '/userguide/#textfield',
        weight: 0,
        schema: Mavlinkfield.schema()
      }
    }
    static override editForm = (): EditForm => fieldSelectEditForm
  }

  const inputComponent = component('input')
  const inputEditForm = inputComponent.editForm()

  class Color extends inputComponent {
    static override schema(...extend: JsonObject[]): JsonObject {
      return inputComponent.schema(
        { type: 'color', label: 'color', key: 'color', inputType: 'color', mask: false, data: '#000000' },
        ...extend
      )
    }
    static override get builderInfo(): JsonObject {
      return {
        title: 'Color picker',
        icon: 'palette',
        group: 'basic',
        documentation: '/userguide/#textfield',
        weight: 0,
        schema: Color.schema()
      }
    }
    static override editForm = (): EditForm => inputEditForm

    // Avoids the browser warning about value="" being invalid for colour inputs.
    override setValue(value: unknown, flags?: unknown): unknown {
      return super.setValue(value === '' ? '#000000' : value, flags)
    }

    override renderElement(value: unknown, index: unknown): string {
      return super.renderElement(value, index).replace('value=""', 'value="#000000"')
    }
  }

  // eslint-disable-next-line react-hooks/rules-of-hooks -- Formio's plugin registration, not a React hook
  Formio.use({ components: { mavlinkmsg: Mavlinkmsg, mavlinkfield: Mavlinkfield, color: Color } })

  const basic: WhiteList = { display: ['label', 'description', 'tooltip'], data: ['defaultValue'], api: ['key'] }
  stripComponent(component('textfield'), basic)
  stripComponent(component('number'), basic)
  stripComponent(component('checkbox'), basic)
  stripComponent(component('selectboxes'), { ...basic, data: ['defaultValue', 'values'] }, 'shortcut')
  stripComponent(component('select'), { ...basic, data: ['defaultValue', 'data.values'] })
  stripComponent(component('file'), { ...basic, data: ['multiple'] })
  stripComponent(component('radio'), { ...basic, data: ['defaultValue', 'values'] }, 'shortcut')
  stripComponent(component('mavlinkmsg'), basic)
  stripComponent(component('mavlinkfield'), { ...basic, data: ['defaultValue', 'MAVLinkMsgSelect'] })
  stripComponent(component('color'), basic)

  stripComponent(component('htmlelement'), { display: ['label', 'tag', 'content'], api: ['key'] })
  stripComponent(component('columns'), { display: ['label', 'columns', 'tooltip'], api: ['key'] })
  stripComponent(component('fieldset'), { display: ['legend', 'tooltip'], api: ['key'] })
  stripComponent(component('panel'), { display: ['title', 'tooltip'], api: ['key'] })
  stripComponent(component('table'), { display: ['label', 'numRows', 'numCols'], api: ['key'] })
  stripComponent(component('tabs'), { display: ['label', 'components'], api: ['key'] })
}

/** Form builder options (upstream `options` in `init_editor`). */
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
