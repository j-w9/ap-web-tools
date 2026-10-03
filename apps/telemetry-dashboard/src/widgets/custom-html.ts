/**
 * Custom HTML widget (upstream Widgets/CustomHTML.js): a user HTML document in a sandboxed
 * `srcdoc` iframe, sent the form contents; it listens to the MAVLink BroadcastChannel itself.
 */
import { postToFrame } from '../sandbox/protocol.js'
import { Widget, type WidgetHost } from './base.js'
import { createWidgetFrame } from './frame.js'
import { customHtmlOptions, type OptionsObject } from './options.js'

export { CUSTOM_HTML_ABOUT, DEFAULT_CUSTOM_HTML } from './options.js'

export class CustomHtmlWidget extends Widget {
  private readonly iframe: HTMLIFrameElement

  constructor(rawOptions: unknown, host: WidgetHost) {
    const { options, srcdoc } = customHtmlOptions(rawOptions)
    super('WidgetCustomHTML', options, true, host)
    this.iframe = createWidgetFrame()
    this.iframe.srcdoc = srcdoc
    this.iframe.addEventListener('load', () => this.init())
    this.el.append(this.iframe)
  }

  override init(): void {
    postToFrame(this.iframe, { options: this.getFormContent() })
  }

  override setEdit(enabled: boolean): void {
    super.setEdit(enabled)
    this.iframe.style.pointerEvents = this.editEnabled ? 'none' : 'auto'
  }

  override getOptions(): OptionsObject {
    return { ...super.getOptions(), custom_HTML: this.iframe.srcdoc }
  }

  override getEditLanguage(): 'html' {
    return 'html'
  }

  override getEditText(): string {
    return this.iframe.srcdoc
  }

  override setEditedText(text: string): void {
    if (this.iframe.srcdoc !== text) this.changed = true
    this.iframe.srcdoc = text
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
