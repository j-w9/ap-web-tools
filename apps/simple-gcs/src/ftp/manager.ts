/**
 * Serialises FTP requests on one vehicle link (upstream `SimpleGCS/ftp_manager.js`). Cancellation
 * and timeouts finish each job once, before a queued request may start.
 *
 * Port notes: upstream is a page-global singleton that constructs `MAVFTP` itself; here the client
 * comes from an injected factory and time from a `Clock`. Jobs are a discriminated union.
 */
import { NO_TIMER, type Clock, type Timer } from '../clock.js'
import { ftpFailed, type DownloadOptions, type FtpCallback, type FtpInbound, type FtpOutcome } from './client.js'

/** The client operations the manager drives (implemented by `MavFtpClient`). */
export interface FtpClientPort {
  targetSystem: number
  targetComponent: number
  getFile(path: string, callback: FtpCallback<Uint8Array>, options?: DownloadOptions): void
  putFile(path: string, data: Uint8Array, callback: FtpCallback<number>): void
  cancel(): void
  handleMessage(m: FtpInbound): boolean
}

/** The link a client is bound to: the socket generation and the vehicle's ids. */
export interface FtpLinkIdentity {
  /** Identifies the connection (upstream compares the MAVLink processor and WebSocket objects). */
  readonly connection: object
  readonly systemId: number
  readonly componentId: number
}

export interface GetFileOptions extends DownloadOptions {
  /** Groups jobs for `cancelQueuedByTag`/`dropQueuedTag`. */
  readonly tag?: string
  /** Cancel queued (not active) jobs with the same tag first. */
  readonly dropQueuedTag?: boolean
  /** Cancel queued (not active) jobs for the same path first. */
  readonly dropQueuedPath?: boolean
  /** Watchdog: cancel if no accepted reply for this long. Default 5000 ms. */
  readonly timeoutMs?: number
}

export interface PutFileOptions {
  readonly timeoutMs?: number
}

interface JobBase {
  readonly path: string
  readonly timeoutMs: number | undefined
  completed: boolean
  timer: Timer
}
interface DownloadJob extends JobBase {
  readonly kind: 'download'
  readonly tag: string | undefined
  readonly options: GetFileOptions
  readonly callback: FtpCallback<Uint8Array> | undefined
}
interface UploadJob extends JobBase {
  readonly kind: 'upload'
  readonly data: Uint8Array
  readonly callback: FtpCallback<number> | undefined
}
type Job = DownloadJob | UploadJob

interface Bound {
  readonly identity: FtpLinkIdentity
  readonly client: FtpClientPort
}

export class FtpManager {
  private bound: Bound | null = null
  private current: Job | null = null
  private queue: Job[] = []

  constructor(
    private readonly createClient: (identity: FtpLinkIdentity) => FtpClientPort,
    private readonly clock: Clock
  ) {}

  private finish(job: Job, outcome: FtpOutcome<Uint8Array | number>): void {
    if (job.completed) return
    job.completed = true
    job.timer.cancel()
    if (this.current === job) this.current = null
    try {
      deliver(job, outcome)
    } finally {
      this.pump()
    }
  }

  private armTimeout(job: Job): void {
    job.timer.cancel()
    job.timer = this.clock.after(job.timeoutMs ?? 5000, () => {
      if (this.current !== job || job.completed) return
      this.bound?.client.cancel()
    })
  }

  private pump(): void {
    if (this.current !== null) return
    const job = this.queue.shift()
    if (job === undefined) return
    const client = this.bound?.client
    if (client === undefined) {
      this.finish(job, ftpFailed)
      return
    }
    this.current = job
    this.armTimeout(job)
    try {
      if (job.kind === 'upload') client.putFile(job.path, job.data, (outcome) => this.finish(job, outcome))
      else client.getFile(job.path, (outcome) => this.finish(job, outcome), job.options)
    } catch {
      this.finish(job, ftpFailed)
    }
  }

  private dropQueued(predicate: (job: Job) => boolean): void {
    const canceled = this.queue.filter(predicate)
    this.queue = this.queue.filter((job) => !predicate(job))
    for (const job of canceled) {
      job.completed = true
      deliver(job, ftpFailed)
    }
  }

  setLink(identity: FtpLinkIdentity | null): void {
    const link = this.bound?.identity
    if (
      identity !== null &&
      link !== undefined &&
      link.connection === identity.connection &&
      link.systemId === identity.systemId &&
      link.componentId === identity.componentId
    ) {
      return
    }
    this.clearLink()
    if (
      identity === null ||
      !Number.isInteger(identity.systemId) ||
      identity.systemId < 1 ||
      identity.systemId > 255 ||
      !Number.isInteger(identity.componentId) ||
      identity.componentId < 0 ||
      identity.componentId > 255
    ) {
      return
    }
    const client = this.createClient(identity)
    client.targetSystem = identity.systemId
    client.targetComponent = identity.componentId
    this.bound = { identity, client }
    // Do not reset sessions here: ArduPilot <=4.6 can close another client's file. Start requests
    // immediately with their watchdogs.
  }

  clearLink(): void {
    const previous = this.bound?.client
    const canceled = this.queue
    this.queue = []
    this.bound = null
    previous?.cancel()
    for (const job of canceled) this.finish(job, ftpFailed)
  }

  /** Offers a FILE_TRANSFER_PROTOCOL message; an accepted reply extends the active job's watchdog. */
  handleMessage(m: FtpInbound): void {
    const job = this.current
    if (this.bound?.client.handleMessage(m) === true && job !== null && this.current === job && !job.completed)
      this.armTimeout(job)
  }

  getFile(path: string, callback: FtpCallback<Uint8Array> | undefined, options: GetFileOptions = {}): void {
    const tag = options.tag
    if (options.dropQueuedTag === true && tag !== undefined && tag !== '')
      this.dropQueued((job) => job.kind === 'download' && job.tag === tag)
    if (options.dropQueuedPath === true) this.dropQueued((job) => job.path === path)
    this.queue.push({
      kind: 'download',
      path,
      callback,
      tag,
      timeoutMs: options.timeoutMs,
      options,
      completed: false,
      timer: NO_TIMER
    })
    this.pump()
  }

  putFile(path: string, data: Uint8Array, callback: FtpCallback<number> | undefined, options: PutFileOptions = {}): void {
    this.queue.push({ kind: 'upload', path, data, callback, timeoutMs: options.timeoutMs, completed: false, timer: NO_TIMER })
    this.pump()
  }

  cancelQueuedByTag(tag: string): void {
    this.dropQueued((job) => job.kind === 'download' && job.tag === tag)
  }

  cancelQueuedByPath(path: string): void {
    this.dropQueued((job) => job.path === path)
  }

  isBusy(): boolean {
    return this.current !== null
  }

  queuedCount(): number {
    return this.queue.length
  }
}

function deliver(job: Job, outcome: FtpOutcome<Uint8Array | number>): void {
  if (outcome.kind === 'failed') {
    job.callback?.(ftpFailed)
    return
  }
  const value = outcome.value
  if (job.kind === 'download') {
    if (value instanceof Uint8Array) job.callback?.({ kind: 'done', value })
  } else if (typeof value === 'number') job.callback?.({ kind: 'done', value })
}
