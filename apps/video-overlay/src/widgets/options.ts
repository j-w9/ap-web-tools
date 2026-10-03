/**
 * How each VideoOverlay widget constructor read its `options` (upstream VideoOverlay/Widgets/*.js
 * and the TelemetryDashboard classes they extend), as pure functions: what is used, what is saved
 * back, and which stored values made the original throw. `options.test.ts` runs the upstream
 * constructors side by side.
 *
 * Candidate to share with telemetry-dashboard (its `widgets/options.ts` is the same apart from the
 * VideoOverlay defaults).
 */
import { DEFAULT_CUSTOM_HTML } from './documents.js'
import {
  anyString,
  hasKey,
  isJsonObject,
  nullPropertyError,
  primitiveAssignmentError,
  prop,
  type JsonLike,
  type JsonObject,
  type OptionsObject
} from './json.js'

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

export function readBaseOptions(options: OptionsObject, className: string): BaseOptions {
  const about = 'about' in options ? options['about'] : { name: className }
  if (about === null || about === undefined) throw nullPropertyError(about, 'name')
  let formDefinition: JsonLike = {}
  let formContent: JsonLike = {}
  if ('form' in options) {
    formDefinition = options['form']
    if ('form_content' in options) formContent = options['form_content']
  }
  return { about, name: prop(about, 'name'), formDefinition, formContent }
}

function withDefault(options: OptionsObject, key: string, value: JsonLike): OptionsObject {
  const current = options[key]
  return current === null || current === undefined ? { ...options, [key]: value } : options
}

export const SANDBOX_ABOUT: JsonObject = {
  name: 'Sandbox',
  info: 'Sandboxed widget allowing user defined functionality with JavaScript. User input using Formio form.'
}

export const CUSTOM_HTML_ABOUT: JsonObject = {
  name: 'Custom HTML',
  info: 'Custom HTML allowing user defined HTML. User input using Formio form.'
}

export const SUBGRID_ABOUT: JsonObject = { name: 'Subgrid', info: 'Nestable sub grid widget' }

/** Default script of a new Sandbox widget (upstream `WidgetSandBoxVideoOverlay`). */
export const DEFAULT_SANDBOX_SCRIPT = `// Initialization
div.appendChild(document.createTextNode("Widget Example:"))
div.appendChild(document.createElement("br"))

message_report = document.createTextNode("No Log")
div.appendChild(message_report)

div.appendChild(document.createElement("br"))

logTime = document.createTextNode("")
div.appendChild(logTime)

// Load function
loadLog = function (log) {
    message_report.nodeValue = "Got log starting at: " + log.extractStartTime()
}

// Runtime function
setTime = function(time) {
    logTime.nodeValue = "Log Time: " + time.toFixed(2)
}
`

/**
 * `WidgetSandBoxVideoOverlay` (default script when `options.sandbox == null`) then `WidgetSandBox`
 * (default about); the script is kept as stored.
 */
export function sandboxOptions(raw: unknown): { readonly options: OptionsObject; readonly script: JsonLike } {
  const options = withDefault(
    withDefault(optionsObject(raw, 'sandbox'), 'sandbox', DEFAULT_SANDBOX_SCRIPT),
    'about',
    SANDBOX_ABOUT
  )
  return { options, script: options['sandbox'] }
}

/** `WidgetCustomHTMLVideoOverlay` (default document) then `WidgetCustomHTML` (default about). */
export function customHtmlOptions(raw: unknown): { readonly options: OptionsObject; readonly srcdoc: string } {
  const options = withDefault(
    withDefault(optionsObject(raw, 'custom_HTML'), 'custom_HTML', DEFAULT_CUSTOM_HTML),
    'about',
    CUSTOM_HTML_ABOUT
  )
  return { options, srcdoc: anyString(options['custom_HTML']) }
}

/** A sub grid's stored size and widgets, when its options give a size. */
export interface SubGridContent {
  readonly rows: JsonLike
  readonly columns: JsonLike
  /** `options.widgets` as stored, loaded on `init()` unless null or undefined; null when absent. */
  readonly widgets: JsonLike
}

/** `WidgetSubGrid`: fixed form and about; a grid is built if `form_content` has rows and columns. */
export function subgridOptions(raw: unknown): { readonly options: OptionsObject; readonly content: SubGridContent | null } {
  const stored = optionsObject(raw, 'form')
  // A fresh form definition per widget (Formio may modify the one it is given).
  const options: OptionsObject = { ...stored, form: structuredClone(SUBGRID_FORM), about: SUBGRID_ABOUT }
  if (!('form_content' in stored)) return { options, content: null }
  const formContent = stored['form_content']
  if (!hasKey(formContent, 'rows') || !hasKey(formContent, 'columns')) return { options, content: null }
  return {
    options,
    content: {
      rows: prop(formContent, 'rows'),
      columns: prop(formContent, 'columns'),
      widgets: 'widgets' in stored ? stored['widgets'] : null
    }
  }
}

/** The fixed options form of every sub grid (upstream `options.form`). */
export const SUBGRID_FORM: JsonObject = {
  components: [
    {
      label: 'Rows',
      tooltip: 'Number of rows in this subgrid.',
      applyMaskOn: 'change',
      mask: false,
      tableView: false,
      delimiter: false,
      requireDecimal: false,
      inputFormat: 'plain',
      truncateMultipleSpaces: false,
      validate: { min: 1, max: 12 },
      validateWhenHidden: false,
      key: 'rows',
      type: 'number',
      input: true,
      defaultValue: 2,
      decimalLimit: 0
    },
    {
      label: 'Columns',
      tooltip: 'Number of columns in this subgrid.',
      applyMaskOn: 'change',
      mask: false,
      tableView: false,
      delimiter: false,
      requireDecimal: false,
      inputFormat: 'plain',
      truncateMultipleSpaces: false,
      validate: { min: 1, max: 12 },
      validateWhenHidden: false,
      key: 'columns',
      type: 'number',
      input: true,
      defaultValue: 2,
      decimalLimit: 0
    },
    colorComponent('Border color', 'borderColor', '#c8c8c8', 'ebao4j', ''),
    colorComponent('Background color', 'backgroundColor', '#ffffff', 'e6byhel', ''),
    {
      label: 'Background image',
      tooltip:
        'The sub grid will take on the aspect ratio of the image so sub grid widgets hold position relative to the image as the dashboard is re-sized.',
      storage: 'base64',
      key: 'backgroundImage',
      type: 'file',
      input: true
    }
  ]
}

/** Upstream's colour component definitions, which differ only in label, key, default and id. */
function colorComponent(label: string, key: string, defaultValue: string, id: string, tooltip: string): JsonObject {
  return {
    label,
    key,
    type: 'color',
    input: true,
    tableView: false,
    widget: { type: 'input' },
    inputType: 'color',
    mask: false,
    data: '#000000',
    defaultValue,
    id,
    placeholder: '',
    prefix: '',
    customClass: '',
    suffix: '',
    multiple: false,
    protected: false,
    unique: false,
    persistent: true,
    hidden: false,
    clearOnHide: true,
    refreshOn: '',
    redrawOn: '',
    modalEdit: false,
    dataGridLabel: false,
    labelPosition: 'top',
    description: '',
    errorLabel: '',
    tooltip,
    hideLabel: false,
    tabindex: '',
    disabled: false,
    autofocus: false,
    dbIndex: false,
    customDefaultValue: '',
    calculateValue: '',
    calculateServer: false,
    attributes: {},
    validateOn: 'change',
    validate: { required: false, custom: '', customPrivate: false, strictDateValidation: false, multiple: false, unique: false },
    conditional: { show: null, when: null, eq: '' },
    overlay: { style: '', left: '', top: '', width: '', height: '' },
    allowCalculateOverride: false,
    encrypted: false,
    showCharCount: false,
    showWordCount: false,
    properties: {},
    allowMultipleMasks: false,
    addons: []
  }
}
