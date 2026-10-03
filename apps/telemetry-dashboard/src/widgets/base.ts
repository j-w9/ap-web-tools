/**
 * Widget base (upstream `WidgetBase` in Widgets/Base_Class.js): a grid item with an options form
 * (Formio) shown in a popup on double click while editing is enabled, plus copy, delete, edit and
 * save buttons, and change tracking for the "unsaved changes" prompt.
 */
import type { GridItemHTMLElement, GridStack } from 'gridstack'
import tippy, { type Instance, type Props } from 'tippy.js'
import type { FormDefinition, Webform } from 'formiojs/dist/formio.full.min.js'
import { Formio } from '../forms/formio-setup.js'
import { domString, looseEquals, type JsonLike, type JsonObject } from '../layout/json.js'
import type { StoredWidget, WidgetType } from '../layout/layout.js'
import { confirmMessage } from '../ui/dialogs.js'
import { readBaseOptions, type OptionsObject } from './options.js'

/** What widgets need from the dashboard (upstream globals). */
export interface WidgetHost {
  /** Upstream `add_widget(target_grid, obj)` with a stored (or copied) widget object. */
  addWidget(grid: GridStack, obj: unknown): Widget | undefined
  getWidgetObject(widget: Widget): StoredWidget
  loadEditor(widget: Widget): void
  saveWidget(widget: Widget): void
}

const widgetsByElement = new WeakMap<Element, Widget>()

/** The widget whose grid item is `el`. */
export function widgetOf(el: Element): Widget | undefined {
  return widgetsByElement.get(el)
}

/** Shared popup settings (upstream passed the same `popperOptions` to every interactive tip). */
export const INTERACTIVE_TIP: Partial<Props> = {
  interactive: true,
  trigger: 'manual',
  appendTo: () => document.body,
  popperOptions: {
    strategy: 'fixed',
    modifiers: [
      { name: 'flip', options: { fallbackPlacements: ['bottom', 'right'] } },
      { name: 'preventOverflow', options: { altAxis: true, tether: false } }
    ]
  }
}

function iconButton(icon: string, label: string): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'td-icon-button'
  button.title = label
  button.setAttribute('aria-label', label)
  const i = document.createElement('i')
  i.className = `fa-solid ${icon}`
  button.append(i)
  return button
}

/** Buttons in the widget popup. */
interface TipButtons {
  readonly edit: HTMLButtonElement
  readonly save: HTMLButtonElement
  readonly copy: HTMLButtonElement
  readonly delete: HTMLButtonElement
  readonly close: HTMLButtonElement
}

export abstract class Widget {
  readonly type: WidgetType
  readonly el: GridItemHTMLElement
  protected readonly host: WidgetHost
  /** `options.about` as stored (saved back unchanged), or `{ name: <type> }`. */
  readonly about: JsonLike
  editEnabled = false
  /** Unsaved changes, used to prompt the user before leaving the page. */
  changed = false
  form: Webform | null = null
  private lastContent = ''
  /** The popup's content element. */
  readonly tipContent: HTMLDivElement
  private readonly formDiv: HTMLDivElement
  private readonly buttons: TipButtons
  readonly editTip: Instance

  constructor(type: WidgetType, options: OptionsObject, editable: boolean, host: WidgetHost) {
    this.type = type
    this.host = host
    const { about, name: aboutName, formDefinition, formContent } = readBaseOptions(options, type)
    this.el = document.createElement('div')
    widgetsByElement.set(this.el, this)
    this.about = about

    this.el.style.display = 'flex'

    // Popup shown on double click when editing is enabled.
    this.tipContent = document.createElement('div')
    this.tipContent.className = 'td-tip td-widget-tip'
    const head = document.createElement('div')
    head.className = 'td-tip__head'
    const name = document.createElement('span')
    name.className = 'td-tip__title'
    // As upstream: the stored name is HTML (a layout's sandbox widgets run their own scripts on
    // this origin anyway, so this adds no capability).
    name.innerHTML = domString(aboutName)
    this.buttons = {
      edit: iconButton('fa-pen-to-square', 'Edit widget'),
      save: iconButton('fa-download', 'Download widget'),
      copy: iconButton('fa-copy', 'Copy widget'),
      delete: iconButton('fa-trash', 'Delete widget'),
      close: iconButton('fa-xmark', 'Close')
    }
    const actions = document.createElement('div')
    actions.className = 'td-tip__actions'
    actions.append(this.buttons.edit, this.buttons.save, this.buttons.copy, this.buttons.delete, this.buttons.close)
    head.append(name, actions)
    this.formDiv = document.createElement('div')
    this.formDiv.className = 'td-form'
    this.tipContent.append(head, this.formDiv)

    this.buttons.copy.onclick = () => {
      const grid = this.el.gridstackNode?.grid
      if (grid === undefined) return
      const copy = this.host.addWidget(grid, this.host.getWidgetObject(this))
      copy?.init()
    }
    this.buttons.delete.onclick = () => void this.deleteClicked()
    this.buttons.close.onclick = () => this.editTip.hide()
    if (editable) {
      this.buttons.edit.onclick = () => {
        this.editTip.hide()
        this.host.loadEditor(this)
      }
      this.buttons.save.onclick = () => {
        this.editTip.hide()
        this.host.saveWidget(this)
        this.saved()
      }
    } else {
      this.buttons.edit.style.display = 'none'
      this.buttons.save.style.display = 'none'
    }

    void this.createForm(formDefinition, formContent)

    this.editTip = tippy(this.el, { ...INTERACTIVE_TIP, content: this.tipContent, maxWidth: '500px' })

    this.el.ondblclick = (event) => {
      if (this.editEnabled) this.editTip.show()
      // Stops a sub grid's own handlers seeing the double click.
      event.stopPropagation()
    }
  }

  private async deleteClicked(): Promise<void> {
    if (this.changed && !(await confirmMessage('This widget has not been downloaded!\n Click OK to delete anyway.'))) return
    this.destroy()
    this.el.gridstackNode?.grid?.removeWidget(this.el)
  }

  /** Formio receives the stored definition and content as they are (a string definition is a form URL). */
  private async createForm(definition: JsonLike, content: JsonLike): Promise<void> {
    const form = await Formio.createForm(this.formDiv, definition)
    this.form = form
    await form.setForm(definition)
    this.checkFormHide()
    await form.setSubmission({ data: content })
    // Initial callback for the first load, which does not count as a change.
    this.formChanged()
    this.changed = false
    this.lastContent = JSON.stringify(form.submission.data)
    form.on('change', (event) => {
      if (event.changed === undefined || event.changed === null) return
      if (!form.checkValidity(form.submission.data)) return
      const json = JSON.stringify(form.submission.data)
      if (this.lastContent === json) return
      this.lastContent = json
      this.formChanged()
    })
  }

  /** Enables or disables editing; shows the move cursor while enabled. */
  setEdit(enabled: boolean): void {
    this.editEnabled = enabled
    this.el.style.cursor = enabled ? 'move' : 'auto'
  }

  /** Language of the text the editor edits; only editable widgets have one. */
  getEditLanguage(): 'javascript' | 'html' | undefined {
    return undefined
  }

  /** Text the editor edits. */
  getEditText(): string | undefined {
    return undefined
  }

  /** Text from the editor. */
  setEditedText(_text: string): void {
    // Only widgets with editable text override this.
  }

  /** Hides the buttons that must not work on the editor's test copy. */
  disableButtonsForEdit(): void {
    this.buttons.delete.style.display = 'none'
    this.buttons.copy.style.display = 'none'
    this.buttons.save.style.display = 'none'
    this.buttons.edit.style.display = 'none'
  }

  /** Hides the edit button only (sub grid). */
  protected hideEditButton(): void {
    this.buttons.edit.style.display = 'none'
  }

  destroy(): void {
    this.editTip.destroy()
  }

  /** Hides the form area when the form has no components. */
  private checkFormHide(): void {
    const content = this.form?.form ?? {}
    const components = content.components
    const haveContent = Object.values(content).length !== 0 && Array.isArray(components) && components.length !== 0
    this.formDiv.style.display = haveContent ? 'block' : 'none'
  }

  setFormDefinition(definition: FormDefinition): void {
    if (this.form === null) return
    if (JSON.stringify(this.form.form) !== JSON.stringify(definition)) this.changed = true
    void this.form.setForm(definition)
    this.checkFormHide()
  }

  getFormDefinition(): FormDefinition | undefined {
    return this.form?.form
  }

  /** Options saved with the widget (`form` is undefined, so not saved, until the form has loaded). */
  getOptions(): OptionsObject {
    return { form: this.getFormDefinition(), form_content: this.getFormContent(), about: this.about }
  }

  /** Form changed by the user (or loaded). */
  formChanged(): void {
    this.changed = true
  }

  getFormContent(): JsonObject {
    return this.form?.submission.data ?? {}
  }

  /** Called once the widget is on its grid. */
  init(): void {
    // Widgets that need their size or grid override this.
  }

  getChanged(): boolean {
    return this.changed
  }

  saved(): void {
    this.changed = false
  }
}

/**
 * Upstream compared the edited text with `!=` against the stored value, which may not be a string.
 */
export function editedTextChanged(stored: JsonLike, text: string): boolean {
  return !looseEquals(stored, text)
}
