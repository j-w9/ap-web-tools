/**
 * Sandbox widget (upstream Widgets/SandBox.js): runs a user script in a sandboxed iframe
 * (`sandbox.html`), passing it the form contents; the script receives MAVLink messages.
 */
import { jsString, type JsonObject } from '../layout/json.js'
import { postToFrame } from '../sandbox/protocol.js'
import { Widget, type WidgetHost } from './base.js'
import { createWidgetFrame } from './frame.js'

/** The sandbox page, next to the dashboard page. */
export const SANDBOX_PAGE = 'sandbox.html'

export const DEFAULT_SANDBOX_SCRIPT = `// Initialization
div.appendChild(document.createTextNode("Widget Example:"))
div.appendChild(document.createElement("br"))

message_report = document.createTextNode("No Data")
div.appendChild(message_report)

// Runtime function
handle_msg = function (msg) {
    message_report.nodeValue = "Got: " + msg._name
}
`

export const SANDBOX_ABOUT = {
  name: 'Sandbox',
  info: 'Sandboxed widget allowing user defined functionality with JavaScript. User input using Formio form.'
} as const

export class SandboxWidget extends Widget {
  private scriptText: string
  private readonly iframe: HTMLIFrameElement

  constructor(options: JsonObject, host: WidgetHost) {
    const withAbout: JsonObject =
      options.about === undefined || options.about === null ? { ...options, about: SANDBOX_ABOUT } : options
    super('WidgetSandBox', withAbout, true, host)
    this.scriptText = 'sandbox' in options ? jsString(options.sandbox) : DEFAULT_SANDBOX_SCRIPT
    this.iframe = createWidgetFrame()
    this.iframe.src = SANDBOX_PAGE
    // Send the script and options as soon as the frame has loaded.
    this.iframe.addEventListener('load', () => this.init())
    this.el.append(this.iframe)
  }

  /** Starts (or restarts) the user script with the current options. */
  override init(): void {
    postToFrame(this.iframe, { script: this.scriptText, options: this.getFormContent() })
  }

  override setEdit(enabled: boolean): void {
    super.setEdit(enabled)
    // Lets the grid see drags over the frame while editing.
    this.iframe.style.pointerEvents = this.editEnabled ? 'none' : 'auto'
  }

  override getOptions(): JsonObject {
    return { ...super.getOptions(), sandbox: this.scriptText }
  }

  override getEditLanguage(): 'javascript' {
    return 'javascript'
  }

  override getEditText(): string {
    return this.scriptText
  }

  override setEditedText(text: string): void {
    if (this.scriptText !== text) this.changed = true
    this.scriptText = text
    this.init()
  }

  override destroy(): void {
    this.editTip.destroy()
    this.iframe.remove()
    super.destroy()
  }

  override formChanged(): void {
    super.formChanged()
    postToFrame(this.iframe, { options: this.getFormContent() })
  }
}
