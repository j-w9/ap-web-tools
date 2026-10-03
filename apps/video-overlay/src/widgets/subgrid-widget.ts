/**
 * Sub grid widget: a nested grid with a border, background colour and optional background image,
 * ported from upstream `TelemetryDashboard/Widgets/SubGrid.js` with the VideoOverlay subclass
 * (`VideoOverlay/Widgets/SubGrid.js`) folded in.
 *
 * Candidate to share with telemetry-dashboard.
 */
import { GridStack } from 'gridstack'
import { isJsonObject, jsString, type JsonObject, type JsonValue } from './json.js'
import type { WidgetOptions } from './layout-file.js'
import { gridWidgets, INERT_ENVIRONMENT, OverlayWidget, savedWidgets, type RenderItem, type WidgetEnvironment } from './widget.js'
import { widgetRecord } from './layout-file.js'

/** The fixed options form of every sub grid (upstream `options.form`). */
export const SUBGRID_FORM: JsonObject = {
  components: [
    {
      label: 'Rows',
      tooltip: 'Number of rows in this subgrid.',
      applyMaskOn: 'change',
      mask: false,
      tableView: false,
      delimiter: false,
      requireDecimal: false,
      inputFormat: 'plain',
      truncateMultipleSpaces: false,
      validate: { min: 1, max: 12 },
      validateWhenHidden: false,
      key: 'rows',
      type: 'number',
      input: true,
      defaultValue: 2,
      decimalLimit: 0
    },
    {
      label: 'Columns',
      tooltip: 'Number of columns in this subgrid.',
      applyMaskOn: 'change',
      mask: false,
      tableView: false,
      delimiter: false,
      requireDecimal: false,
      inputFormat: 'plain',
      truncateMultipleSpaces: false,
      validate: { min: 1, max: 12 },
      validateWhenHidden: false,
      key: 'columns',
      type: 'number',
      input: true,
      defaultValue: 2,
      decimalLimit: 0
    },
    colorComponent('Border color', 'borderColor', '#c8c8c8', 'ebao4j', ''),
    colorComponent('Background color', 'backgroundColor', '#ffffff', 'e6byhel', ''),
    {
      label: 'Background image',
      tooltip:
        'The sub grid will take on the aspect ratio of the image so sub grid widgets hold position relative to the image as the dashboard is re-sized.',
      storage: 'base64',
      key: 'backgroundImage',
      type: 'file',
      input: true
    }
  ]
}

/** Upstream's colour component definitions, which differ only in label, key, default and id. */
function colorComponent(label: string, key: string, defaultValue: string, id: string, tooltip: string): JsonObject {
  return {
    label,
    key,
    type: 'color',
    input: true,
    tableView: false,
    widget: { type: 'input' },
    inputType: 'color',
    mask: false,
    data: '#000000',
    defaultValue,
    id,
    placeholder: '',
    prefix: '',
    customClass: '',
    suffix: '',
    multiple: false,
    protected: false,
    unique: false,
    persistent: true,
    hidden: false,
    clearOnHide: true,
    refreshOn: '',
    redrawOn: '',
    modalEdit: false,
    dataGridLabel: false,
    labelPosition: 'top',
    description: '',
    errorLabel: '',
    tooltip,
    hideLabel: false,
    tabindex: '',
    disabled: false,
    autofocus: false,
    dbIndex: false,
    customDefaultValue: '',
    calculateValue: '',
    calculateServer: false,
    attributes: {},
    validateOn: 'change',
    validate: { required: false, custom: '', customPrivate: false, strictDateValidation: false, multiple: false, unique: false },
    conditional: { show: null, when: null, eq: '' },
    overlay: { style: '', left: '', top: '', width: '', height: '' },
    allowCalculateOverride: false,
    encrypted: false,
    showCharCount: false,
    showWordCount: false,
    properties: {},
    allowMultipleMasks: false,
    addons: []
  }
}

const SUBGRID_ABOUT: JsonObject = { name: 'Subgrid', info: 'Nestable sub grid widget' }

function cssColor(value: JsonValue | undefined): string {
  return typeof value === 'string' ? value : ''
}

/** First uploaded image's data URL, if the background image field holds one. */
function backgroundImageUrl(value: JsonValue | undefined): string | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined
  const first = value[0]
  const url = isJsonObject(first) ? first['url'] : undefined
  return typeof url === 'string' ? url : jsString(url)
}

/** Upstream `WidgetSubGridVideoOverlay`. */
export class SubGridWidget extends OverlayWidget {
  readonly widgetType = 'WidgetSubGridVideoOverlay'

  grid: GridStack | undefined
  private gridRows: JsonValue | undefined
  private gridColumns: JsonValue | undefined
  private gridDiv: HTMLDivElement | undefined
  private image: HTMLImageElement | undefined
  private widgetsToLoad: JsonValue | undefined
  private gridChanged = false
  private readonly widgetDiv: HTMLDivElement
  private readonly sizeDiv: HTMLDivElement

  constructor(env: WidgetEnvironment = INERT_ENVIRONMENT, options: JsonObject = {}) {
    super(env, { ...options, form: SUBGRID_FORM, about: SUBGRID_ABOUT }, true, 'Subgrid')

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
    const content = options['form_content']
    if (!this.isClone && isJsonObject(content) && 'rows' in content && 'columns' in content) {
      this.gridRows = content['rows']
      this.gridColumns = content['columns']
      this.loadGrid()
      if ('widgets' in options) this.widgetsToLoad = options['widgets']
    }
    this.gridChanged = false
  }

  override init(): void {
    super.init()
    // Widgets load once this widget is on its grid, so they inherit a real size.
    if (this.widgetsToLoad !== undefined && this.grid !== undefined) {
      this.env.loadWidgets(this.grid, this.widgetsToLoad)
      this.widgetsToLoad = undefined
      this.gridChanged = false
    }
  }

  /** (Re)build the inner grid at the current size, keeping its widgets. */
  private loadGrid(): void {
    const widgets = this.grid === undefined ? undefined : widgetRecord(savedWidgets(this.grid))
    this.env.clearGrid(this.grid)
    this.gridDiv?.remove()

    const gridDiv = document.createElement('div')
    gridDiv.style.border = 'none'
    gridDiv.style.width = '100%'
    gridDiv.style.height = '100%'
    gridDiv.style.overflow = 'hidden'
    this.sizeDiv.appendChild(gridDiv)
    this.gridDiv = gridDiv

    const rows = Number(this.gridRows)
    const grid = GridStack.init(
      {
        float: true,
        disableDrag: true,
        disableResize: true,
        column: Number(this.gridColumns),
        row: rows,
        cellHeight: `${100 / rows}%`,
        alwaysShowResizeHandle: true,
        // Upstream refuses only TelemetryDashboard's menu widget, which VideoOverlay does not have.
        acceptWidgets: true
      },
      gridDiv
    )
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

  override getOptions(): WidgetOptions {
    return {
      form_content: this.getFormContent(),
      widgets: this.grid === undefined ? undefined : widgetRecord(savedWidgets(this.grid))
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
    this.widgetDiv.style.borderColor = cssColor(options['borderColor'])
    this.widgetDiv.style.backgroundColor = cssColor(options['backgroundColor'])

    const url = backgroundImageUrl(options['backgroundImage'])
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
      (options['rows'] != this.gridRows || options['columns'] != this.gridColumns)
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
