/**
 * How each widget constructor read its `options` (upstream Widgets/*.js), as pure functions: what
 * is used, what is saved back, and which stored values made the original throw (and with which
 * message). `options.test.ts` runs the upstream constructors side by side.
 *
 * Stored options are kept as stored: an `about` that is a string, a form definition that is not an
 * object, a script that is a number are passed on (and saved back) unchanged, as upstream did.
 */
import {
  hasKey,
  isJsonObject,
  jsString,
  nullPropertyError,
  primitiveAssignmentError,
  prop,
  type JsonLike,
  type JsonObject
} from '../layout/json.js'
import type { WidgetType } from '../layout/layout.js'
import { MENU_FORM, SUBGRID_FORM } from './forms.js'

/** Widget options: stored JSON, or (copying a widget) `get_options()`, whose members may be undefined. */
export interface OptionsObject {
  readonly [key: string]: JsonLike
}

/**
 * Upstream constructors began `if (options == null) options = {}` and then assigned a property of
 * `options` (strict mode), which throws for a string, number or boolean. Arrays behave as objects
 * without the keys the widgets look for.
 */
export function optionsObject(raw: unknown, firstAssignment: string): OptionsObject {
  if (raw === null || raw === undefined) return {}
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
    throw primitiveAssignmentError(firstAssignment, raw)
  }
  return isJsonObject(raw) ? raw : {}
}

/** What `WidgetBase`'s constructor took from the options. */
export interface BaseOptions {
  /** `options.about` as stored (saved back unchanged), else `{ name: <class name> }`. */
  readonly about: JsonLike
  /** `about.name`, shown with `innerHTML` in the widget popup. */
  readonly name: JsonLike
  /** `options.form`, passed to Formio as stored ({} when absent). */
  readonly formDefinition: JsonLike
  /** `options.form_content`, only read when `form` is present ({} otherwise). */
  readonly formContent: JsonLike
}

export function readBaseOptions(options: OptionsObject, type: WidgetType): BaseOptions {
  const about = 'about' in options ? options.about : { name: type }
  // `this.about.name` threw for a null about (only the menu keeps one; the others replace it).
  if (about === null || about === undefined) throw nullPropertyError(about, 'name')
  let formDefinition: JsonLike = {}
  let formContent: JsonLike = {}
  if ('form' in options) {
    formDefinition = options.form
    if ('form_content' in options) formContent = options.form_content
  }
  return { about, name: prop(about, 'name'), formDefinition, formContent }
}

/** `about` given to widgets that have none (`options?.about == null`). */
function withDefaultAbout(options: OptionsObject, about: JsonObject): OptionsObject {
  return options.about === null || options.about === undefined ? { ...options, about } : options
}

export const SANDBOX_ABOUT = {
  name: 'Sandbox',
  info: 'Sandboxed widget allowing user defined functionality with JavaScript. User input using Formio form.'
} as const

export const DEFAULT_SANDBOX_SCRIPT = `// Initialization
div.appendChild(document.createTextNode("Widget Example:"))
div.appendChild(document.createElement("br"))

message_report = document.createTextNode("No Data")
div.appendChild(message_report)

// Runtime function
handle_msg = function (msg) {
    message_report.nodeValue = "Got: " + msg._name
}
`

/** Upstream `WidgetSandBox`: the script is kept as stored (it is concatenated into a function body). */
export function sandboxOptions(raw: unknown): { readonly options: OptionsObject; readonly script: JsonLike } {
  const options = withDefaultAbout(optionsObject(raw, 'about'), SANDBOX_ABOUT)
  return { options, script: 'sandbox' in options ? options.sandbox : DEFAULT_SANDBOX_SCRIPT }
}

export const CUSTOM_HTML_ABOUT = {
  name: 'Custom HTML',
  info: 'Custom HTML allowing user defined HTML. User input using Formio form.'
} as const

export const DEFAULT_CUSTOM_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8"/>
    <title>Custom HTML Example</title>
</head>
<body>
    <div style="position:absolute; top:0; bottom:0; left:0; right:0; margin:10px; border:5px solid; border-radius:10px; border-color:#c8c8c8; background-color:#ffffff; padding;5px;">
        HTML Example
    </div>
</body>
<script type="module">

    let options

    function handle_MAVLink(msg) {
        // Message handling here
    }

    window.addEventListener('message', function (e) {
        const data = e.data

        // User has changed options
        if ("options" in data) {
            // Call init once we have some options
            options = data.options
        }

    })

    // Incoming MAVLink messages
    const broadcast = new BroadcastChannel("MAVLinkMSG")
    broadcast.onmessage = (e) => {
        if (e?.data?.MAVLink) {
            handle_MAVLink(e.data.MAVLink)
        }
    }
</script>
</html>
`

/** Upstream `WidgetCustomHTML`: `srcdoc` is the stored value converted to a string. */
export function customHtmlOptions(raw: unknown): { readonly options: OptionsObject; readonly srcdoc: string } {
  const options = withDefaultAbout(optionsObject(raw, 'about'), CUSTOM_HTML_ABOUT)
  return { options, srcdoc: 'custom_HTML' in options ? jsString(options.custom_HTML) : DEFAULT_CUSTOM_HTML }
}

export const SUBGRID_ABOUT = { name: 'Subgrid', info: 'Nestable sub grid widget' } as const

/** A sub grid's stored size and widgets, when its options give a size. */
export interface SubGridContent {
  readonly rows: JsonLike
  readonly columns: JsonLike
  /** `options.widgets` as stored, loaded on `init()` unless null or undefined; null when absent. */
  readonly widgets: JsonLike
}

/** Upstream `WidgetSubGrid`: fixed form and about; a grid is built if `form_content` has rows and columns. */
export function subgridOptions(raw: unknown): { readonly options: OptionsObject; readonly content: SubGridContent | null } {
  const stored = optionsObject(raw, 'form')
  // A fresh form definition per widget (Formio may modify the one it is given).
  const options: OptionsObject = { ...stored, form: structuredClone(SUBGRID_FORM), about: SUBGRID_ABOUT }
  if (!('form_content' in stored)) return { options, content: null }
  const formContent = stored.form_content
  if (!hasKey(formContent, 'rows') || !hasKey(formContent, 'columns')) return { options, content: null }
  return {
    options,
    content: {
      rows: prop(formContent, 'rows'),
      columns: prop(formContent, 'columns'),
      widgets: 'widgets' in stored ? stored.widgets : null
    }
  }
}

/** Upstream `WidgetMenu`: fixed form; `about` as stored. */
export function menuOptions(raw: unknown): OptionsObject {
  return { ...optionsObject(raw, 'form'), form: structuredClone(MENU_FORM) }
}
