/**
 * The dashboard (upstream TelemetryDashboard.js and the start-up script in index.html): the main
 * grid, loading and saving layouts and widgets, the widget palette, shareable links and the
 * unsaved-changes prompt.
 */
import { GridStack, type GridStackNode } from 'gridstack'
import { downloadText } from '@apwt/tool-shell'
import {
  classifyDashboardFile,
  fileText,
  LAYOUT_FILE_NAME,
  storedLayout,
  storedWidgetFile,
  WIDGET_FILE_NAME,
  type StoredLayout,
  type StoredWidget
} from '../layout/layout.js'
import { domString, prop, type JsonLike } from '../layout/json.js'
import { dashboardLink, decompressLayout, readHash, type HashSettings, type LinkConnection } from '../layout/link.js'
import { addWidget, loadLayout, loadWidgets, widgetClass, type LayoutTarget } from '../layout/loader.js'
import type { LegacyMessage } from '../mavlink/legacy-message.js'
import { createMavlinkProcessor, type MavlinkProcessor } from '../connection/connection.js'
import { showMessage } from '../ui/dialogs.js'
import { widgetOf, type Widget } from '../widgets/base.js'
import { CustomHtmlWidget } from '../widgets/custom-html.js'
import { MenuWidget, SETTINGS_ICON_ID } from '../widgets/menu.js'
import { SETTINGS_PANEL_ID, type MenuHost, type SettingsMenu } from '../widgets/menu-panels.js'
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

/** Reads a file as text the way upstream's `FileReader.readAsText` did (BOM sniffing included). */
function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read the file'))
    reader.readAsText(file)
  })
}

export class Dashboard implements MenuHost {
  readonly element: HTMLElement
  readonly hashSettings: HashSettings
  grid: GridStack | null = null
  private gridChanged = false
  private readonly options: DashboardOptions
  private connectionParams: (() => LinkConnection) | null = null
  private readonly settingsMenus = new WeakMap<HTMLElement, SettingsMenu>()
  private readonly settingsPanels = new WeakMap<HTMLElement, SettingsMenu>()
  /** The page's one MAVLink parser and signing state (upstream global `MAVLink`), shared by every menu. */
  readonly mavlink: MavlinkProcessor = createMavlinkProcessor(Date.now())
  /** The grid and widget operations of upstream's layout functions (see `loader.ts`). */
  private readonly target: LayoutTarget<GridStack, Widget>

  constructor(options: DashboardOptions) {
    this.options = options
    this.element = options.element
    this.hashSettings = readHash(options.hash)
    this.target = {
      currentGrid: () => this.grid,
      editEnabled: (grid) => this.gridEditEnabled(grid),
      setEdit: (grid, enabled) => this.gridSetEdit(grid, enabled),
      setBackground: (value) => {
        this.element.style.backgroundColor = domString(value)
      },
      initGrid: (columns, rows) => this.initGrid(columns, rows),
      willItFit: (grid, position) => grid.willItFit(position),
      alert: (text) => void showMessage(text),
      createWidget: (type, options) => this.newWidget(type, options),
      place: (grid, widget, position) => {
        grid.addWidget(widget.el, position)
        widget.setEdit(this.gridEditEnabled(grid))
      },
      batchUpdate: (grid, on) => grid.batchUpdate(on),
      items: (grid) => this.gridWidgets(grid),
      initItem: (widget) => widget.init(),
      loadDefault: () => this.loadDefaultGrid(),
      clearChanged: () => {
        this.gridChanged = false
      }
    }
  }

  publish(message: LegacyMessage): void {
    this.options.publish(message)
  }

  // ---- Widgets and grids -------------------------------------------------------------------

  /** Upstream `new_widget(type, options)`. */
  newWidget(type: JsonLike, options: JsonLike): Widget {
    switch (widgetClass(type)) {
      case 'WidgetMenu':
        return new MenuWidget(options, this)
      case 'WidgetSandBox':
        return new SandboxWidget(options, this)
      case 'WidgetSubGrid':
        return new SubGridWidget(options, this)
      case 'WidgetCustomHTML':
        return new CustomHtmlWidget(options, this)
    }
  }

  /** The widgets on a grid (upstream `getGridItems()`, which only ever holds widgets). */
  private gridWidgets(grid: GridStack): Widget[] {
    return grid.getGridItems().flatMap((el) => {
      const widget = widgetOf(el)
      return widget === undefined ? [] : [widget]
    })
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

  private initGrid(columns: number, rows: number): GridStack {
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
    // Upstream looked the settings popup up by id, which finds it only while it is shown.
    const panel = document.getElementById(SETTINGS_PANEL_ID)
    if (panel !== null) this.settingsPanels.get(panel)?.setGridSize(columns, rows)
    grid.on('dropped', (event, previous, dropped) => this.widgetDropped(event, previous, dropped))
    grid.on('change added removed', () => {
      this.gridChanged = true
    })
    return grid
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

  /** Upstream `add_widget`: at its position, else anywhere it fits, else "Widget won't fit on Grid". */
  addWidget(grid: GridStack, obj: unknown): Widget | undefined {
    return addWidget(this.target, grid, obj)
  }

  /** Upstream `load_widgets`. */
  loadWidgets(grid: GridStack, widgets: unknown): void {
    loadWidgets(this.target, grid, widgets)
  }

  /** Upstream `load_layout`: on failure loads the default layout and reports why. */
  loadLayout(grid: unknown, widgets: unknown): void {
    loadLayout(this.target, grid, widgets)
  }

  loadDefaultGrid(): void {
    void fetch(defaultLayoutUrl)
      .then((res) => res.json() as Promise<unknown>)
      .then((obj) => {
        this.loadLayout(prop(obj, 'grid'), prop(obj, 'widgets'))
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
      if (parsed === null) throw new TypeError("Cannot read properties of null (reading 'grid')")
      this.loadLayout(prop(parsed, 'grid'), prop(parsed, 'widgets'))
    } catch (error) {
      console.log(error)
      this.loadDefaultGrid()
    }
  }

  /** A layout or single widget file chosen by the user (upstream `load_file`). */
  loadFile(file: File): void {
    void readAsText(file).then((text) => {
      const contents = classifyDashboardFile(text)
      switch (contents.kind) {
        case 'layout':
          this.loadLayout(contents.grid, contents.widgets)
          break
        case 'widget': {
          if (this.grid === null) return
          const widget = this.addWidget(this.grid, contents.widget)
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
    this.addWidget(target, stored)?.init()
  }

  loadEditor(widget: Widget): void {
    this.options.editor.open(widget)
  }

  // ---- Menu --------------------------------------------------------------------------------

  registerSettingsMenu(icon: HTMLElement, panel: HTMLElement, menu: SettingsMenu): void {
    this.settingsMenus.set(icon, menu)
    this.settingsPanels.set(panel, menu)
  }

  /** The settings of the first menu in the page (upstream looked its icon up by id). */
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
