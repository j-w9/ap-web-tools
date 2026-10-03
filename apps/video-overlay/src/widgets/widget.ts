/**
 * Overlay widget base: a gridstack item with an options form (Formio) in a popover, ported from
 * upstream `TelemetryDashboard/Widgets/Base_Class.js` as VideoOverlay uses it.
 *
 * Candidate to share with telemetry-dashboard: the class depends only on {@link WidgetEnvironment},
 * not on VideoOverlay's page.
 */
import tippy, { type Instance as TippyInstance } from 'tippy.js'
import type { GridItemHTMLElement, GridStack, GridStackDroppedHandler } from 'gridstack'
import { Formio, type FormioStatic } from './formio-setup.js'
import { domString, looseEquals, type JsonLike, type JsonObject, type OptionsObject } from './json.js'
import type { SavedWidget, WidgetType } from './layout-file.js'
import { readBaseOptions } from './options.js'

type FormioForm = Awaited<ReturnType<FormioStatic['createForm']>>

/** Where a widget's visible content sits, relative to the overlay, for export (`getContentForRender`). */
export interface RenderItem {
  readonly pos: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  readonly content: HTMLElement
}

/** In-page replacements for `alert()` and `confirm()`. */
export interface Dialogs {
  alert(text: string): void
  confirm(text: string): Promise<boolean>
}

/** The page services a widget calls (upstream globals of `VideoOverlay.js` and `WidgetEdit.js`). */
export interface WidgetEnvironment {
  readonly dialogs: Dialogs
  /** The loaded log's bytes, or null before a log is loaded. */
  logBuffer(): ArrayBuffer | null
  /** Add a widget to a grid if it fits (upstream `add_widget`), from a stored or copied widget object. */
  addWidget(grid: GridStack, saved: unknown): OverlayWidget | undefined
  /** Load saved widgets onto a grid (upstream `load_widgets`). */
  loadWidgets(grid: GridStack, widgets: unknown): void
  /** Destroy a grid and its widgets (upstream `clear_grid`). */
  clearGrid(grid: GridStack | undefined): void
  /** Enable or disable editing of a grid and its widgets (upstream `grid_set_edit`). */
  gridSetEdit(grid: GridStack | undefined, enabled: boolean): void
  /** Handler for widgets dropped onto a grid (upstream `widget_dropped`). */
  readonly widgetDropped: GridStackDroppedHandler
  /** Open the script and form editor (upstream `load_editor`). */
  editWidget(widget: OverlayWidget): void
  /** Download a single widget (upstream `save_widget`). */
  saveWidget(widget: OverlayWidget): void
}

/** The widgets on a grid (upstream `grid.getGridItems()`, which only ever holds widgets). */
export function gridWidgets(grid: GridStack): OverlayWidget[] {
  return grid.getGridItems().filter((el): el is OverlayWidget => el instanceof OverlayWidget)
}

/** Saved form of a widget (upstream `get_widget_object`). */
export function savedWidget(widget: OverlayWidget): SavedWidget {
  return {
    x: widget.getAttribute('gs-x'),
    y: widget.getAttribute('gs-y'),
    w: widget.getAttribute('gs-w'),
    h: widget.getAttribute('gs-h'),
    type: widget.widgetType,
    options: widget.getOptions()
  }
}

/** Widgets of a grid keyed by index (upstream `get_widgets`). */
export function savedWidgets(grid: GridStack): SavedWidget[] {
  return gridWidgets(grid).map(savedWidget)
}

/**
 * Upstream compared the edited text with `!=` against the stored value, which may not be a string.
 */
export function editedTextChanged(stored: JsonLike, text: string): boolean {
  return !looseEquals(stored, text)
}

const ICONS = {
  Edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z',
  Save: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  Copy: 'M8 8h12v12H8zM4 16V4h12',
  Delete: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
  Close: 'M18 6 6 18M6 6l12 12'
} as const
type TipButton = keyof typeof ICONS

function tipButton(name: TipButton): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'vo-tip__button'
  button.title = name
  button.setAttribute('aria-label', name)
  button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${ICONS[name]}"/></svg>`
  return button
}

/**
 * Environment of widgets the browser constructs itself, without arguments: html2canvas clones the
 * page to capture it, and cloning a custom element runs its constructor. Such clones stay inert.
 */
export const INERT_ENVIRONMENT: WidgetEnvironment = {
  dialogs: { alert: () => undefined, confirm: () => Promise.resolve(false) },
  logBuffer: () => null,
  addWidget: () => undefined,
  loadWidgets: () => undefined,
  clearGrid: () => undefined,
  gridSetEdit: () => undefined,
  widgetDropped: () => undefined,
  editWidget: () => undefined,
  saveWidget: () => undefined
}

const DELETE_CONFIRM = 'This widget has not been downloaded!\n Click OK to delete anyway.'

/**
 * Base of all overlay widgets. Subclasses provide the content (sandbox iframe, custom HTML iframe
 * or sub grid) and the VideoOverlay hooks: `loadLog`, `setTime` and `getContentForRender`.
 */
export abstract class OverlayWidget extends HTMLElement {
  /** Class name stored in layouts (upstream used `constructor.name`, which minification breaks). */
  abstract readonly widgetType: WidgetType

  /** `options.about` as stored (saved back unchanged), or `{ name: <class name> }`. */
  readonly about: JsonLike
  protected editEnabled = false
  /** Unsaved changes, used to warn before leaving the page and before deleting. */
  protected changed = false
  protected form: FormioForm | undefined
  private lastContent = ''

  /** Constructed by the browser (a clone), not by the page: no content, form or behaviour. */
  protected readonly isClone: boolean
  protected readonly tipDiv: HTMLDivElement
  private readonly formDiv: HTMLDivElement
  protected readonly buttons: Readonly<Record<TipButton, HTMLButtonElement>>
  readonly editTip: TippyInstance

  protected constructor(
    protected readonly env: WidgetEnvironment,
    options: OptionsObject,
    editable: boolean,
    className: string
  ) {
    super()
    this.isClone = env === INERT_ENVIRONMENT
    const { about, name: aboutName, formDefinition, formContent } = readBaseOptions(options, className)
    this.about = about

    this.style.display = 'flex'

    // Popup shown on double click when editing is enabled.
    this.tipDiv = document.createElement('div')
    this.tipDiv.className = 'vo-tip vo-bs'
    const head = document.createElement('div')
    head.className = 'vo-tip__head'
    const name = document.createElement('span')
    name.className = 'vo-tip__name'
    // As upstream: the stored name is HTML (a layout's sandbox widgets run their own scripts on
    // this origin anyway, so this adds no capability).
    name.innerHTML = domString(aboutName)
    head.appendChild(name)
    this.buttons = {
      Edit: tipButton('Edit'),
      Save: tipButton('Save'),
      Copy: tipButton('Copy'),
      Delete: tipButton('Delete'),
      Close: tipButton('Close')
    }
    for (const button of Object.values(this.buttons)) head.appendChild(button)
    this.formDiv = document.createElement('div')
    this.formDiv.className = 'vo-tip__form'
    this.tipDiv.append(head, this.formDiv)

    this.buttons.Copy.onclick = () => {
      const grid = this.gridstackGrid()
      if (grid === undefined) return
      const copy = env.addWidget(grid, savedWidget(this))
      copy?.init()
    }
    this.buttons.Delete.onclick = () => {
      void (async () => {
        if (this.changed && !(await env.dialogs.confirm(DELETE_CONFIRM))) return
        const grid = this.gridstackGrid()
        this.destroy()
        grid?.removeWidget(this)
      })()
    }
    this.buttons.Close.onclick = () => this.editTip.hide()
    if (editable) {
      this.buttons.Edit.onclick = () => {
        this.editTip.hide()
        env.editWidget(this)
      }
      this.buttons.Save.onclick = () => {
        this.editTip.hide()
        env.saveWidget(this)
        this.saved()
      }
    } else {
      this.buttons.Edit.style.display = 'none'
      this.buttons.Save.style.display = 'none'
    }

    if (!this.isClone) this.createForm(formDefinition, formContent)

    this.editTip = tippy(this, {
      content: this.tipDiv,
      interactive: true,
      trigger: 'manual',
      maxWidth: '500px',
      appendTo: () => document.body,
      popperOptions: {
        strategy: 'fixed',
        modifiers: [
          { name: 'flip', options: { fallbackPlacements: ['bottom', 'right'] } },
          { name: 'preventOverflow', options: { altAxis: true, tether: false } }
        ]
      }
    })

    this.ondblclick = (e) => {
      if (this.editEnabled) this.editTip.show()
      // Don't propagate, so a parent sub grid does not open its popup too.
      e.stopPropagation()
    }
  }

  /** Create the options form and start tracking its changes. */
  /** Formio receives the stored definition and content as they are (a string definition is a form URL). */
  private createForm(formDefinition: JsonLike, formContent: JsonLike): void {
    void Formio.createForm(this.formDiv, formDefinition).then(async (form) => {
      this.form = form
      await form.setForm(formDefinition)
      this.checkFormHide()
      await form.setSubmission({ data: formContent })
      // Initial callback for the first load, then start tracking changes.
      this.formChanged()
      this.changed = false
      this.lastContent = JSON.stringify(form.submission.data)
      form.on('change', (e) => {
        if (e.changed == null) return
        if (!form.checkValidity(form.submission.data)) return
        const json = JSON.stringify(form.submission.data)
        if (this.lastContent === json) return
        this.lastContent = json
        this.formChanged()
      })
    })
  }

  /** The grid this widget is on. */
  protected gridstackGrid(): GridStack | undefined {
    return (this as GridItemHTMLElement).gridstackNode?.grid
  }

  /** Enable or disable editing (dragging, popup). */
  setEdit(enabled: boolean): void {
    this.editEnabled = enabled
    this.style.cursor = enabled ? 'move' : 'auto'
  }

  /** Language of the editable text, for the code editor. */
  abstract editLanguage(): 'javascript' | 'html' | undefined
  /** Text edited in the code editor (script or HTML). */
  abstract editText(): string
  /** Apply text edited in the code editor. */
  abstract setEditedText(text: string): void

  /** Hide the popup buttons that make no sense in the editor's test grid. */
  disableButtonsForEdit(): void {
    this.buttons.Delete.style.display = 'none'
    this.buttons.Copy.style.display = 'none'
    this.buttons.Save.style.display = 'none'
    this.buttons.Edit.style.display = 'none'
  }

  /** Clean up before removal. */
  destroy(): void {
    this.editTip.destroy()
  }

  /** Hide the form area when the form has no components. */
  private checkFormHide(): void {
    const content = this.form?.form ?? {}
    const components = content['components']
    const hasContent = Object.values(content).length > 0 && Array.isArray(components) && components.length > 0
    this.formDiv.style.display = hasContent ? 'block' : 'none'
  }

  /** Replace the form definition (from the form builder). */
  setFormDefinition(definition: JsonObject): void {
    const form = this.form
    if (form === undefined) return
    if (JSON.stringify(form.form) !== JSON.stringify(definition)) this.changed = true
    void form.setForm(definition)
    this.checkFormHide()
  }

  getFormDefinition(): JsonObject | undefined {
    return this.form?.form
  }

  /** Options to save (upstream `get_options`; `form` is undefined, so not saved, until the form loads). */
  getOptions(): OptionsObject {
    return { form: this.getFormDefinition(), form_content: this.getFormContent(), about: this.about }
  }

  /** The user's form input changed. */
  protected formChanged(): void {
    this.changed = true
  }

  /** The user's form input. */
  getFormContent(): JsonObject {
    return this.form?.submission.data ?? {}
  }

  /** Called once the widget is on its grid. */
  init(): void {}

  getChanged(): boolean {
    return this.changed
  }

  saved(): void {
    this.changed = false
  }

  /** Hand the loaded log to the widget. */
  abstract loadLog(): void
  /** Show the given log time (seconds since boot); resolves once rendered. */
  abstract setTime(time: number): Promise<unknown>
  /** What to capture for export, relative to `parent`. */
  abstract getContentForRender(parent: DOMRect): RenderItem[]
}
