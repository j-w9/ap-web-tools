/**
 * Sandbox and Custom HTML widgets: user content in a sandboxed iframe, ported from upstream
 * `TelemetryDashboard/Widgets/SandBox.js` and `CustomHTML.js` with the VideoOverlay subclasses
 * (`VideoOverlay/Widgets/SandBox.js`, `CustomHTML.js`) folded in. The iframe receives the log
 * buffer and the log time by `postMessage` and answers "renderDone" once a time is drawn.
 *
 * Candidate to share with telemetry-dashboard, which feeds the same frames MAVLink instead.
 */
import { jsString, type JsonObject } from './json.js'
import { DEFAULT_CUSTOM_HTML, SANDBOX_DOCUMENT } from './documents.js'
import { INERT_ENVIRONMENT, OverlayWidget, type RenderItem, type WidgetEnvironment } from './widget.js'
import type { WidgetOptions } from './layout-file.js'

/** Default script of a new Sandbox widget (upstream `WidgetSandBoxVideoOverlay`). */
export const DEFAULT_SANDBOX_SCRIPT = `// Initialization
div.appendChild(document.createTextNode("Widget Example:"))
div.appendChild(document.createElement("br"))

message_report = document.createTextNode("No Log")
div.appendChild(message_report)

div.appendChild(document.createElement("br"))

logTime = document.createTextNode("")
div.appendChild(logTime)

// Load function
loadLog = function (log) {
    message_report.nodeValue = "Got log starting at: " + log.extractStartTime()
}

// Runtime function
setTime = function(time) {
    logTime.nodeValue = "Log Time: " + time.toFixed(2)
}
`

const SANDBOX_ABOUT: JsonObject = {
  name: 'Sandbox',
  info: 'Sandboxed widget allowing user defined functionality with JavaScript. User input using Formio form.'
}
const CUSTOM_HTML_ABOUT: JsonObject = {
  name: 'Custom HTML',
  info: 'Custom HTML allowing user defined HTML. User input using Formio form.'
}

/** Messages the widget frames understand (see `documents.ts`). */
type FrameMessage =
  | { readonly options: JsonObject }
  | { readonly script: string; readonly options: JsonObject }
  | { readonly logData: ArrayBuffer }
  | { readonly time: number }

/** The frames' reply once a time has been rendered. */
const RENDER_DONE = 'renderDone'

/** Wait for upstream's custom HTML to load before sending it the log. */
const LOG_DELAY_MS = 100

function createFrame(): HTMLIFrameElement {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin')
  iframe.setAttribute('scrolling', 'no')
  iframe.style.border = 'none'
  iframe.style.width = '100%'
  iframe.style.height = '100%'
  iframe.style.overflow = 'hidden'
  return iframe
}

/** A widget whose content is a sandboxed iframe. */
abstract class FrameWidget extends OverlayWidget {
  protected readonly iframe = createFrame()

  protected post(message: FrameMessage): void {
    this.iframe.contentWindow?.postMessage(message, '*')
  }

  override setEdit(enabled: boolean): void {
    super.setEdit(enabled)
    // No pointer events while editing, so the widget can be dragged.
    this.iframe.style.pointerEvents = this.editEnabled ? 'none' : 'auto'
  }

  override destroy(): void {
    super.destroy()
    this.iframe.remove()
  }

  /** Send the time and resolve once the frame reports it has rendered. */
  override setTime(time: number): Promise<void> {
    const contentWindow = this.iframe.contentWindow
    if (contentWindow === null) return Promise.resolve()
    return new Promise((resolve) => {
      const handler = (event: MessageEvent) => {
        if (event.source !== contentWindow || event.data !== RENDER_DONE) return
        window.removeEventListener('message', handler)
        resolve()
      }
      window.addEventListener('message', handler)
      contentWindow.postMessage({ time } satisfies FrameMessage, '*')
    })
  }

  override getContentForRender(parent: DOMRect): RenderItem[] {
    const box = this.getBoundingClientRect()
    const body = this.iframe.contentDocument?.body
    if (body === undefined) throw new Error(`${this.getAbout().name} widget has not loaded`)
    return [{ pos: { x: box.x - parent.x, y: box.y - parent.y, height: box.height, width: box.width }, content: body }]
  }

  /** Form changed: send the new options. */
  protected postOptions(): void {
    this.post({ options: this.getFormContent() })
  }
}

/** Upstream `WidgetSandBoxVideoOverlay`: a user script run in the sandbox page. */
export class SandboxWidget extends FrameWidget {
  readonly widgetType = 'WidgetSandBoxVideoOverlay'
  private scriptText: string
  private readonly initDone: Promise<void>

  constructor(env: WidgetEnvironment = INERT_ENVIRONMENT, options: JsonObject = {}) {
    super(env, { ...options, about: options['about'] ?? SANDBOX_ABOUT }, true, 'Sandbox')
    const sandbox = options['sandbox']
    this.scriptText = sandbox === null || sandbox === undefined ? DEFAULT_SANDBOX_SCRIPT : jsString(sandbox)
    this.iframe.srcdoc = SANDBOX_DOCUMENT
    this.initDone = new Promise((resolve) => {
      this.iframe.addEventListener('load', () => {
        this.init()
        resolve()
      })
    })
    if (!this.isClone) this.appendChild(this.iframe)
  }

  /** Send the script and options to the sandbox. */
  override init(): void {
    this.post({ script: this.scriptText, options: this.getFormContent() })
  }

  override getOptions(): WidgetOptions {
    return { ...super.getOptions(), sandbox: this.scriptText }
  }

  editLanguage(): 'javascript' {
    return 'javascript'
  }

  editText(): string {
    return this.scriptText
  }

  setEditedText(text: string): void {
    if (this.scriptText !== text) this.changed = true
    this.scriptText = text
    this.init()
    this.loadLog()
  }

  protected override formChanged(): void {
    super.formChanged()
    this.postOptions()
    this.loadLog()
  }

  loadLog(): void {
    const logData = this.env.logBuffer()
    if (logData === null) return
    void this.initDone.then(() => this.post({ logData }))
  }
}

/** Upstream `WidgetCustomHTMLVideoOverlay`: a user HTML document. */
export class CustomHtmlWidget extends FrameWidget {
  readonly widgetType = 'WidgetCustomHTMLVideoOverlay'

  constructor(env: WidgetEnvironment = INERT_ENVIRONMENT, options: JsonObject = {}) {
    super(env, { ...options, about: options['about'] ?? CUSTOM_HTML_ABOUT }, true, 'Custom HTML')
    const html = options['custom_HTML']
    this.iframe.srcdoc = html === null || html === undefined ? DEFAULT_CUSTOM_HTML : jsString(html)
    this.iframe.addEventListener('load', () => this.init())
    if (this.isClone) return
    this.appendChild(this.iframe)
    // Give the HTML a moment to load before sending the log.
    this.loadLogSoon()
  }

  private loadLogSoon(): void {
    setTimeout(() => this.loadLog(), LOG_DELAY_MS)
  }

  /** Send the options to the document. */
  override init(): void {
    this.postOptions()
  }

  override getOptions(): WidgetOptions {
    return { ...super.getOptions(), custom_HTML: this.iframe.srcdoc }
  }

  editLanguage(): 'html' {
    return 'html'
  }

  editText(): string {
    return this.iframe.srcdoc
  }

  setEditedText(text: string): void {
    if (this.iframe.srcdoc !== text) this.changed = true
    this.iframe.srcdoc = text
    this.init()
    this.loadLogSoon()
  }

  protected override formChanged(): void {
    super.formChanged()
    this.postOptions()
    this.loadLogSoon()
  }

  loadLog(): void {
    const logData = this.env.logBuffer()
    if (logData === null) return
    this.post({ logData })
  }
}

export const SANDBOX_TAG = 'vo-widget-sandbox'
export const CUSTOM_HTML_TAG = 'vo-widget-custom-html'
if (!customElements.get(SANDBOX_TAG)) customElements.define(SANDBOX_TAG, SandboxWidget)
if (!customElements.get(CUSTOM_HTML_TAG)) customElements.define(CUSTOM_HTML_TAG, CustomHtmlWidget)
