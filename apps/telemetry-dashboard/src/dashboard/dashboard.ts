/**
 * The dashboard (upstream TelemetryDashboard.js and the start-up script in index.html): the main
 * grid, loading and saving layouts and widgets, the widget palette, shareable links and the
 * unsaved-changes prompt.
 */
import { GridStack, type GridStackNode, type GridStackWidget } from 'gridstack'
import { downloadText } from '@apwt/tool-shell'
import {
  classifyDashboardFile,
  fileText,
  LAYOUT_FILE_NAME,
  parseLayout,
  storedLayout,
  storedWidgetFile,
  WIDGET_FILE_NAME,
  type StoredLayout,
  type StoredWidget,
  type WidgetSpec,
  parseWidget
} from '../layout/layout.js'
import { dashboardLink, decompressLayout, readHash, type HashSettings, type LinkConnection } from '../layout/link.js'
import type { LegacyMessage } from '../mavlink/legacy-message.js'
import { showMessage } from '../ui/dialogs.js'
import { parseStored, widgetOf, type Widget } from '../widgets/base.js'
import { CustomHtmlWidget } from '../widgets/custom-html.js'
import { MenuWidget, SETTINGS_ICON_ID } from '../widgets/menu.js'
import type { MenuHost, SettingsMenu } from '../widgets/menu-panels.js'
import { SandboxWidget } from '../widgets/sandbox.js'
import { SubGridWidget } from '../widgets/subgrid.js'
import type { WidgetEditor } from './editor.js'
import defaultLayoutUrl from '../assets/Default_Layout.json?url'

export interface DashboardOptions {
  /** The main grid element (upstream `#dashboard`). */
  readonly element: HTMLElement
  readonly publish: (message: LegacyMessage) => void
  readonly editor: WidgetEditor
  readonly pageUrl: () => string
  readonly hash: string
}

function gridWidget(spec: WidgetSpec): GridStackWidget {
  // Upstream passed null for missing values, which GridStack treats like undefined.
  const position: GridStackWidget = { autoPosition: false }
  if (spec.x !== null) position.x = spec.x
  if (spec.y !== null) position.y = spec.y
  if (spec.w !== null) position.w = spec.w
  if (spec.h !== null) position.h = spec.h
  return position
}

export class Dashboard implements MenuHost {
  readonly element: HTMLElement
  readonly hashSettings: HashSettings
  grid: GridStack | null = null
  private gridChanged = false
  private readonly options: DashboardOptions
  private connectionParams: (() => LinkConnection) | null = null
  private readonly settingsMenus = new WeakMap<HTMLElement, SettingsMenu>()

  constructor(options: DashboardOptions) {
    this.options = options
    this.element = options.element
    this.hashSettings = readHash(options.hash)
  }

  publish(message: LegacyMessage): void {
    this.options.publish(message)
  }

  // ---- Widgets and grids -------------------------------------------------------------------

  newWidget(spec: Pick<WidgetSpec, 'type' | 'options'>): Widget {
    switch (spec.type) {
      case 'WidgetMenu':
        return new MenuWidget(spec.options, this)
      case 'WidgetSandBox':
        return new SandboxWidget(spec.options, this)
      case 'WidgetSubGrid':
        return new SubGridWidget(spec.options, this)
      case 'WidgetCustomHTML':
        return new CustomHtmlWidget(spec.options, this)
    }
  }

  /** Details of a widget for copying or saving: grid attributes as stored by GridStack. */
  getWidgetObject(widget: Widget): StoredWidget {
    return {
      x: widget.el.getAttribute('gs-x'),
      y: widget.el.getAttribute('gs-y'),
      w: widget.el.getAttribute('gs-w'),
      h: widget.el.getAttribute('gs-h'),
      type: widget.type,
      options: widget.getOptions()
    }
  }

  getWidgets(grid: GridStack): StoredWidget[] {
    const out: StoredWidget[] = []
    for (const el of grid.getGridItems()) {
      const widget = widgetOf(el)
      if (widget !== undefined) out.push(this.getWidgetObject(widget))
    }
    return out
  }

  getLayout(): StoredLayout {
    const grid = this.grid
    return storedLayout(
      {
        columns: grid?.opts.column === 'auto' ? undefined : grid?.opts.column,
        rows: grid?.opts.maxRow,
        color: this.element.style.backgroundColor
      },
      grid === null ? [] : this.getWidgets(grid)
    )
  }

  saveLayout(): void {
    downloadText(LAYOUT_FILE_NAME, fileText(this.getLayout()))
    this.gridChanged = false
    for (const el of this.grid?.getGridItems() ?? []) widgetOf(el)?.saved()
  }

  saveWidget(widget: Widget): void {
    downloadText(WIDGET_FILE_NAME, fileText(storedWidgetFile(this.getWidgetObject(widget))))
  }

  clearGrid(grid: GridStack | null): void {
    if (grid === null) return
    for (const el of grid.getGridItems()) {
      widgetOf(el)?.destroy()
      grid.removeWidget(el)
    }
    grid.removeAll()
    grid.destroy(false)
  }

  private initGrid(columns: number, rows: number): void {
    this.clearGrid(this.grid)
    const grid = GridStack.init(
      {
        float: true,
        disableDrag: true,
        disableResize: true,
        column: columns,
        row: rows,
        cellHeight: `${100 / rows}%`,
        alwaysShowResizeHandle: true,
        acceptWidgets: true
      },
      this.element
    )
    this.grid = grid
    this.firstSettingsMenu()?.setGridSize(columns, rows)
    grid.on('dropped', (event, previous, dropped) => this.widgetDropped(event, previous, dropped))
    grid.on('change added removed', () => {
      this.gridChanged = true
    })
  }

  gridEditEnabled(grid: GridStack | null): boolean {
    if (grid === null) return false
    return !(grid.opts.disableDrag === true && grid.opts.disableResize === true)
  }

  gridSetEdit(grid: GridStack | null, enabled: boolean): void {
    if (grid === null) return
    if (enabled) grid.enable()
    else grid.disable()
    for (const el of grid.getGridItems()) widgetOf(el)?.setEdit(enabled)
  }

  /** Adds a widget at its position, else anywhere it fits, else tells the user it will not fit. */
  addWidget(grid: GridStack, spec: WidgetSpec): Widget | undefined {
    const position = gridWidget(spec)
    if (!grid.willItFit(position)) {
      position.autoPosition = true
      if (!grid.willItFit(position)) {
        void showMessage("Widget won't fit on Grid")
        return undefined
      }
    }
    const widget = this.newWidget(spec)
    grid.addWidget(widget.el, position)
    widget.setEdit(this.gridEditEnabled(grid))
    return widget
  }

  loadWidgets(grid: GridStack, widgets: readonly WidgetSpec[]): void {
    grid.batchUpdate(true)
    for (const spec of widgets) this.addWidget(grid, spec)
    grid.batchUpdate(false)
    // Initialise after the grid has laid out, so widgets have their size.
    for (const el of grid.getGridItems()) widgetOf(el)?.init()
  }

  /** Loads a layout's grid and widgets; on failure loads the default layout and reports why. */
  loadLayout(grid: unknown, widgets: unknown): void {
    const editEnabled = this.gridEditEnabled(this.grid)
    try {
      const layout = parseLayout(grid, widgets)
      if (layout.grid.color !== null) this.element.style.backgroundColor = layout.grid.color
      this.initGrid(layout.grid.columns, layout.grid.rows)
      if (this.grid !== null) this.loadWidgets(this.grid, layout.widgets)
    } catch (error) {
      this.loadDefaultGrid()
      void showMessage('Grid load failed\n' + (error instanceof Error ? error.message : String(error)))
    }
    this.gridSetEdit(this.grid, editEnabled)
    this.gridChanged = false
  }

  loadDefaultGrid(): void {
    void fetch(defaultLayoutUrl)
      .then((res) => res.json() as Promise<unknown>)
      .then((obj) => {
        const record = typeof obj === 'object' && obj !== null ? (obj as Readonly<Record<string, unknown>>) : {}
        this.loadLayout(record.grid, record.widgets)
      })
  }

  /** Upstream `load_initial_grid`: the layout from the link, else the default. */
  async loadInitialGrid(): Promise<void> {
    const layoutParam = this.hashSettings.layout
    if (layoutParam === null || layoutParam === '') {
      this.loadDefaultGrid()
      return
    }
    try {
      const parsed: unknown = JSON.parse(await decompressLayout(layoutParam))
      const record = typeof parsed === 'object' && parsed !== null ? (parsed as Readonly<Record<string, unknown>>) : {}
      if (parsed === null) throw new TypeError("Cannot read properties of null (reading 'grid')")
      this.loadLayout(record.grid, record.widgets)
    } catch (error) {
      console.log(error)
      this.loadDefaultGrid()
    }
  }

  /** A layout or single widget file chosen by the user (upstream `load_file`). */
  loadFile(file: File): void {
    void file.text().then((text) => {
      const contents = classifyDashboardFile(text)
      switch (contents.kind) {
        case 'layout':
          this.loadLayout(contents.grid, contents.widgets)
          break
        case 'widget': {
          if (this.grid === null) return
          const widget = this.addWidget(this.grid, parseWidget(contents.widget))
          widget?.init()
          break
        }
        case 'unrecognised':
          // Upstream concatenated the File object itself.
          void showMessage('Unable to load from: ' + Object.prototype.toString.call(file))
          break
      }
    })
  }

  /**
   * A widget dropped onto a grid (from the palette or another grid). Sub grids misbehave when
   * moved, so every dropped widget is replaced by a fresh copy.
   */
  widgetDropped(_event: Event, _previous: GridStackNode, dropped: GridStackNode): void {
    const el = dropped.el
    const target = dropped.grid
    const widget = el === undefined ? undefined : widgetOf(el)
    if (el === undefined || target === undefined || widget === undefined) return
    const stored = this.getWidgetObject(widget)
    widget.destroy()
    target.removeWidget(el)
    this.addWidget(target, parseStored(stored))?.init()
  }

  loadEditor(widget: Widget): void {
    this.options.editor.open(widget)
  }

  // ---- Menu --------------------------------------------------------------------------------

  registerSettingsMenu(icon: HTMLElement, menu: SettingsMenu): void {
    this.settingsMenus.set(icon, menu)
  }

  /** The settings of the first menu in the page (upstream looked the elements up by id). */
  private firstSettingsMenu(): SettingsMenu | undefined {
    const icon = document.getElementById(SETTINGS_ICON_ID)
    return icon === null ? undefined : this.settingsMenus.get(icon)
  }

  setConnectionParams(params: () => LinkConnection): void {
    this.connectionParams = params
  }

  setMainGridEdit(enabled: boolean): void {
    this.gridSetEdit(this.grid, enabled)
  }

  mainGridSize(): { readonly columns: number | undefined; readonly rows: number | undefined } {
    const column = this.grid?.opts.column
    return { columns: column === 'auto' ? undefined : column, rows: this.grid?.opts.maxRow }
  }

  setMainGridColumns(columns: number): void {
    this.grid?.column(columns, 'list')
  }

  setMainGridRows(rows: string): void {
    // Rows cannot change on a live grid: reload the layout with the new count.
    const layout = this.getLayout()
    this.loadLayout({ ...layout.grid, rows }, layout.widgets)
  }

  backgroundColor(): string {
    return this.element.style.backgroundColor
  }

  setBackgroundColor(color: string): void {
    this.element.style.backgroundColor = color
  }

  dashboardLink(): Promise<string> {
    return dashboardLink(this.options.pageUrl(), this.connectionParams?.() ?? null, JSON.stringify(this.getLayout()))
  }

  // ---- Leaving the page --------------------------------------------------------------------

  /** True when the grid or any widget has unsaved changes. */
  hasUnsavedChanges(): boolean {
    if (this.grid === null) return false
    if (this.gridChanged) return true
    return this.grid.getGridItems().some((el) => widgetOf(el)?.getChanged() === true)
  }

  /** Upstream `handle_unload`: prompt, and open the settings with the save button focused. */
  handleUnload(event: BeforeUnloadEvent): void {
    if (!this.hasUnsavedChanges()) return
    event.preventDefault()
    // Upstream set both, as older browsers require.
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- needed by browsers that ignore preventDefault here
    event.returnValue = ''
    const menu = this.firstSettingsMenu()
    if (menu === undefined) return
    menu.show()
    menu.focusSave()
  }
}
