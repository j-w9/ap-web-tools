/**
 * The dashboard layout file format (upstream `get_layout`, `load_layout`, `add_widget`,
 * `load_file`), typed, with runtime validation of loaded JSON.
 *
 *   { "header": { "version": 1 },
 *     "grid": { "columns": 12, "rows": 12, "color": "rgb(255, 255, 255)" },
 *     "widgets": { "0": { "x": "11", "y": "0", "w": "1", "h": "3", "type": "WidgetMenu", "options": {...} }, ... } }
 *
 * A single widget file is `{ "header": {...}, "widget": { ...one widget... } }`.
 *
 * Validation accepts exactly what the original loaded: positions and grid sizes may be numbers or
 * numeric strings (parsed with `parseInt`, so `"3px"` is 3 and `"x"` is NaN), positions may be
 * missing or null (auto-placed), `widgets` may be an object or an array, and options are kept
 * verbatim. It rejects what made the original throw, with a message saying what is wrong.
 */
import { isJsonObject, type Json, type JsonObject } from './json.js'

export const WIDGET_TYPES = ['WidgetMenu', 'WidgetSandBox', 'WidgetSubGrid', 'WidgetCustomHTML'] as const
export type WidgetType = (typeof WIDGET_TYPES)[number]

export function isWidgetType(value: unknown): value is WidgetType {
  return WIDGET_TYPES.some((t) => t === value)
}

/** Grid position and size in cells; null means "let the grid choose". */
export interface WidgetPlacement {
  readonly x: number | null
  readonly y: number | null
  readonly w: number | null
  readonly h: number | null
}

/** One widget to place: its type, placement and options exactly as stored. */
export interface WidgetSpec extends WidgetPlacement {
  readonly type: WidgetType
  /** The stored `options` object (absent or null in the file reads as empty). */
  readonly options: JsonObject
}

export interface GridSettings {
  readonly columns: number
  readonly rows: number
  /** CSS colour; anything else leaves the current background, as an invalid style value did upstream. */
  readonly color: string | null
}

export interface Layout {
  readonly grid: GridSettings
  readonly widgets: readonly WidgetSpec[]
}

/** A layout or widget file failed validation; `message` says what is wrong. */
export class LayoutError extends Error {
  override readonly name = 'LayoutError'
}

/** `parseInt` as upstream applied it to stored values (`"12"`, `12` and `12.5` all give 12). */
function toInt(value: unknown): number {
  return Number.parseInt(String(value), 10)
}

function placement(value: unknown): number | null {
  return value === null || value === undefined ? null : toInt(value)
}

/** Options as an object; upstream read them with `in`, which throws on primitives. */
function readOptions(value: unknown, type: WidgetType): JsonObject {
  if (value === null || value === undefined) return {}
  if (Array.isArray(value)) return {}
  if (!isJsonObject(value)) throw new LayoutError(`${type} options must be an object, got ${JSON.stringify(value)}`)
  for (const key of ['about', 'form', 'form_content'] as const) {
    const field = value[key]
    if (field !== undefined && !isJsonObject(field)) {
      throw new LayoutError(`${type} options.${key} must be an object, got ${JSON.stringify(field)}`)
    }
  }
  return value
}

/** Validates one stored widget (upstream `add_widget` then `new_widget`). */
export function parseWidget(value: unknown): WidgetSpec {
  if (value === null || value === undefined) throw new LayoutError(`Widget entry is ${String(value)}`)
  const record: Readonly<Record<string, unknown>> = isJsonObject(value) ? value : {}
  const type = record.type
  if (!isWidgetType(type)) throw new LayoutError(`Unknown widget type: ${String(type)}`)
  return {
    type,
    x: placement(record.x),
    y: placement(record.y),
    w: placement(record.w),
    h: placement(record.h),
    options: readOptions(record.options, type)
  }
}

/** Widgets stored as an object keyed "0", "1", ... (what the dashboard saves) or as an array. */
export function parseWidgets(value: unknown): WidgetSpec[] {
  if (value === null || value === undefined) throw new LayoutError('Layout has no widgets')
  // `Object.values` as upstream used it: a string iterates its characters, other primitives are empty.
  const entries: readonly unknown[] =
    typeof value === 'object'
      ? Object.values(value)
      : typeof value === 'string'
        ? Array.from({ length: value.length }, (_, i) => value.charAt(i))
        : []
  return entries.map(parseWidget)
}

/** Validates the `grid` and `widgets` of a layout (upstream `load_layout`). */
export function parseLayout(grid: unknown, widgets: unknown): Layout {
  if (!isJsonObject(grid)) throw new LayoutError('Layout has no grid settings')
  return {
    grid: {
      columns: toInt(grid.columns),
      rows: toInt(grid.rows),
      color: typeof grid.color === 'string' ? grid.color : null
    },
    widgets: parseWidgets(widgets)
  }
}

/** What a loaded file contains (upstream `load_file`). */
export type DashboardFile =
  | { readonly kind: 'layout'; readonly grid: Json | undefined; readonly widgets: Json | undefined }
  | { readonly kind: 'widget'; readonly widget: Json | undefined }
  | { readonly kind: 'unrecognised' }

/**
 * Classifies a file's JSON. A layout has `widgets`, a single widget has `widget`; the contents are
 * validated when loaded, because the original only failed then. Throws on invalid JSON.
 */
export function classifyDashboardFile(text: string): DashboardFile {
  const parsed: unknown = JSON.parse(text)
  if (typeof parsed !== 'object' || parsed === null) {
    // `"widgets" in 5` threw in the original.
    throw new LayoutError('The file does not contain a dashboard layout or widget')
  }
  const object: Readonly<Record<string, Json | undefined>> = isJsonObject(parsed) ? parsed : {}
  if ('widgets' in parsed) return { kind: 'layout', grid: object.grid, widgets: object.widgets }
  if ('widget' in parsed) return { kind: 'widget', widget: object.widget }
  return { kind: 'unrecognised' }
}

/** A widget as saved: positions as the grid's `gs-*` attribute strings (null when absent). */
export interface StoredWidget {
  readonly x: string | null
  readonly y: string | null
  readonly w: string | null
  readonly h: string | null
  readonly type: WidgetType
  readonly options: JsonObject
}

export interface StoredLayout {
  readonly header: { readonly version: number }
  readonly grid: { readonly columns: number | undefined; readonly rows: number | undefined; readonly color: string }
  readonly widgets: Readonly<Record<string, StoredWidget>>
}

export interface StoredWidgetFile {
  readonly header: { readonly version: number }
  readonly widget: StoredWidget
}

export const LAYOUT_VERSION = 1.0

/** Widgets keyed by index, as upstream `get_widgets` stored them. */
export function storedWidgets(widgets: readonly StoredWidget[]): Record<string, StoredWidget> {
  const out: Record<string, StoredWidget> = {}
  widgets.forEach((widget, i) => {
    out[i] = widget
  })
  return out
}

export function storedLayout(grid: StoredLayout['grid'], widgets: readonly StoredWidget[]): StoredLayout {
  return { header: { version: LAYOUT_VERSION }, grid, widgets: storedWidgets(widgets) }
}

export function storedWidgetFile(widget: StoredWidget): StoredWidgetFile {
  return { header: { version: LAYOUT_VERSION }, widget }
}

/** File names upstream saved to. */
export const LAYOUT_FILE_NAME = 'TelemetryDashboard.json'
export const WIDGET_FILE_NAME = 'TelemetryDashboard_Widget.json'

/** Text written to a saved file (upstream `JSON.stringify(obj, null, 2)`). */
export function fileText(value: StoredLayout | StoredWidgetFile): string {
  return JSON.stringify(value, null, 2)
}

/** Converts a saved widget back to a spec (copying, or moving between grids). */
export function specFromStored(widget: StoredWidget): WidgetSpec {
  return parseWidget(widget)
}
