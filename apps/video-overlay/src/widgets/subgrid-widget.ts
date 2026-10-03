/**
 * Sub grid widget: a nested grid with a border, background colour and optional background image,
 * ported from upstream `TelemetryDashboard/Widgets/SubGrid.js` with the VideoOverlay subclass
 * (`VideoOverlay/Widgets/SubGrid.js`) folded in.
 *
 * Candidate to share with telemetry-dashboard.
 */
import { GridStack, type GridStackOptions } from 'gridstack'
import { anyString, domString, looseEquals, nullPropertyError, prop, type JsonLike, type OptionsObject } from './json.js'
import { subgridOptions } from './options.js'

export { SUBGRID_FORM } from './options.js'
import { gridWidgets, INERT_ENVIRONMENT, OverlayWidget, savedWidgets, type RenderItem, type WidgetEnvironment } from './widget.js'

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
  return anyString(prop(first, 'url'))
}

/**
 * Grid options with the stored rows and columns passed as they are (upstream handed GridStack the
 * form values unconverted); the cell height divides 100 by the row value, as JavaScript does.
 */
function subgridGridOptions(rows: JsonLike, columns: JsonLike): GridStackOptions {
  const options: GridStackOptions = {
    float: true,
    disableDrag: true,
    disableResize: true,
    cellHeight: `${100 / Number(rows)}%`,
    alwaysShowResizeHandle: true,
    // Upstream's function refused only TelemetryDashboard's menu widget, which VideoOverlay does
    // not have; as a function it accepts any element (`true` would require .grid-stack-item).
    acceptWidgets: () => true
  }
  Reflect.set(options, 'column', columns)
  Reflect.set(options, 'row', rows)
  return options
}

/** Upstream `WidgetSubGridVideoOverlay`. */
export class SubGridWidget extends OverlayWidget {
  readonly widgetType = 'WidgetSubGridVideoOverlay'

  grid: GridStack | undefined
  private gridRows: JsonLike
  private gridColumns: JsonLike
  private gridDiv: HTMLDivElement | undefined
  private image: HTMLImageElement | undefined
  /** Stored widgets, loaded on `init()` unless null or undefined (upstream `widgets_to_load`). */
  private widgetsToLoad: JsonLike = null
  private gridChanged = false
  private readonly widgetDiv: HTMLDivElement
  private readonly sizeDiv: HTMLDivElement

  constructor(env: WidgetEnvironment = INERT_ENVIRONMENT, rawOptions: unknown = {}) {
    const { options, content } = subgridOptions(rawOptions)
    super(env, options, true, 'WidgetSubGridVideoOverlay')

    this.classList.add('grid-stack-item', 'grid-stack-draggable-item', 'grid-stack-sub-grid')

    this.widgetDiv = document.createElement('div')
    this.widgetDiv.style.border = '5px solid'
    this.widgetDiv.style.borderRadius = '10px'
    this.widgetDiv.style.borderColor = '#c8c8c8'
    this.widgetDiv.style.padding = '5px'
    this.widgetDiv.style.flex = '1'
    this.widgetDiv.style.overflow = 'hidden'
    this.widgetDiv.classList.add('grid-stack-item-content')
    if (!this.isClone) this.appendChild(this.widgetDiv)

    this.sizeDiv = document.createElement('div')
    this.sizeDiv.style.position = 'absolute'
    this.sizeDiv.style.inset = '0'
    this.widgetDiv.appendChild(this.sizeDiv)

    // No script to edit.
    this.buttons.Edit.style.display = 'none'

    // Build the grid now if the saved options give its size; widgets follow in init().
    if (!this.isClone && content !== null) {
      this.gridRows = content.rows
      this.gridColumns = content.columns
      this.loadGrid()
      this.widgetsToLoad = content.widgets
    }
    this.gridChanged = false
  }

  override init(): void {
    super.init()
    // Widgets load once this widget is on its grid, so they inherit a real size.
    if (this.widgetsToLoad !== null && this.widgetsToLoad !== undefined && this.grid !== undefined) {
      this.env.loadWidgets(this.grid, this.widgetsToLoad)
      this.widgetsToLoad = null
      this.gridChanged = false
    }
  }

  /** (Re)build the inner grid at the current size, keeping its widgets. */
  private loadGrid(): void {
    const widgets = this.grid === undefined ? undefined : storedWidgets(this.grid)
    this.env.clearGrid(this.grid)
    this.gridDiv?.remove()

    const gridDiv = document.createElement('div')
    gridDiv.style.border = 'none'
    gridDiv.style.width = '100%'
    gridDiv.style.height = '100%'
    gridDiv.style.overflow = 'hidden'
    this.sizeDiv.appendChild(gridDiv)
    this.gridDiv = gridDiv

    const grid = GridStack.init(subgridGridOptions(this.gridRows, this.gridColumns), gridDiv)
    this.grid = grid
    if (widgets !== undefined) this.env.loadWidgets(grid, widgets)
    this.setEdit(this.editEnabled)
    grid.on('dropped', this.env.widgetDropped)
    grid.on('change added removed', () => {
      this.gridChanged = true
    })
    this.gridChanged = false
  }

  override setEdit(enabled: boolean): void {
    super.setEdit(enabled)
    this.env.gridSetEdit(this.grid, enabled)
  }

  override getOptions(): OptionsObject {
    return {
      form_content: this.getFormContent(),
      widgets: this.grid === undefined ? undefined : storedWidgets(this.grid)
    }
  }

  /** Fit the inner grid to the background image so widgets keep their place on it. */
  private resize(): void {
    const image = this.image
    if (image === undefined) return
    const box = image.getBoundingClientRect()
    const scale = Math.min(box.width / image.naturalWidth, box.height / image.naturalHeight)
    const widthDiff = `${(box.width - image.naturalWidth * scale) * 0.5}px`
    const heightDiff = `${(box.height - image.naturalHeight * scale) * 0.5}px`
    this.sizeDiv.style.top = heightDiff
    this.sizeDiv.style.bottom = heightDiff
    this.sizeDiv.style.left = widthDiff
    this.sizeDiv.style.right = widthDiff
  }

  protected override formChanged(): void {
    super.formChanged()
    const options = this.getFormContent()
    this.widgetDiv.style.borderColor = domString(options['borderColor'])
    this.widgetDiv.style.backgroundColor = domString(options['backgroundColor'])

    const url = 'backgroundImage' in options ? backgroundImageUrl(options['backgroundImage']) : undefined
    if (url !== undefined) {
      if (this.image === undefined) {
        const image = document.createElement('img')
        image.setAttribute('width', '100%')
        image.setAttribute('height', '100%')
        image.style.objectFit = 'contain'
        this.widgetDiv.appendChild(image)
        this.image = image
      }
      this.image.src = url
      this.resize()
      new ResizeObserver(() => this.resize()).observe(this.image)
    }

    if (
      'rows' in options &&
      'columns' in options &&
      (!looseEquals(options['rows'], this.gridRows) || !looseEquals(options['columns'], this.gridColumns))
    ) {
      this.gridRows = options['rows']
      this.gridColumns = options['columns']
      this.loadGrid()
    }
  }

  override destroy(): void {
    this.env.clearGrid(this.grid)
    super.destroy()
  }

  override getChanged(): boolean {
    if (super.getChanged() || this.gridChanged) return true
    return this.grid !== undefined && gridWidgets(this.grid).some((w) => w.getChanged())
  }

  override saved(): void {
    super.saved()
    this.gridChanged = false
    if (this.grid === undefined) return
    for (const widget of gridWidgets(this.grid)) widget.saved()
  }

  editLanguage(): undefined {
    return undefined
  }

  editText(): string {
    return ''
  }

  setEditedText(): void {}

  override getContentForRender(parent: DOMRect): RenderItem[] {
    const box = this.widgetDiv.getBoundingClientRect()
    const items: RenderItem[] = [
      { pos: { x: box.x - parent.x, y: box.y - parent.y, height: box.height, width: box.width }, content: this.widgetDiv }
    ]
    if (this.grid === undefined) return items
    for (const widget of gridWidgets(this.grid)) items.push(...widget.getContentForRender(parent))
    return items
  }

  loadLog(): void {
    if (this.grid === undefined) return
    for (const widget of gridWidgets(this.grid)) widget.loadLog()
  }

  setTime(time: number): Promise<unknown> {
    if (this.grid === undefined) return Promise.resolve()
    return Promise.allSettled(gridWidgets(this.grid).map((w) => w.setTime(time)))
  }
}

export const SUBGRID_TAG = 'vo-widget-subgrid'
if (!customElements.get(SUBGRID_TAG)) customElements.define(SUBGRID_TAG, SubGridWidget)

/** Widgets keyed by index, as upstream `get_widgets` returned them. */
function storedWidgets(grid: GridStack): OptionsObject {
  const out: Record<string, OptionsObject> = {}
  savedWidgets(grid).forEach((widget, i) => {
    out[String(i)] = { ...widget }
  })
  return out
}
