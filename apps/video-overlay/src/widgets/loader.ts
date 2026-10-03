/**
 * Loading layouts and widgets onto grids (upstream `add_widget`, `load_widgets` and `load_layout`
 * in VideoOverlay.js), step for step and in upstream's order, over an injected
 * {@link OverlayLayoutTarget} so the sequence can be compared with the original (`loader.test.ts`).
 *
 * Stored values are read as upstream read them (positions with `parseInt`, widgets with
 * `Object.values`) and errors are thrown at the same point with the same message, so a broken
 * layout fails exactly where the original did.
 */
import { anyString, nullPropertyError, objectValues, prop, type JsonLike } from './json.js'
import { isWidgetType, type GridPosition, type WidgetType } from './layout-file.js'

function coordinate(obj: unknown, key: 'x' | 'y' | 'w' | 'h'): number | undefined {
  const value = prop(obj, key)
  // Upstream: `(obj.x == null) ? null : parseInt(obj.x)`; gridstack treats null like a missing value.
  return value === null || value === undefined ? undefined : Number.parseInt(anyString(value), 10)
}

/** Upstream `add_widget`'s first step, reading `obj.x` (which throws for a null widget). */
export function widgetPosition(obj: unknown): GridPosition {
  if (obj === null || obj === undefined) throw nullPropertyError(obj, 'x')
  const position: GridPosition = { autoPosition: false }
  const x = coordinate(obj, 'x')
  const y = coordinate(obj, 'y')
  const w = coordinate(obj, 'w')
  const h = coordinate(obj, 'h')
  if (x !== undefined) position.x = x
  if (y !== undefined) position.y = y
  if (w !== undefined) position.w = w
  if (h !== undefined) position.h = h
  return position
}

/** Upstream `new_widget`'s choice of class: one of the three, else "Unknown widget type: ...". */
export function widgetClass(type: JsonLike): WidgetType {
  if (isWidgetType(type)) return type
  throw new Error('Unknown widget type: ' + anyString(type))
}

/** Grid and widget operations the loader drives. */
export interface OverlayLayoutTarget<Grid, Item> {
  /** The main grid, if any (upstream global `grid`). */
  currentGrid(): Grid | undefined
  /** Upstream `grid_set_edit`. */
  setEdit(grid: Grid | undefined, enabled: boolean): void
  /** Upstream `init_grid`: replaces the main grid. */
  initGrid(columns: number, rows: number): Grid
  willItFit(grid: Grid, position: GridPosition): boolean
  /** In-page `alert()`. */
  alert(text: string): void
  /** Upstream `new_widget(obj.type, obj.options)`. */
  createWidget(type: WidgetType, options: JsonLike): Item
  /** `target_grid.addWidget(widget, pos_opts)` then `widget.set_edit(true)`. */
  place(grid: Grid, item: Item, position: GridPosition): void
  batchUpdate(grid: Grid, on: boolean): void
  items(grid: Grid): readonly Item[]
  /** `widget.init()` then `widget.loadLog()`. */
  initItem(item: Item): void
  /** `setWidgetTime(video.currentTime)` */
  showCurrentTime(): void
  /** Upstream `load_default_grid` (asynchronous: it fetched the default layout). */
  loadDefault(): void
  /** `grid_changed = false` */
  clearChanged(): void
}

/** Adds a widget at its position, else anywhere it fits, else tells the user it will not fit. */
export function addWidget<Grid, Item>(target: OverlayLayoutTarget<Grid, Item>, grid: Grid, obj: unknown): Item | undefined {
  const position = widgetPosition(obj)
  if (!target.willItFit(grid, position)) {
    position.autoPosition = true
    if (!target.willItFit(grid, position)) {
      target.alert("Widget won't fit on Grid")
      return undefined
    }
  }
  const item = target.createWidget(widgetClass(prop(obj, 'type')), prop(obj, 'options'))
  target.place(grid, item, position)
  return item
}

/**
 * Adds stored widgets in a batch, initialises and gives the log to every widget on the grid, then
 * shows the current video time. A failure leaves the grid in batch mode, as upstream did.
 */
export function loadWidgets<Grid, Item>(target: OverlayLayoutTarget<Grid, Item>, grid: Grid, widgets: unknown): void {
  target.batchUpdate(grid, true)
  for (const widget of objectValues(widgets)) addWidget(target, grid, widget)
  target.batchUpdate(grid, false)
  for (const item of target.items(grid)) target.initItem(item)
  target.showCurrentTime()
}

/** Upstream `init_grid(parseInt(grid_layout.columns), parseInt(grid_layout.rows))`'s arguments. */
export function gridSize(grid: unknown): { readonly columns: number; readonly rows: number } {
  if (grid === null || grid === undefined) throw nullPropertyError(grid, 'columns')
  return {
    columns: Number.parseInt(anyString(prop(grid, 'columns')), 10),
    rows: Number.parseInt(anyString(prop(grid, 'rows')), 10)
  }
}

/** Text of a caught error as upstream's `error.message` gave it. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : anyString(prop(error, 'message'))
}

/**
 * Replaces the main grid with a layout. On any failure the default layout is loaded and
 * "Grid load failed" shown; editing is enabled and the grid marked unchanged either way.
 */
export function loadLayout<Grid, Item>(target: OverlayLayoutTarget<Grid, Item>, gridLayout: unknown, widgets: unknown): void {
  try {
    const { columns, rows } = gridSize(gridLayout)
    loadWidgets(target, target.initGrid(columns, rows), widgets)
  } catch (error) {
    target.loadDefault()
    target.alert('Grid load failed\n' + errorMessage(error))
  }
  target.setEdit(target.currentGrid(), true)
  target.clearChanged()
}
