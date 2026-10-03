/**
 * Custom HTML widget (upstream Widgets/CustomHTML.js): a user HTML document in a sandboxed
 * `srcdoc` iframe, sent the form contents; it listens to the MAVLink BroadcastChannel itself.
 */
import { jsString, type JsonObject } from '../layout/json.js'
import { postToFrame } from '../sandbox/protocol.js'
import { Widget, type WidgetHost } from './base.js'
import { createWidgetFrame } from './frame.js'

export const DEFAULT_CUSTOM_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8"/>
    <title>Custom HTML Example</title>
</head>
<body>
    <div style="position:absolute; top:0; bottom:0; left:0; right:0; margin:10px; border:5px solid; border-radius:10px; border-color:#c8c8c8; background-color:#ffffff; padding;5px;">
        HTML Example
    </div>
</body>
<script type="module">

    let options

    function handle_MAVLink(msg) {
        // Message handling here
    }

    window.addEventListener('message', function (e) {
        const data = e.data

        // User has changed options
        if ("options" in data) {
            // Call init once we have some options
            options = data.options
        }

    })

    // Incoming MAVLink messages
    const broadcast = new BroadcastChannel("MAVLinkMSG")
    broadcast.onmessage = (e) => {
        if (e?.data?.MAVLink) {
            handle_MAVLink(e.data.MAVLink)
        }
    }
</script>
</html>
`

export const CUSTOM_HTML_ABOUT = {
  name: 'Custom HTML',
  info: 'Custom HTML allowing user defined HTML. User input using Formio form.'
} as const

export class CustomHtmlWidget extends Widget {
  private readonly iframe: HTMLIFrameElement

  constructor(options: JsonObject, host: WidgetHost) {
    const withAbout: JsonObject =
      options.about === undefined || options.about === null ? { ...options, about: CUSTOM_HTML_ABOUT } : options
    super('WidgetCustomHTML', withAbout, true, host)
    this.iframe = createWidgetFrame()
    this.iframe.srcdoc = 'custom_HTML' in options ? jsString(options.custom_HTML) : DEFAULT_CUSTOM_HTML
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

  override getOptions(): JsonObject {
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
