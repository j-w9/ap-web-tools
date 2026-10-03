/**
 * The dashboard layout file format (upstream `get_layout`, `save_layout`, `save_widget`,
 * `load_file`).
 *
 *   { "header": { "version": 1 },
 *     "grid": { "columns": 12, "rows": 12, "color": "rgb(255, 255, 255)" },
 *     "widgets": { "0": { "x": "11", "y": "0", "w": "1", "h": "3", "type": "WidgetMenu", "options": {...} }, ... } }
 *
 * A single widget file is `{ "header": {...}, "widget": { ...one widget... } }`.
 *
 * Loaded files are not validated up front: upstream read each value only when it needed it, and
 * a broken file fails at the same point here (see `loader.ts` and the widget constructors).
 */
import { hasKey, prop, type JsonLike } from './json.js'
import type { OptionsObject } from '../widgets/options.js'

export const WIDGET_TYPES = ['WidgetMenu', 'WidgetSandBox', 'WidgetSubGrid', 'WidgetCustomHTML'] as const
export type WidgetType = (typeof WIDGET_TYPES)[number]

export function isWidgetType(value: unknown): value is WidgetType {
  return WIDGET_TYPES.some((t) => t === value)
}

/** What a loaded file contains (upstream `load_file`). */
export type DashboardFile =
  | { readonly kind: 'layout'; readonly grid: JsonLike; readonly widgets: JsonLike }
  | { readonly kind: 'widget'; readonly widget: JsonLike }
  | { readonly kind: 'unrecognised' }

/**
 * Classifies a file's JSON as `load_file` did: `"widgets" in obj` makes it a layout, else
 * `"widget" in obj` a single widget. Throws on invalid JSON, and (as `in` did) on JSON that is not
 * an object or array.
 */
export function classifyDashboardFile(text: string): DashboardFile {
  const parsed: unknown = JSON.parse(text)
  if (hasKey(parsed, 'widgets')) return { kind: 'layout', grid: prop(parsed, 'grid'), widgets: prop(parsed, 'widgets') }
  if (hasKey(parsed, 'widget')) return { kind: 'widget', widget: prop(parsed, 'widget') }
  return { kind: 'unrecognised' }
}

/** A widget as saved: positions as the grid's `gs-*` attribute strings (null when absent). */
export interface StoredWidget {
  readonly x: string | null
  readonly y: string | null
  readonly w: string | null
  readonly h: string | null
  readonly type: WidgetType
  readonly options: OptionsObject
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
