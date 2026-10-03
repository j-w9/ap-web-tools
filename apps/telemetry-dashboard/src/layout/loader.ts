/**
 * Loading layouts and widgets onto grids (upstream `add_widget`, `load_widgets` and `load_layout`
 * in TelemetryDashboard.js), step for step and in upstream's order, over an injected
 * {@link LayoutTarget} so the sequence can be compared with the original (see `loader.test.ts`).
 *
 * Stored values are read as upstream read them: positions with `parseInt`, missing (or null)
 * positions left to the grid, widgets with `Object.values`, and errors thrown at the same point
 * with the same message, so a broken layout fails exactly where the original did (widgets before
 * the failure have been created, later ones have not).
 */
import { nullPropertyError, objectValues, prop, jsString, type JsonLike } from './json.js'
import { isWidgetType, type WidgetType } from './layout.js'

/** Upstream `new_widget`'s choice of class: one of the four types, else "Unknown widget type: ...". */
export function widgetClass(type: JsonLike): WidgetType {
  if (isWidgetType(type)) return type
  throw new Error('Unknown widget type: ' + jsString(type))
}

/** Grid position and size in cells, as parsed from a stored widget; null means "not given". */
export interface WidgetPlacement {
  readonly x: number | null
  readonly y: number | null
  readonly w: number | null
  readonly h: number | null
}

/** A position as GridStack takes it; upstream passed null for missing values, treated as absent. */
export interface GridPosition {
  x?: number
  y?: number
  w?: number
  h?: number
  autoPosition: boolean
}

function coordinate(obj: unknown, key: 'x' | 'y' | 'w' | 'h'): number | null {
  const value = prop(obj, key)
  return value === null || value === undefined ? null : Number.parseInt(jsString(value), 10)
}

/** Upstream `add_widget`'s first step: `(obj.x == null) ? null : parseInt(obj.x)`, and so on. */
export function widgetPlacement(obj: unknown): WidgetPlacement {
  if (obj === null || obj === undefined) throw nullPropertyError(obj, 'x')
  return { x: coordinate(obj, 'x'), y: coordinate(obj, 'y'), w: coordinate(obj, 'w'), h: coordinate(obj, 'h') }
}

export function gridPosition(placement: WidgetPlacement): GridPosition {
  const position: GridPosition = { autoPosition: false }
  if (placement.x !== null) position.x = placement.x
  if (placement.y !== null) position.y = placement.y
  if (placement.w !== null) position.w = placement.w
  if (placement.h !== null) position.h = placement.h
  return position
}

/** The grid settings of a layout (`grid_layout.color`, then `parseInt` of columns and rows). */
export function gridSettings(grid: unknown): { readonly color: JsonLike; readonly columns: number; readonly rows: number } {
  if (grid === null || grid === undefined) throw nullPropertyError(grid, 'color')
  return {
    color: prop(grid, 'color'),
    columns: Number.parseInt(jsString(prop(grid, 'columns')), 10),
    rows: Number.parseInt(jsString(prop(grid, 'rows')), 10)
  }
}

/** Grid and widget operations the loader drives. */
export interface LayoutTarget<Grid, Item> {
  /** The main grid, if any (upstream global `grid`). */
  currentGrid(): Grid | null
  /** Upstream `grid_edit_enabled`. */
  editEnabled(grid: Grid | null): boolean
  /** Upstream `grid_set_edit`. */
  setEdit(grid: Grid | null, enabled: boolean): void
  /** `dashboard_div.style.backgroundColor = value`, the value as stored. */
  setBackground(value: JsonLike): void
  /** Upstream `init_grid`: replaces the main grid. */
  initGrid(columns: number, rows: number): Grid
  willItFit(grid: Grid, position: GridPosition): boolean
  /** In-page `alert()`. */
  alert(text: string): void
  /** Upstream `new_widget(obj.type, obj.options)`; throws "Unknown widget type: ..." */
  createWidget(type: JsonLike, options: JsonLike): Item
  /** `target_grid.addWidget(widget, pos_opts)` then `widget.set_edit(grid_edit_enabled(target_grid))`. */
  place(grid: Grid, item: Item, position: GridPosition): void
  batchUpdate(grid: Grid, on: boolean): void
  items(grid: Grid): readonly Item[]
  /** `widget.init()` */
  initItem(item: Item): void
  /** Upstream `load_default_grid` (asynchronous: it fetches the default layout). */
  loadDefault(): void
  /** `grid_changed = false` */
  clearChanged(): void
}

/** Adds a widget at its position, else anywhere it fits, else tells the user it will not fit. */
export function addWidget<Grid, Item>(target: LayoutTarget<Grid, Item>, grid: Grid, obj: unknown): Item | undefined {
  const position = gridPosition(widgetPlacement(obj))
  if (!target.willItFit(grid, position)) {
    position.autoPosition = true
    if (!target.willItFit(grid, position)) {
      target.alert("Widget won't fit on Grid")
      return undefined
    }
  }
  const item = target.createWidget(prop(obj, 'type'), prop(obj, 'options'))
  target.place(grid, item, position)
  return item
}

/**
 * Adds stored widgets in a batch, then initialises every widget on the grid once it has laid them
 * out. A failure leaves the grid in batch mode, as upstream did.
 */
export function loadWidgets<Grid, Item>(target: LayoutTarget<Grid, Item>, grid: Grid, widgets: unknown): void {
  target.batchUpdate(grid, true)
  for (const widget of objectValues(widgets)) addWidget(target, grid, widget)
  target.batchUpdate(grid, false)
  for (const item of target.items(grid)) target.initItem(item)
}

/** Text of a caught error as upstream's `error.message` gave it. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : jsString(prop(error, 'message'))
}

/**
 * Replaces the main grid with a layout. On any failure the default layout is fetched and
 * "Grid load failed" shown with the error; the edit state is kept and the grid marked unchanged.
 */
export function loadLayout<Grid, Item>(target: LayoutTarget<Grid, Item>, gridLayout: unknown, widgets: unknown): void {
  const editEnabled = target.editEnabled(target.currentGrid())
  try {
    const settings = gridSettings(gridLayout)
    target.setBackground(settings.color)
    const grid = target.initGrid(settings.columns, settings.rows)
    loadWidgets(target, grid, widgets)
  } catch (error) {
    target.loadDefault()
    target.alert('Grid load failed\n' + errorMessage(error))
  }
  target.setEdit(target.currentGrid(), editEnabled)
  target.clearChanged()
}
