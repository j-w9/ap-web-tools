/**
 * Video in a separate window (upstream `video.js` `openNewWindow` and `video-window.js`). The
 * WebRTC options, including credentials, are exchanged with our own page by `postMessage`, never
 * put in its URL.
 */
import type { WebRtcOptions } from './webrtc-player.js'

export const VIDEO_READY = 'simplegcs-video-ready'
export const VIDEO_CONFIG = 'simplegcs-video-config'
/** Hash of the video window route on the same page (upstream: a separate `video.html`). */
export const VIDEO_HASH = '#video'

export interface VideoConfigMessage {
  readonly type: typeof VIDEO_CONFIG
  readonly options: WebRtcOptions
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

export function isVideoConfigMessage(data: unknown): data is VideoConfigMessage {
  if (!isRecord(data) || data.type !== VIDEO_CONFIG || !isRecord(data.options)) return false
  const o = data.options
  return typeof o.url === 'string' && typeof o.user === 'string' && typeof o.pass === 'string'
}

export interface OpenerWindow {
  open(url: string, target: string): Window | null
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void
  readonly location: { readonly origin: string; readonly href: string }
  setTimeout(handler: () => void, ms: number): number
  clearTimeout(id: number): void
}

/** Opens the video window and answers its ready message once, within 30 s. */
export function openVideoWindow(win: OpenerWindow, options: WebRtcOptions): void {
  const url = new URL(win.location.href)
  url.search = ''
  url.hash = VIDEO_HASH
  const popup = win.open(url.href, '_blank')
  if (popup === null) return
  const cleanup = (): void => {
    win.removeEventListener('message', ready)
    win.clearTimeout(timer)
  }
  const ready = (event: MessageEvent): void => {
    if (event.source !== popup || event.origin !== win.location.origin || event.data !== VIDEO_READY) return
    const message: VideoConfigMessage = { type: VIDEO_CONFIG, options }
    popup.postMessage(message, win.location.origin)
    cleanup()
  }
  const timer = win.setTimeout(cleanup, 30000)
  win.addEventListener('message', ready)
}
