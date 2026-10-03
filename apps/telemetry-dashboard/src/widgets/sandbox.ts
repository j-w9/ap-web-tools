/**
 * Sandbox widget (upstream Widgets/SandBox.js): runs a user script in a sandboxed iframe
 * (`sandbox.html`), passing it the form contents; the script receives MAVLink messages.
 */
import { jsString, type JsonLike } from '../layout/json.js'
import { postToFrame } from '../sandbox/protocol.js'
import { editedTextChanged, Widget, type WidgetHost } from './base.js'
import { createWidgetFrame } from './frame.js'
import { sandboxOptions, type OptionsObject } from './options.js'

export { DEFAULT_SANDBOX_SCRIPT, SANDBOX_ABOUT } from './options.js'

/** The sandbox page, next to the dashboard page. */
export const SANDBOX_PAGE = 'sandbox.html'

export class SandboxWidget extends Widget {
  /** The script as stored (normally a string; sent and saved unchanged, as upstream). */
  private script: JsonLike
  private readonly iframe: HTMLIFrameElement

  constructor(rawOptions: unknown, host: WidgetHost) {
    const { options, script } = sandboxOptions(rawOptions)
    super('WidgetSandBox', options, true, host)
    this.script = script
    this.iframe = createWidgetFrame()
    this.iframe.src = SANDBOX_PAGE
    // Send the script and options as soon as the frame has loaded.
    this.iframe.addEventListener('load', () => this.init())
    this.el.append(this.iframe)
  }

  /** Starts (or restarts) the user script with the current options. */
  override init(): void {
    postToFrame(this.iframe, { script: this.script, options: this.getFormContent() })
  }

  override setEdit(enabled: boolean): void {
    super.setEdit(enabled)
    // Lets the grid see drags over the frame while editing.
    this.iframe.style.pointerEvents = this.editEnabled ? 'none' : 'auto'
  }

  override getOptions(): OptionsObject {
    return { ...super.getOptions(), sandbox: this.script }
  }

  override getEditLanguage(): 'javascript' {
    return 'javascript'
  }

  override getEditText(): string {
    return jsString(this.script)
  }

  override setEditedText(text: string): void {
    if (editedTextChanged(this.script, text)) this.changed = true
    this.script = text
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
