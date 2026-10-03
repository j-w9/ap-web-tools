/**
 * The overlay's grids: the main grid over the video, the widget palette and the services widgets
 * call, ported from the grid half of upstream `VideoOverlay.js` (`init_grid`, `add_widget`,
 * `load_widgets`, `load_layout`, `widget_dropped`, `loadPalette`, `get_layout`, `save_layout`,
 * `save_widget`, `gridSizeUpdate`, `setWidgetTime`, `renderOverlay`, `handle_unload`).
 */
import { GridStack, type GridStackDroppedHandler, type GridStackNode } from 'gridstack'
import tippy from 'tippy.js'
import html2canvas from 'html2canvas'
import defaultLayout from '../defaults/default-layout.json'
import defaultPalette from '../defaults/default-palette.json'
import { CustomHtmlWidget, SandboxWidget } from './frame-widgets.js'
import { isJsonObject } from './json.js'
import {
  gridLoadFailedMessage,
  gridSize,
  LAYOUT_FILE_NAME,
  makeLayoutFile,
  makeWidgetFile,
  savedPosition,
  savedTypeAndOptions,
  savedWidgetList,
  serialiseFile,
  unknownWidgetTypeMessage,
  WIDGET_FILE_NAME,
  type GridSettings,
  type LayoutFile,
  type SavedWidget
} from './layout-file.js'
import { SubGridWidget } from './subgrid-widget.js'
import { gridWidgets, savedWidget, savedWidgets, type Dialogs, type OverlayWidget, type WidgetEnvironment } from './widget.js'
import type { WidgetEditor } from './widget-editor.js'

/** Upstream's message when a widget does not fit. */
export const WONT_FIT_MESSAGE = "Widget won't fit on Grid"

/** What the controller needs from the page. */
export interface OverlayPage {
  readonly dialogs: Dialogs
  /** The overlay grid element over the video. */
  readonly dashboard: HTMLElement
  /** The palette grid element. */
  readonly palette: HTMLElement
  /** Current video time, seconds. */
  videoTime(): number
  /** Log time for a video time, using the current offset. */
  logTimeAt(videoTimeS: number): number
  /** Called whenever the main grid is (re)built, with its size for the rows/columns inputs. */
  onGridSize(size: { columns: number; rows: number }): void
  /** Offer a text file for download. */
  download(fileName: string, text: string): void
}

/** Create a widget of a saved class (upstream `new_widget`). */
export function newWidget(env: WidgetEnvironment, type: unknown, options: unknown): OverlayWidget {
  const opts = isJsonObject(options) ? options : {}
  switch (type) {
    case 'WidgetSandBoxVideoOverlay':
      return new SandboxWidget(env, opts)
    case 'WidgetSubGridVideoOverlay':
      return new SubGridWidget(env, opts)
    case 'WidgetCustomHTMLVideoOverlay':
      return new CustomHtmlWidget(env, opts)
  }
  throw new Error(unknownWidgetTypeMessage(type))
}

export class OverlayController implements WidgetEnvironment {
  readonly dialogs: Dialogs
  grid: GridStack | undefined
  private palette: GridStack | undefined
  private gridChanged = false
  private log: ArrayBuffer | null = null
  editor: WidgetEditor | undefined

  constructor(private readonly page: OverlayPage) {
    this.dialogs = page.dialogs
  }

  // ------------------------------------------------------------ widget services

  logBuffer(): ArrayBuffer | null {
    return this.log
  }

  addWidget(target: GridStack, saved: unknown): OverlayWidget | undefined {
    const pos = savedPosition(saved)
    if (!target.willItFit(pos)) {
      pos.autoPosition = true
      if (!target.willItFit(pos)) {
        this.dialogs.alert(WONT_FIT_MESSAGE)
        return undefined
      }
    }
    const { type, options } = savedTypeAndOptions(saved)
    const widget = newWidget(this, type, options)
    target.addWidget(widget, pos)
    widget.setEdit(true)
    return widget
  }

  loadWidgets(target: GridStack, widgets: unknown): void {
    target.batchUpdate(true)
    try {
      for (const widget of savedWidgetList(widgets)) this.addWidget(target, widget)
    } finally {
      target.batchUpdate(false)
    }
    // Initialise once the grid has laid the widgets out.
    for (const widget of gridWidgets(target)) {
      widget.init()
      widget.loadLog()
    }
    void this.setWidgetTime(this.page.videoTime())
  }

  clearGrid(target: GridStack | undefined): void {
    if (target === undefined) return
    for (const widget of gridWidgets(target)) {
      widget.destroy()
      target.removeWidget(widget)
    }
    target.removeAll()
    target.destroy(false)
  }

  gridSetEdit(target: GridStack | undefined, enabled: boolean): void {
    if (target === undefined) return
    if (enabled) target.enable()
    else target.disable()
    for (const widget of gridWidgets(target)) widget.setEdit(enabled)
  }

  /**
   * A widget was dropped onto a grid. Sub grids misbehave when moved, so the dropped element is
   * replaced by a fresh copy; a widget taken from the palette is replaced there too.
   */
  readonly widgetDropped: GridStackDroppedHandler = (_event, previous: GridStackNode, dropped: GridStackNode) => {
    const el = dropped.el
    const target = dropped.grid
    if (!(el instanceof HTMLElement) || target === undefined) return
    const widget = gridWidgets(target).find((w) => w === el)
    if (widget === undefined) return
    const saved = savedWidget(widget)
    widget.destroy()
    target.removeWidget(widget)
    const copy = this.addWidget(target, saved)
    if (copy !== undefined) {
      copy.init()
      copy.loadLog()
    }
    void this.setWidgetTime(this.page.videoTime())
    if (previous.grid === this.palette) this.loadPalette()
  }

  editWidget(widget: OverlayWidget): void {
    this.editor?.open(widget)
  }

  saveWidget(widget: OverlayWidget): void {
    this.page.download(WIDGET_FILE_NAME, serialiseFile(makeWidgetFile(savedWidget(widget))))
  }

  // ------------------------------------------------------------ main grid

  /** Build an empty main grid of the given size (upstream `init_grid`). */
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
      this.page.dashboard
    )
    this.grid = grid
    this.page.onGridSize({ columns, rows })
    grid.on('dropped', this.widgetDropped)
    grid.on('change added removed', () => {
      this.gridChanged = true
    })
    return grid
  }

  /** Load a layout; on failure fall back to the default and report why (upstream `load_layout`). */
  loadLayout(gridSettings: unknown, widgets: unknown): void {
    try {
      const { columns, rows } = gridSize(gridSettings)
      const grid = this.initGrid(columns, rows)
      this.loadWidgets(grid, widgets)
    } catch (error) {
      this.loadDefaultLayout()
      this.dialogs.alert(gridLoadFailedMessage(error))
    }
    this.gridSetEdit(this.grid, true)
    this.gridChanged = false
  }

  loadDefaultLayout(): void {
    this.loadLayout(defaultLayout.grid, defaultLayout.widgets)
  }

  /** Add a single saved widget to the main grid (overlay file input). */
  loadWidgetFile(saved: unknown): void {
    if (this.grid === undefined) return
    const widget = this.addWidget(this.grid, saved)
    if (widget === undefined) return
    widget.init()
    widget.loadLog()
    void this.setWidgetTime(this.page.videoTime())
  }

  /** The current layout (upstream `get_layout`). */
  layout(): LayoutFile | undefined {
    const grid = this.grid
    if (grid === undefined) return undefined
    const settings: GridSettings = {
      columns: grid.opts.column ?? 12,
      rows: grid.opts.maxRow ?? 0,
      color: this.page.dashboard.style.backgroundColor
    }
    return makeLayoutFile(settings, savedWidgets(grid))
  }

  /** Download the layout and mark everything saved (upstream `save_layout`). */
  saveLayout(): void {
    const layout = this.layout()
    const grid = this.grid
    if (layout === undefined || grid === undefined) return
    this.page.download(LAYOUT_FILE_NAME, serialiseFile(layout))
    this.gridChanged = false
    for (const widget of gridWidgets(grid)) widget.saved()
  }

  /** Rebuild the main grid with new rows/columns, keeping the widgets (upstream `gridSizeUpdate`). */
  setGridSize(rows: string, columns: string): void {
    const layout = this.layout()
    if (layout === undefined) return
    this.loadLayout({ ...layout.grid, rows, columns }, layout.widgets)
    this.gridChanged = true
  }

  /** Whether leaving the page would lose changes (upstream `handle_unload`). */
  hasUnsavedChanges(): boolean {
    const grid = this.grid
    if (grid === undefined) return false
    return this.gridChanged || gridWidgets(grid).some((w) => w.getChanged())
  }

  // ------------------------------------------------------------ palette

  /** Rebuild the palette from the default palette file (upstream `loadPalette`). */
  loadPalette(): void {
    this.clearGrid(this.palette)
    const palette = GridStack.init(
      { float: true, column: 7, row: 1, cellHeight: '100px', disableResize: true },
      this.page.palette
    )
    this.palette = palette
    this.loadWidgets(palette, defaultPalette.widgets)
    for (const widget of gridWidgets(palette)) {
      const about = widget.getAbout()
      const tip = document.createElement('div')
      const heading = document.createElement('h6')
      heading.innerText = about.name
      tip.appendChild(heading)
      if (about.info !== undefined) tip.appendChild(document.createTextNode(about.info))
      tippy(widget, { content: tip, appendTo: () => document.body, theme: 'light-border' })
    }
  }

  // ------------------------------------------------------------ log and time

  /** Hand a newly loaded log to every widget and show the current time. */
  setLog(buffer: ArrayBuffer): void {
    this.log = buffer
    if (this.grid === undefined) return
    for (const widget of gridWidgets(this.grid)) widget.loadLog()
    void this.setWidgetTime(this.page.videoTime())
  }

  /** Show the log time matching a video time on every widget; resolves once all have rendered. */
  setWidgetTime(videoTimeS: number): Promise<unknown> {
    const grid = this.grid
    if (grid === undefined) return Promise.resolve()
    const logTime = this.page.logTimeAt(videoTimeS)
    return Promise.allSettled(gridWidgets(grid).map((w) => w.setTime(logTime)))
  }

  /**
   * Draw every widget onto an export frame (upstream `renderOverlay`): each widget's content is
   * captured with html2canvas at the export scale and placed at its overlay position.
   */
  async renderOverlay(context: OffscreenCanvasRenderingContext2D, overlayBox: DOMRect): Promise<void> {
    const grid = this.grid
    if (grid === undefined) return
    const items = gridWidgets(grid).flatMap((w) => w.getContentForRender(overlayBox))
    const scale = context.canvas.width / overlayBox.width
    for (const item of items) {
      const snap = await html2canvas(item.content, {
        backgroundColor: null,
        scale,
        useCORS: true,
        allowTaint: false,
        logging: false,
        // Ignore grid stack resize handles
        ignoreElements: (el) => el.classList.contains('ui-resizable-handle')
      })
      context.drawImage(snap, item.pos.x * scale, item.pos.y * scale)
    }
  }

  /** Remove every grid and widget (page teardown). */
  dispose(): void {
    this.clearGrid(this.grid)
    this.clearGrid(this.palette)
    this.grid = undefined
    this.palette = undefined
  }
}

export type { SavedWidget }
