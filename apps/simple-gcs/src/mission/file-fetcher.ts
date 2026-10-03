/**
 * Fetch-and-display of one `@MISSION` file with automatic retry (the shared logic of upstream
 * `SimpleGCS/fence.js` and `SimpleGCS/mission.js`). A generation counter invalidates replies from
 * a previous connection, `pending` prevents overlapping transfers, and failed automatic fetches
 * retry after five seconds while the auto-fetch setting is on.
 */
import { NO_TIMER, type Clock, type Timer } from '../clock.js'
import type { FtpCallback } from '../ftp/client.js'
import type { GetFileOptions } from '../ftp/manager.js'

/** The FTP manager operations a fetcher uses. */
export interface FileFetchPort {
  getFile(path: string, callback: FtpCallback<Uint8Array>, options?: GetFileOptions): void
  cancelQueuedByTag(tag: string): void
}

export interface FileFetcherMessages {
  readonly fetching: string
  readonly failed: string
  readonly parseFailed: string
  readonly parseError: string
}

export interface FileFetcherOptions<T, O> {
  readonly path: string
  /** Tag for de-duplicating queued FTP jobs. */
  readonly tag: string
  readonly ftp: FileFetchPort
  readonly clock: Clock
  readonly toast: (message: string) => void
  /** Current value of the auto-fetch setting. */
  readonly autoFetch: () => boolean
  /** Parses the file; null when it is malformed. May throw. */
  readonly parse: (data: Uint8Array) => T | null
  /** Turns a parsed file into the overlay to show, toasting as the original does. */
  readonly present: (parsed: T, silent: boolean) => O
  /** The overlay with nothing drawn. */
  readonly empty: O
  readonly messages: FileFetcherMessages
}

export class FileFetcher<T, O> {
  private connected = false
  private fetched = false
  private pending = false
  private generation = 0
  private retryTimer: Timer = NO_TIMER
  private shown: O
  private readonly listeners = new Set<() => void>()

  constructor(private readonly options: FileFetcherOptions<T, O>) {
    this.shown = options.empty
  }

  /** What is drawn on the map. */
  get overlay(): O {
    return this.shown
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private show(overlay: O): void {
    this.shown = overlay
    for (const listener of this.listeners) listener()
  }

  private stopRetry(): void {
    this.retryTimer.cancel()
    this.retryTimer = NO_TIMER
  }

  private scheduleRetry(): void {
    this.stopRetry()
    if (!this.connected || this.fetched || !this.options.autoFetch()) return
    this.retryTimer = this.options.clock.after(5000, () => {
      this.retryTimer = NO_TIMER
      if (this.options.autoFetch()) this.fetch(true)
    })
  }

  fetch(silent = false): void {
    const { toast, messages } = this.options
    if (!this.connected) {
      if (!silent) toast('Not connected')
      return
    }
    if (this.pending) return
    this.pending = true
    this.fetched = false
    this.stopRetry()
    const generation = this.generation
    if (!silent) toast(messages.fetching)
    this.options.ftp.getFile(
      this.options.path,
      (outcome) => {
        if (generation !== this.generation) return
        this.pending = false
        if (outcome.kind === 'failed') {
          if (!silent) toast(messages.failed)
          this.scheduleRetry()
          return
        }
        try {
          const parsed = this.options.parse(outcome.value)
          if (parsed !== null) {
            this.show(this.options.present(parsed, silent))
            this.fetched = true
            this.stopRetry()
          } else if (!silent) {
            toast(messages.parseFailed)
          }
        } catch {
          if (!silent) toast(messages.parseError)
        }
        if (!this.fetched) this.scheduleRetry()
      },
      { tag: this.options.tag, dropQueuedTag: true, dropQueuedPath: true, timeoutMs: 5000 }
    )
  }

  /** A vehicle was discovered: start over, fetching automatically if enabled. */
  onConnected(): void {
    this.onDisconnected()
    this.connected = true
    if (this.options.autoFetch()) this.fetch(true)
  }

  onDisconnected(): void {
    this.stopRetry()
    this.connected = false
    this.generation++
    this.pending = false
    this.fetched = false
    this.options.ftp.cancelQueuedByTag(this.options.tag)
    this.show(this.options.empty)
  }

  /** Removes the overlay (upstream `clear`). */
  clear(): void {
    this.show(this.options.empty)
  }
}
