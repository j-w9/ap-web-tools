/**
 * Sub grid widget (upstream Widgets/SubGrid.js): a nested grid of widgets with its own size,
 * border, background colour and optional background image (the grid then keeps the image's
 * aspect ratio so widgets stay over the same part of the image).
 */
import { GridStack } from 'gridstack'
import { isJsonArray, isJsonObject, jsString, type Json, type JsonObject } from '../layout/json.js'
import { parseWidgets, type WidgetSpec } from '../layout/layout.js'
import { parseStored, Widget, widgetOf } from './base.js'
import { SUBGRID_FORM } from './forms.js'
import { framedContent, fullSizeDiv, type GridHost } from './grid-host.js'

export const SUBGRID_ABOUT = { name: 'Subgrid', info: 'Nestable sub grid widget' } as const

/** Upstream compared stored and form values with `!=`, so `2` and `"2"` are the same size. */
function looselyEqual(a: Json | undefined, b: Json | undefined): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null)
  if (typeof a === 'object' || typeof b === 'object') return a === b
  return typeof a === typeof b ? a === b : Number(a) === Number(b)
}

export class SubGridWidget extends Widget {
  protected override readonly host: GridHost
  private readonly widgetDiv: HTMLDivElement
  private readonly sizeDiv: HTMLDivElement
  private gridDiv: HTMLDivElement | null = null
  grid: GridStack | null = null
  private gridRows: Json | undefined
  private gridColumns: Json | undefined
  private widgetsToLoad: WidgetSpec[] | null = null
  private gridChanged = false
  private image: HTMLImageElement | null = null

  constructor(options: JsonObject, host: GridHost) {
    super('WidgetSubGrid', { ...options, form: SUBGRID_FORM, about: SUBGRID_ABOUT }, true, host)
    this.host = host
    this.el.classList.add('grid-stack-item', 'grid-stack-draggable-item', 'grid-stack-sub-grid')
    const { widgetDiv, sizeDiv } = framedContent()
    this.widgetDiv = widgetDiv
    this.sizeDiv = sizeDiv
    this.el.append(widgetDiv)
    this.hideEditButton()

    const content = options.form_content
    if (isJsonObject(content) && 'rows' in content && 'columns' in content) {
      this.gridRows = content.rows
      this.gridColumns = content.columns
      this.loadGrid()
      if ('widgets' in options) this.widgetsToLoad = parseWidgets(options.widgets)
    }
    this.gridChanged = false
  }

  /**
   * Loads the stored widgets once this widget is on its grid, so it has a size the children
   * can take theirs from.
   */
  override init(): void {
    super.init()
    if (this.widgetsToLoad !== null && this.grid !== null) {
      this.host.loadWidgets(this.grid, this.widgetsToLoad)
      this.widgetsToLoad = null
      this.gridChanged = false
    }
  }

  /** (Re)creates the grid at the current size, keeping its widgets. */
  private loadGrid(): void {
    const widgets = this.grid === null ? null : this.host.getWidgets(this.grid)
    this.host.clearGrid(this.grid)
    this.gridDiv?.remove()
    this.gridDiv = fullSizeDiv()
    this.sizeDiv.append(this.gridDiv)

    // Values go to GridStack as stored, like upstream (a numeric string works there too).
    const rows = Number(this.gridRows)
    this.grid = GridStack.init(
      {
        float: true,
        disableDrag: true,
        disableResize: true,
        column: Number(this.gridColumns),
        row: rows,
        cellHeight: `${100 / rows}%`,
        alwaysShowResizeHandle: true,
        // The menu may not be moved into a sub grid.
        acceptWidgets: (el: Element) => widgetOf(el)?.type !== 'WidgetMenu'
      },
      this.gridDiv
    )
    if (widgets !== null) this.host.loadWidgets(this.grid, widgets.map(parseStored))
    this.setEdit(this.editEnabled)
    this.grid.on('dropped', (event, previous, dropped) => this.host.widgetDropped(event, previous, dropped))
    this.grid.on('change added removed', () => {
      this.gridChanged = true
    })
    this.gridChanged = false
  }

  override setEdit(enabled: boolean): void {
    super.setEdit(enabled)
    this.host.gridSetEdit(this.grid, enabled)
  }

  override getOptions(): JsonObject {
    return { form_content: this.getFormContent(), widgets: this.grid === null ? {} : storedWidgetsJson(this.host, this.grid) }
  }

  /** Fits the grid over the image as displayed (`object-fit: contain`). */
  private resize(): void {
    const image = this.image
    if (image === null) return
    const bb = image.getBoundingClientRect()
    const scale = Math.min(bb.width / image.naturalWidth, bb.height / image.naturalHeight)
    const widthDiff = `${(bb.width - image.naturalWidth * scale) * 0.5}px`
    const heightDiff = `${(bb.height - image.naturalHeight * scale) * 0.5}px`
    this.sizeDiv.style.top = heightDiff
    this.sizeDiv.style.bottom = heightDiff
    this.sizeDiv.style.left = widthDiff
    this.sizeDiv.style.right = widthDiff
  }

  override formChanged(): void {
    super.formChanged()
    const options = this.getFormContent()
    this.widgetDiv.style.borderColor = cssValue(options.borderColor)
    this.widgetDiv.style.backgroundColor = cssValue(options.backgroundColor)

    const image = options.backgroundImage
    if (isJsonArray(image) && image.length > 0) {
      if (this.image === null) {
        this.image = document.createElement('img')
        this.image.setAttribute('width', '100%')
        this.image.setAttribute('height', '100%')
        this.image.style.objectFit = 'contain'
        this.widgetDiv.append(this.image)
      }
      const first: Json | undefined = image[0]
      this.image.src = isJsonObject(first) ? cssValue(first.url) : cssValue(undefined)
      this.resize()
      // Upstream added another observer on every form change.
      new ResizeObserver(() => this.resize()).observe(this.image)
    }

    if (
      'rows' in options &&
      'columns' in options &&
      (!looselyEqual(options.rows, this.gridRows) || !looselyEqual(options.columns, this.gridColumns))
    ) {
      this.gridRows = options.rows
      this.gridColumns = options.columns
      this.loadGrid()
    }
  }

  override destroy(): void {
    this.host.clearGrid(this.grid)
    super.destroy()
  }

  /** Changed if this widget, its grid or any child changed. */
  override getChanged(): boolean {
    if (super.getChanged() || this.gridChanged) return true
    return (this.grid?.getGridItems() ?? []).some((el) => widgetOf(el)?.getChanged() === true)
  }

  override saved(): void {
    super.saved()
    this.gridChanged = false
    for (const el of this.grid?.getGridItems() ?? []) widgetOf(el)?.saved()
  }
}

/**
 * A stored value as upstream assigned it to a style property or `src` (coerced to a string; the
 * browser ignores invalid style values such as "undefined", keeping the previous one).
 */
function cssValue(value: Json | undefined): string {
  return jsString(value)
}

function storedWidgetsJson(host: GridHost, grid: GridStack): JsonObject {
  const out: Record<string, JsonObject> = {}
  host.getWidgets(grid).forEach((widget, i) => {
    out[i] = { ...widget }
  })
  return out
}
