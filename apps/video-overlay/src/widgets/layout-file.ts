/**
 * VideoOverlay layout and widget files: the JSON upstream saves and loads (`get_layout`,
 * `save_widget`, the overlay file input handler, `add_widget`'s position parsing). The format is
 * unchanged so files move freely between upstream and this port.
 *
 * Candidate to share with telemetry-dashboard: the file shape is the same apart from the tool id.
 */
import { isJsonObject, parseJson, type OptionsObject } from './json.js'

/** `header.tool` of VideoOverlay files. */
export const LAYOUT_TOOL = 'videoOverlay'
/** `header.version` upstream writes. */
export const LAYOUT_VERSION = 1.0

/** Widget classes a VideoOverlay layout can name (upstream `new_widget`). */
export const WIDGET_TYPES = ['WidgetSandBoxVideoOverlay', 'WidgetSubGridVideoOverlay', 'WidgetCustomHTMLVideoOverlay'] as const
export type WidgetType = (typeof WIDGET_TYPES)[number]

export function isWidgetType(value: unknown): value is WidgetType {
  return WIDGET_TYPES.some((t) => t === value)
}

/**
 * One widget as saved (upstream `get_widget_object`): grid position as the `gs-*` attribute strings
 * (null when absent), the widget class name and its options.
 */
export interface SavedWidget {
  readonly x: string | null
  readonly y: string | null
  readonly w: string | null
  readonly h: string | null
  readonly type: string
  readonly options: OptionsObject
}

export interface LayoutHeader {
  readonly tool: typeof LAYOUT_TOOL
  readonly version: number
}

/** Main grid settings; rows and columns may be numbers or strings (upstream `parseInt`s them). */
export interface GridSettings {
  readonly columns: number | string
  readonly rows: number | string
  readonly color: string
}

/** A whole overlay (upstream `get_layout`). Widgets are keyed "0", "1", … */
export interface LayoutFile {
  readonly header: LayoutHeader
  readonly grid: GridSettings
  readonly widgets: Readonly<Record<string, SavedWidget>>
}

/** A single widget file (upstream `save_widget`). */
export interface WidgetFile {
  readonly header: LayoutHeader
  readonly widget: SavedWidget
}

/** Download names upstream uses. */
export const LAYOUT_FILE_NAME = 'VideoOverlay.json'
export const WIDGET_FILE_NAME = 'VideoOverlay_Widget.json'

/** Upstream's messages for files that cannot be loaded. */
export const WRONG_TOOL_MESSAGE = 'Layout not for this tool!'
/**
 * Upstream concatenates the `File` object itself into this message, so it always reads
 * "Unable to load from: [object File]" (reproduced; see upstream-bugs).
 */
export const UNABLE_TO_LOAD_MESSAGE = 'Unable to load from: [object File]'

/** What an overlay file contains, as upstream's file input handler distinguishes it. */
export type OverlayFileContent =
  | { readonly kind: 'layout'; readonly grid: unknown; readonly widgets: unknown }
  | { readonly kind: 'widget'; readonly widget: unknown }
  | { readonly kind: 'rejected'; readonly message: string }

/**
 * Classify a loaded overlay file. Invalid JSON throws, as `JSON.parse` does upstream. A file is
 * rejected unless `header.tool` is "videoOverlay"; then `widgets` makes it a layout and `widget`
 * a single widget, checked in that order.
 */
export function readOverlayFile(text: string): OverlayFileContent {
  const obj = parseJson(text)
  const header = isJsonObject(obj) ? obj['header'] : undefined
  const tool = isJsonObject(header) ? header['tool'] : undefined
  if (!isJsonObject(obj) || tool !== LAYOUT_TOOL) return { kind: 'rejected', message: WRONG_TOOL_MESSAGE }
  if ('widgets' in obj) return { kind: 'layout', grid: obj['grid'], widgets: obj['widgets'] }
  if ('widget' in obj) return { kind: 'widget', widget: obj['widget'] }
  return { kind: 'rejected', message: UNABLE_TO_LOAD_MESSAGE }
}

/** A position on a grid as gridstack takes it; absent members are auto-placed or defaulted. */
export interface GridPosition {
  x?: number
  y?: number
  w?: number
  h?: number
  autoPosition: boolean
}

/** Build a layout file (upstream `get_layout`). */
export function makeLayoutFile(grid: GridSettings, widgets: readonly SavedWidget[]): LayoutFile {
  return { header: { tool: LAYOUT_TOOL, version: LAYOUT_VERSION }, grid, widgets: widgetRecord(widgets) }
}

/** Build a single-widget file (upstream `save_widget`). */
export function makeWidgetFile(widget: SavedWidget): WidgetFile {
  return { header: { tool: LAYOUT_TOOL, version: LAYOUT_VERSION }, widget }
}

/** Widgets keyed by index, as upstream `get_widgets` returns them. */
export function widgetRecord(widgets: readonly SavedWidget[]): Readonly<Record<string, SavedWidget>> {
  const out: Record<string, SavedWidget> = {}
  widgets.forEach((w, i) => (out[String(i)] = w))
  return out
}

/** File text exactly as upstream writes it: two-space indented JSON. */
export function serialiseFile(file: LayoutFile | WidgetFile): string {
  return JSON.stringify(file, null, 2)
}
