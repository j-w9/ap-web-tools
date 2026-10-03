/**
 * Widget editor: a code editor (Monaco) for the widget's script or HTML, a Formio form builder for
 * its options and a live test copy of the widget, ported from upstream `VideoOverlay/WidgetEdit.js`.
 * Monaco's workers are bundled instead of loaded from unpkg (upstream builds `data:` workers that
 * `importScripts` the CDN copy).
 *
 * Candidate to share with telemetry-dashboard.
 */
import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker'
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker'
import { GridStack } from 'gridstack'
import { BUILDER_OPTIONS, Formio, type FormioStatic } from './formio-setup.js'
import type { OverlayController } from './overlay-controller.js'
import { newWidget } from './overlay-controller.js'
import { widgetClass } from './loader.js'
import { savedWidget, type OverlayWidget } from './widget.js'

type FormioBuilder = Awaited<ReturnType<FormioStatic['builder']>>

/** Page elements of the editor overlay (upstream `#edit_overlay`). */
export interface WidgetEditorElements {
  readonly overlay: HTMLElement
  readonly testGrid: HTMLElement
  readonly textEditor: HTMLElement
  readonly formEditor: HTMLElement
  readonly scriptTab: HTMLButtonElement
  readonly formTab: HTMLButtonElement
  readonly close: HTMLButtonElement
}

type Tab = 'script' | 'form'

function installMonacoWorkers(): void {
  globalThis.MonacoEnvironment = {
    getWorker(_workerId: string, label: string): Worker {
      if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker()
      if (label === 'typescript' || label === 'javascript') return new TsWorker()
      return new EditorWorker()
    }
  }
}

export class WidgetEditor {
  private readonly model: monaco.editor.ITextModel
  private readonly editor: monaco.editor.IStandaloneCodeEditor
  private readonly testGrid: GridStack
  private builder: FormioBuilder | undefined
  /** The test copy currently shown, updated live by the code editor and form builder. */
  private testWidget: OverlayWidget | undefined

  constructor(
    private readonly elements: WidgetEditorElements,
    private readonly controller: OverlayController
  ) {
    installMonacoWorkers()
    this.model = monaco.editor.createModel('', 'javascript')
    this.editor = monaco.editor.create(elements.textEditor, {
      model: this.model,
      language: 'javascript',
      theme: 'vs-dark',
      automaticLayout: true
    })
    // Update the test widget in real time.
    this.editor.onDidChangeModelContent(() => this.testWidget?.setEditedText(this.editor.getValue()))

    const columns = 5
    const rows = 5
    this.testGrid = GridStack.init(
      {
        float: true,
        disableDrag: true,
        disableResize: true,
        column: columns,
        row: rows,
        cellHeight: `${100 / rows}%`,
        alwaysShowResizeHandle: true
      },
      elements.testGrid
    )

    void Formio.builder(elements.formEditor, {}, BUILDER_OPTIONS).then((builder) => {
      this.builder = builder
      const update = () => this.testWidget?.setFormDefinition(builder.schema)
      builder.on('updateComponent', update)
      builder.on('removeComponent', update)
    })

    elements.scriptTab.onclick = () => this.selectTab('script')
    elements.formTab.onclick = () => this.selectTab('form')
  }

  /** Show one tab; the form tab pins the test widget's options popup open. */
  private selectTab(tab: Tab): void {
    const { textEditor, formEditor, scriptTab, formTab } = this.elements
    textEditor.style.display = tab === 'script' ? 'block' : 'none'
    formEditor.style.display = tab === 'form' ? 'block' : 'none'
    scriptTab.setAttribute('aria-pressed', String(tab === 'script'))
    formTab.setAttribute('aria-pressed', String(tab === 'form'))
    for (const widget of this.testWidgets()) {
      if (tab === 'form') {
        widget.editTip.show()
        widget.editTip.setProps({ hideOnClick: false })
      } else {
        widget.editTip.setProps({ hideOnClick: true })
      }
    }
  }

  private testWidgets(): OverlayWidget[] {
    return this.testWidget === undefined ? [] : [this.testWidget]
  }

  /** Open the editor on a widget (upstream `load_editor`). */
  open(widget: OverlayWidget): void {
    const builder = this.builder
    if (builder === undefined) return
    this.elements.overlay.style.display = 'block'
    this.selectTab('script')

    this.testGrid.removeAll()
    this.testGrid.enable()

    // A copy of the widget on the test grid, at its size if that fits, else any size.
    const saved = savedWidget(widget)
    const pos: { autoPosition: boolean; w?: number; h?: number } = { autoPosition: true }
    if (saved.w !== null) pos.w = Number(saved.w)
    if (saved.h !== null) pos.h = Number(saved.h)
    if (!this.testGrid.willItFit(pos)) {
      delete pos.w
      delete pos.h
    }
    const testWidget = newWidget(this.controller, widgetClass(saved.type), saved.options)
    testWidget.disableButtonsForEdit()
    this.testGrid.addWidget(testWidget, pos)
    testWidget.setEdit(true)

    const language = testWidget.editLanguage()
    if (language !== undefined) monaco.editor.setModelLanguage(this.model, language)
    // Loading the text fires the change listener; upstream registered this copy's listener after
    // that, so the copy is not sent its own text (and the log) back.
    this.editor.setValue(testWidget.editText())
    this.testWidget = testWidget

    // The original's form, as the copy's may not have loaded yet.
    void builder.setForm(widget.getFormDefinition())

    this.elements.close.onclick = () => {
      testWidget.destroy()
      this.testGrid.removeWidget(testWidget)
      this.testGrid.removeAll()
      this.testWidget = undefined
      this.elements.overlay.style.display = 'none'
      widget.setEditedText(this.editor.getValue())
      widget.setFormDefinition(builder.schema)
    }
  }

  dispose(): void {
    this.editor.dispose()
    this.model.dispose()
    this.testGrid.destroy(false)
  }
}
