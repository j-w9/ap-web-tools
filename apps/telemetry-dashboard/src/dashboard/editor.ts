/**
 * Widget editor overlay (upstream WidgetEdit.js `init_editor` / `load_editor` and `#edit_overlay`):
 * a live test copy of the widget on a small grid, a code editor for its script or HTML, and a
 * form builder for its options form. Closing copies the script and form back to the widget.
 */
import { GridStack } from 'gridstack'
import type { FormBuilder } from 'formiojs/dist/formio.full.min.js'
import type * as Monaco from 'monaco-editor'
import { BUILDER_OPTIONS, Formio } from '../forms/formio-setup.js'
import type { JsonLike } from '../layout/json.js'
import type { StoredWidget } from '../layout/layout.js'
import { widgetOf, type Widget } from '../widgets/base.js'

/** What the editor needs from the dashboard. */
export interface EditorHost {
  getWidgetObject(widget: Widget): StoredWidget
  newWidget(type: JsonLike, options: JsonLike): Widget
}

type Tab = 'script' | 'form'

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

async function loadMonaco(): Promise<typeof Monaco> {
  const [monaco, editorWorker, tsWorker, htmlWorker] = await Promise.all([
    import('monaco-editor'),
    import('monaco-editor/editor/editor.worker.js?worker'),
    import('monaco-editor/language/typescript/ts.worker.js?worker'),
    import('monaco-editor/language/html/html.worker.js?worker')
  ])
  self.MonacoEnvironment = {
    getWorker: (_id, label) => {
      if (label === 'typescript' || label === 'javascript') return new tsWorker.default()
      if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker.default()
      return new editorWorker.default()
    }
  }
  return monaco
}

export class WidgetEditor {
  private host: EditorHost | null = null
  private readonly overlay: HTMLDivElement
  private readonly testGrid: GridStack
  private readonly editIcon: HTMLButtonElement
  private readonly lockIcon: HTMLButtonElement
  private readonly scriptTab: HTMLDivElement
  private readonly formTab: HTMLDivElement
  private readonly tabButtons: Record<Tab, HTMLButtonElement>
  private readonly closeButton: HTMLButtonElement
  private monaco: typeof Monaco | null = null
  private editor: Monaco.editor.IStandaloneCodeEditor | null = null
  private formBuilder: FormBuilder | null = null
  /** The test copy being edited; the editor and builder listeners update it. */
  private testWidget: Widget | null = null

  constructor() {
    this.overlay = document.createElement('div')
    this.overlay.className = 'td-editor'
    this.overlay.hidden = true
    const frame = document.createElement('div')
    frame.className = 'apwt-card td-editor__frame'

    const head = document.createElement('div')
    head.className = 'td-editor__head'
    const title = document.createElement('span')
    title.className = 'td-tip__title'
    title.textContent = 'Widget Editor'
    this.closeButton = iconButton('fa-xmark', 'Close editor')
    head.append(title, this.closeButton)

    const columns = document.createElement('div')
    columns.className = 'td-editor__columns'

    const left = document.createElement('div')
    left.className = 'td-editor__column'
    const leftBar = document.createElement('div')
    leftBar.className = 'td-editor__bar td-editor__bar--end'
    this.editIcon = iconButton('fa-pen-to-square', 'Enable editing of the test widget')
    this.lockIcon = iconButton('fa-lock', 'Lock the test widget')
    leftBar.append(this.editIcon, this.lockIcon)
    const testGridDiv = document.createElement('div')
    testGridDiv.className = 'td-editor__test-grid'
    left.append(leftBar, testGridDiv)

    const right = document.createElement('div')
    right.className = 'td-editor__column'
    const rightBar = document.createElement('div')
    rightBar.className = 'td-editor__bar'
    this.tabButtons = { script: document.createElement('button'), form: document.createElement('button') }
    for (const [tab, button] of Object.entries(this.tabButtons)) {
      button.type = 'button'
      button.className = 'td-chip'
      button.textContent = tab === 'script' ? 'Script' : 'Form'
      rightBar.append(button)
    }
    this.scriptTab = document.createElement('div')
    this.scriptTab.className = 'td-editor__script'
    this.formTab = document.createElement('div')
    this.formTab.className = 'td-editor__form td-form'
    this.formTab.style.display = 'none'
    right.append(rightBar, this.scriptTab, this.formTab)

    columns.append(left, right)
    frame.append(head, columns)
    this.overlay.append(frame)
    document.body.append(this.overlay)

    this.testGrid = GridStack.init(
      {
        float: true,
        disableDrag: true,
        disableResize: true,
        column: 5,
        row: 5,
        cellHeight: `${100 / 5}%`,
        alwaysShowResizeHandle: true
      },
      testGridDiv
    )

    this.editIcon.onclick = () => this.editClick(true)
    this.lockIcon.onclick = () => this.editClick(false)
    this.tabButtons.script.onclick = () => this.tabClick('script')
    this.tabButtons.form.onclick = () => this.tabClick('form')
  }

  /** Loads the code editor and form builder (upstream did this at page load). */
  async init(host: EditorHost): Promise<void> {
    this.host = host
    void Formio.builder(this.formTab, {}, BUILDER_OPTIONS).then((builder) => {
      this.formBuilder = builder
      const update = (): void => this.testWidget?.setFormDefinition(builder.schema)
      builder.on('updateComponent', update)
      builder.on('removeComponent', update)
    })
    const monaco = await loadMonaco()
    this.monaco = monaco
    const model = monaco.editor.createModel('', 'javascript')
    this.editor = monaco.editor.create(this.scriptTab, { model, language: 'javascript', theme: 'vs-dark', automaticLayout: true })
    this.editor.onDidChangeModelContent(() => {
      if (this.editor !== null) this.testWidget?.setEditedText(this.editor.getValue())
    })
  }

  private testWidgets(): Widget[] {
    return this.testGrid.getGridItems().flatMap((el) => {
      const widget = widgetOf(el)
      return widget === undefined ? [] : [widget]
    })
  }

  private editClick(enabled: boolean): void {
    this.editIcon.style.display = enabled ? 'none' : ''
    this.lockIcon.style.display = enabled ? '' : 'none'
    if (enabled) this.testGrid.enable()
    else this.testGrid.disable()
    for (const widget of this.testWidgets()) widget.setEdit(enabled)
  }

  private tabClick(tab: Tab): void {
    this.scriptTab.style.display = 'none'
    this.formTab.style.display = 'none'
    for (const button of Object.values(this.tabButtons)) button.classList.remove('td-chip--active')
    switch (tab) {
      case 'script':
        this.scriptTab.style.display = 'block'
        for (const widget of this.testWidgets()) widget.editTip.setProps({ hideOnClick: true })
        break
      case 'form':
        this.formTab.style.display = 'block'
        this.editClick(true)
        // Show the test widget's options popup and keep it open while building the form.
        for (const widget of this.testWidgets()) {
          widget.editTip.show()
          widget.editTip.setProps({ hideOnClick: false })
        }
        break
    }
    this.tabButtons[tab].classList.add('td-chip--active')
  }

  /** Opens the editor on `widget` (upstream `load_editor`). Does nothing until loaded. */
  open(widget: Widget): void {
    const editor = this.editor
    const monaco = this.monaco
    const host = this.host
    if (editor === null || monaco === null || host === null) return

    this.overlay.hidden = false
    this.tabClick('script')

    this.testGrid.removeAll()
    this.testGrid.disable()
    this.editIcon.style.display = ''
    this.lockIcon.style.display = 'none'

    const stored = host.getWidgetObject(widget)
    const position: { autoPosition: true; w?: number; h?: number } = { autoPosition: true }
    if (stored.w !== null) position.w = Number.parseInt(stored.w, 10)
    if (stored.h !== null) position.h = Number.parseInt(stored.h, 10)
    if (!this.testGrid.willItFit(position)) {
      // Too big for the test grid: any size.
      delete position.w
      delete position.h
    }
    const testWidget = host.newWidget(stored.type, stored.options)
    testWidget.disableButtonsForEdit()
    this.testGrid.addWidget(testWidget.el, position)

    const model = editor.getModel()
    const language = testWidget.getEditLanguage()
    if (model !== null && language !== undefined) monaco.editor.setModelLanguage(model, language)
    // Loading the text fires the change listener; upstream registered this copy's listener after
    // that, so the copy is not sent its own text back.
    editor.setValue(testWidget.getEditText() ?? '')
    this.testWidget = testWidget

    // The original widget's form: the copy's may not have loaded yet.
    void this.formBuilder?.setForm(widget.getFormDefinition() ?? {})

    this.closeButton.onclick = () => {
      for (const test of this.testWidgets()) {
        test.destroy()
        this.testGrid.removeWidget(test.el)
      }
      this.testGrid.removeAll()
      this.overlay.hidden = true
      widget.setEditedText(editor.getValue())
      if (this.formBuilder !== null) widget.setFormDefinition(this.formBuilder.schema)
    }
  }
}
