/**
 * Sub grid widget (upstream Widgets/SubGrid.js): a nested grid of widgets with its own size,
 * border, background colour and optional background image (the grid then keeps the image's
 * aspect ratio so widgets stay over the same part of the image).
 */
import { GridStack, type GridStackOptions } from 'gridstack'
import { domString, jsString, looseEquals, nullPropertyError, prop, type JsonLike } from '../layout/json.js'
import { Widget, widgetOf } from './base.js'
import { framedContent, fullSizeDiv, type GridHost } from './grid-host.js'
import { subgridOptions, type OptionsObject } from './options.js'

export { SUBGRID_ABOUT } from './options.js'

/**
 * Grid options with the stored rows and columns passed as they are (upstream handed GridStack the
 * form values unconverted); the cell height divides 100 by the row value, as JavaScript does.
 */
function subgridGridOptions(rows: JsonLike, columns: JsonLike, accept: (el: Element) => boolean): GridStackOptions {
  const options: GridStackOptions = {
    float: true,
    disableDrag: true,
    disableResize: true,
    cellHeight: `${100 / Number(rows)}%`,
    alwaysShowResizeHandle: true,
    acceptWidgets: accept
  }
  Reflect.set(options, 'column', columns)
  Reflect.set(options, 'row', rows)
  return options
}

/**
 * The background image URL as upstream read it from the file component's value:
 * `value.length > 0` then `value[0].url` (throwing for a missing first entry), or undefined when
 * there is no image.
 */
export function backgroundImageUrl(value: JsonLike): string | undefined {
  if (value === null || value === undefined) return undefined
  if (!(Number(prop(value, 'length')) > 0)) return undefined
  const first = prop(value, '0')
  if (first === null || first === undefined) throw nullPropertyError(first, 'url')
  return jsString(prop(first, 'url'))
}

export class SubGridWidget extends Widget {
  protected override readonly host: GridHost
  private readonly widgetDiv: HTMLDivElement
  private readonly sizeDiv: HTMLDivElement
  private gridDiv: HTMLDivElement | null = null
  grid: GridStack | null = null
  private gridRows: JsonLike
  private gridColumns: JsonLike
  /** Stored widgets, loaded on `init()` (upstream `widgets_to_load`). */
  private widgetsToLoad: JsonLike = undefined
  private gridChanged = false
  private image: HTMLImageElement | null = null

  constructor(rawOptions: unknown, host: GridHost) {
    const { options, content } = subgridOptions(rawOptions)
    super('WidgetSubGrid', options, true, host)
    this.host = host
    this.el.classList.add('grid-stack-item', 'grid-stack-draggable-item', 'grid-stack-sub-grid')
    const { widgetDiv, sizeDiv } = framedContent()
    this.widgetDiv = widgetDiv
    this.sizeDiv = sizeDiv
    this.el.append(widgetDiv)
    this.hideEditButton()

    if (content !== null) {
      this.gridRows = content.rows
      this.gridColumns = content.columns
      this.loadGrid()
      this.widgetsToLoad = content.widgets
    }
    this.gridChanged = false
  }

  /**
   * Loads the stored widgets once this widget is on its grid, so it has a size the children
   * can take theirs from.
   */
  override init(): void {
    super.init()
    if (this.widgetsToLoad !== null && this.widgetsToLoad !== undefined && this.grid !== null) {
      this.host.loadWidgets(this.grid, this.widgetsToLoad)
      this.widgetsToLoad = undefined
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

    this.grid = GridStack.init(
      // The menu may not be moved into a sub grid.
      subgridGridOptions(this.gridRows, this.gridColumns, (el: Element) => widgetOf(el)?.type !== 'WidgetMenu'),
      this.gridDiv
    )
    if (widgets !== null) this.host.loadWidgets(this.grid, widgets)
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

  override getOptions(): OptionsObject {
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
    this.widgetDiv.style.borderColor = domString(options.borderColor)
    this.widgetDiv.style.backgroundColor = domString(options.backgroundColor)

    const url = 'backgroundImage' in options ? backgroundImageUrl(options.backgroundImage) : undefined
    if (url !== undefined) {
      if (this.image === null) {
        this.image = document.createElement('img')
        this.image.setAttribute('width', '100%')
        this.image.setAttribute('height', '100%')
        this.image.style.objectFit = 'contain'
        this.widgetDiv.append(this.image)
      }
      this.image.src = url
      this.resize()
      // Upstream added another observer on every form change.
      new ResizeObserver(() => this.resize()).observe(this.image)
    }

    if (
      'rows' in options &&
      'columns' in options &&
      (!looseEquals(options.rows, this.gridRows) || !looseEquals(options.columns, this.gridColumns))
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

function storedWidgetsJson(host: GridHost, grid: GridStack): OptionsObject {
  const out: Record<string, OptionsObject> = {}
  host.getWidgets(grid).forEach((widget, i) => {
    out[i] = { ...widget }
  })
  return out
}
