/**
 * Authenticated MediaMTX playback shared by the inset panel and the separate window (upstream
 * `SimpleGCS/webrtc-player.js`). The status badge is reported through a callback instead of being
 * written into a DOM element.
 */

export interface WebRtcOptions {
  readonly url: string
  readonly user: string
  readonly pass: string
}

/** Badge colour family (upstream colours: #4caf50 live, #b36b00 waiting, #b3261e error). */
export type VideoTone = 'live' | 'waiting' | 'error' | 'hls'

export interface VideoStatus {
  readonly text: string
  readonly tone: VideoTone
}

/** The video element operations the player uses. */
export interface PlayerVideo {
  srcObject: MediaProvider | null
  play(): Promise<void>
  pause(): void
  addEventListener(type: 'playing' | 'waiting', listener: () => void): void
  removeEventListener(type: 'playing' | 'waiting', listener: () => void): void
}

export interface PlayerWindow {
  addEventListener(type: 'pagehide', listener: () => void): void
  removeEventListener(type: 'pagehide', listener: () => void): void
}

export interface ReaderHandle {
  close(): void
}

/** What the player passes to the WHEP reader (a subset of `MediaMTXWebRTCReader`'s configuration). */
export interface PlayerReaderConf extends WebRtcOptions {
  readonly onError: (err: string) => void
  readonly onTrack: (evt: { readonly streams: readonly MediaStream[] }) => void
}

export type ReaderFactory = (conf: PlayerReaderConf) => ReaderHandle

/** Badge text for a reader error. */
export function describeVideoError(error: unknown): string {
  const detail = String(error)
  let message = /401|403|unauthorized/i.test(detail)
    ? 'Authentication failed. Check video settings.'
    : /404|stream not found/i.test(detail)
      ? 'Stream not found. Check video settings.'
      : 'Unable to play video. Check the connection and video settings.'
  if (/retrying/i.test(detail)) message += ' Retrying…'
  return message
}

export class WebRtcPlayer {
  private closed = false
  private readonly reader: ReaderHandle | undefined
  private readonly onPlaying = (): void => {
    if (this.video.srcObject) this.setStatus('WebRTC · Live', 'live')
  }
  private readonly onWaiting = (): void => {
    if (this.video.srcObject) this.setStatus('WebRTC · Buffering', 'waiting')
  }
  private readonly onPageHide = (): void => this.close()

  constructor(
    private readonly video: PlayerVideo,
    private readonly status: (status: VideoStatus) => void,
    options: WebRtcOptions,
    createReader: ReaderFactory,
    private readonly win: PlayerWindow
  ) {
    video.addEventListener('playing', this.onPlaying)
    video.addEventListener('waiting', this.onWaiting)
    this.setStatus('WebRTC · Connecting', 'waiting')
    let reader: ReaderHandle | undefined
    try {
      reader = createReader({
        ...options,
        onError: (error) => {
          if (this.closed) return
          video.srcObject = null
          this.showError(error)
        },
        onTrack: (event) => {
          if (this.closed) return
          video.srcObject = event.streams[0] ?? null
          video.play().catch(() => {
            if (!this.closed) this.setStatus('WebRTC · Press play to watch', 'waiting')
          })
        }
      })
    } catch (error) {
      this.showError(error)
    }
    this.reader = reader
    win.addEventListener('pagehide', this.onPageHide)
  }

  private showError(error: unknown): void {
    this.setStatus(`WebRTC · ${describeVideoError(error)}`, 'error')
  }

  private setStatus(text: string, tone: VideoTone): void {
    if (this.closed) return
    this.status({ text, tone })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.reader?.close()
    this.video.removeEventListener('playing', this.onPlaying)
    this.video.removeEventListener('waiting', this.onWaiting)
    this.video.pause()
    this.video.srcObject = null
    this.win.removeEventListener('pagehide', this.onPageHide)
  }
}
