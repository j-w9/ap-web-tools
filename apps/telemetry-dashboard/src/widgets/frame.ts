import { FRAME_SANDBOX } from '../sandbox/protocol.js'

/** A widget iframe styled as upstream's (borderless, full size, no scrolling). */
export function createWidgetFrame(): HTMLIFrameElement {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('sandbox', FRAME_SANDBOX)
  iframe.setAttribute('scrolling', 'no')
  iframe.style.border = 'none'
  iframe.style.width = '100%'
  iframe.style.height = '100%'
  iframe.style.overflow = 'hidden'
  return iframe
}
