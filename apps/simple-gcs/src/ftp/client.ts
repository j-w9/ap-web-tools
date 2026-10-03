/**
 * MAVLink FTP client with acknowledged downloads and uploads (upstream `modules/MAVLink/mavftp.js`,
 * class `MAVFTP`). Replies are correlated with the vehicle, session and request so delayed packets
 * cannot complete a later transfer.
 *
 * Port notes: the transfer in progress is a discriminated union instead of upstream's set of
 * nullable fields, results are `FtpOutcome`s instead of `data | null`, and time comes from an
 * injected `Clock`. Control flow, retry rules, sequence arithmetic and callback ordering follow
 * upstream line for line.
 */
import { NO_TIMER, type Clock, type Timer } from '../clock.js'
import { FTP_MAX_PAYLOAD, FtpError, FtpOp, packOp, parseOp, type FtpPacket } from './protocol.js'

/** How a transfer ended: its value, or failure (upstream passes `null`). */
export type FtpOutcome<T> = { readonly kind: 'done'; readonly value: T } | { readonly kind: 'failed' }
export type FtpCallback<T> = (outcome: FtpOutcome<T>) => void

export const ftpFailed: { readonly kind: 'failed' } = { kind: 'failed' }
const done = <T>(value: T): FtpOutcome<T> => ({ kind: 'done', value })

/** Options for a download (upstream `getFile` options). */
export interface DownloadOptions {
  /** The advertised size is only an estimate (virtual `@PARAM` files). */
  readonly sizeIsEstimate?: boolean
  /** Gap reads always request `burstSize` bytes. */
  readonly fixedReadSize?: boolean
}

/** Where the client sends packed FTP requests: one FILE_TRANSFER_PROTOCOL message each. May throw if the link is closed. */
export interface FtpLink {
  /** Our system/component id, which replies must target. */
  readonly sourceSystem: number
  readonly sourceComponent: number
  send(payload: Uint8Array, targetSystem: number, targetComponent: number): void
}

/** The parts of a received FILE_TRANSFER_PROTOCOL message the client checks. */
export interface FtpInbound {
  readonly name: string
  readonly header: { readonly systemId: number; readonly componentId: number }
  readonly fields: { readonly targetSystem: number; readonly targetComponent: number; readonly payload: Uint8Array }
}

/** A sent request, retried with the same sequence number. */
interface FtpRequest {
  readonly opcode: number
  readonly offset: number
  readonly size: number
  readonly payload: Uint8Array | null
  readonly seq: number
  retries: number
  sentTime: number
}

interface Gap {
  readonly offset: number
  readonly length: number
}

interface Download {
  readonly kind: 'download'
  readonly path: string
  readonly callback: FtpCallback<Uint8Array>
  readonly sizeIsEstimate: boolean
  readonly fixedReadSize: boolean
  fileSize: number
  actualSize: number | null
  highestReceivedOffset: number
  buffer: Uint8Array | null
  gaps: Gap[]
  openRequest: FtpRequest | null
  burstRequest: FtpRequest | null
  readonly reads: Map<number, FtpRequest>
}

interface Upload {
  readonly kind: 'upload'
  readonly path: string
  readonly callback: FtpCallback<number>
  readonly data: Uint8Array
  offset: number
  request: FtpRequest | null
}

interface Reset {
  readonly kind: 'reset'
  readonly callback: FtpCallback<true>
  request: FtpRequest | null
}

type Transfer = Download | Upload | Reset

export class MavFtpClient {
  seq = 0
  session = 0
  targetSystem = 1
  targetComponent = 1
  burstSize = 80
  openFileTimeout = 3000
  burstReadTimeout = 3000
  readGapTimeout = 1000
  maxOpenRetries = 5
  maxBurstRetries = 5
  maxGapRetries = 20
  maxConcurrentReads = 5
  maxFileSize = 64 * 1024 * 1024

  private transfer: Transfer | null = null
  private sessionOpen = false
  private timer: Timer = NO_TIMER
  private timerRunning = false

  constructor(
    private readonly link: FtpLink,
    private readonly clock: Clock
  ) {}

  /** Path of the file being transferred, or null (upstream `currentFile`). */
  get activePath(): string | null {
    return this.transfer?.kind === 'download' || this.transfer?.kind === 'upload' ? this.transfer.path : null
  }

  /** Whether the retry timer is running (upstream `timeoutCheckInterval !== null`). */
  get timerActive(): boolean {
    return this.timerRunning
  }

  /** Download state, for tests and diagnostics. */
  get download(): {
    readonly opening: boolean
    readonly bursting: boolean
    readonly pendingReads: number
    readonly bufferLength: number | null
    readonly actualSize: number | null
  } | null {
    const t = this.transfer
    if (t?.kind !== 'download') return null
    return {
      opening: t.openRequest !== null,
      bursting: t.burstRequest !== null,
      pendingReads: t.reads.size,
      bufferLength: t.buffer?.length ?? null,
      actualSize: t.actualSize
    }
  }

  private sendOp(
    opcode: number,
    size: number,
    reqOpcode: number,
    burstComplete: number,
    offset: number,
    payload: Uint8Array | null,
    seq = this.seq
  ): number {
    const packed = packOp(seq, this.session, opcode, size, reqOpcode, burstComplete, offset, payload)
    this.link.send(packed, this.targetSystem, this.targetComponent)
    if (seq === this.seq) this.seq = (this.seq + 1) & 65535
    return seq
  }

  // Burst replies consume sequence numbers too. Stay beyond the newest accepted reply so ArduPilot
  // won't mistake our next request for a retry. Serial-number arithmetic handles wrap and reordering.
  private advanceSequence(replySeq: number): void {
    const next = (replySeq + 1) & 65535
    if (((next - this.seq) & 65535) < 32768) this.seq = next
  }

  private request(opcode: number, offset: number, size: number, payload: Uint8Array | null = null): FtpRequest {
    const request: FtpRequest = { opcode, offset, size, payload, seq: this.seq, retries: 0, sentTime: this.clock.now() }
    this.sendOp(opcode, size, 0, 0, offset, payload, request.seq)
    return request
  }

  private retry(request: FtpRequest | null, timeout: number, maxRetries: number): boolean {
    if (request === null || this.clock.now() - request.sentTime < timeout) return true
    if (request.retries >= maxRetries) {
      this.complete(ftpFailed)
      return false
    }
    request.retries++
    request.sentTime = this.clock.now()
    this.sendOp(request.opcode, request.size, 0, 0, request.offset, request.payload, request.seq)
    return true
  }

  private checkTimeouts(): void {
    const t = this.transfer
    try {
      switch (t?.kind) {
        case undefined:
          return
        case 'reset':
          this.retry(t.request, this.openFileTimeout, this.maxOpenRetries)
          return
        case 'upload':
          this.retry(t.request, this.openFileTimeout, this.maxOpenRetries)
          return
        case 'download':
          if (!this.retry(t.openRequest, this.openFileTimeout, this.maxOpenRetries)) return
          if (!this.retry(t.burstRequest, this.burstReadTimeout, this.maxBurstRetries)) return
          for (const request of t.reads.values()) {
            if (!this.retry(request, this.readGapTimeout, this.maxGapRetries)) return
          }
      }
    } catch {
      this.complete(ftpFailed)
    }
  }

  private startTimer(): void {
    this.timer = this.clock.every(250, () => this.checkTimeouts())
    this.timerRunning = true
  }

  /**
   * Explicit administrative reset only. ArduPilot <=4.6 does not scope this to the GCS identity, so
   * it may close another client's active file.
   */
  resetSessions(callback: FtpCallback<true>): void {
    this.cancel()
    const transfer: Reset = { kind: 'reset', callback, request: null }
    this.transfer = transfer
    try {
      transfer.request = this.request(FtpOp.ResetSessions, 0, 0)
      this.startTimer()
    } catch {
      this.complete(ftpFailed)
    }
  }

  getFile(filename: string, callback: FtpCallback<Uint8Array>, options: DownloadOptions = {}): void {
    this.cancel()
    const bytes = new TextEncoder().encode(filename)
    if (!bytes.length || bytes.length > FTP_MAX_PAYLOAD || bytes.includes(0)) {
      callback(ftpFailed)
      return
    }
    this.session = (this.session + 1) & 255
    const transfer: Download = {
      kind: 'download',
      path: filename,
      callback,
      sizeIsEstimate: options.sizeIsEstimate === true,
      fixedReadSize: options.fixedReadSize === true,
      fileSize: 0,
      actualSize: null,
      highestReceivedOffset: 0,
      buffer: null,
      gaps: [],
      openRequest: null,
      burstRequest: null,
      reads: new Map()
    }
    this.transfer = transfer
    try {
      transfer.openRequest = this.request(FtpOp.OpenFileRO, 0, bytes.length, bytes)
      this.startTimer()
    } catch {
      this.complete(ftpFailed)
    }
  }

  // Stop-and-wait writes retain their sequence on retry. Wait for the close ACK too: virtual files
  // such as @PARAM apply their contents on close.
  putFile(filename: string, data: Uint8Array, callback: FtpCallback<number>): void {
    this.cancel()
    const name = new TextEncoder().encode(filename)
    if (!name.length || name.length > FTP_MAX_PAYLOAD || name.includes(0) || data.length > this.maxFileSize) {
      callback(ftpFailed)
      return
    }
    this.session = (this.session + 1) & 255
    const transfer: Upload = { kind: 'upload', path: filename, callback, data: data.slice(), offset: 0, request: null }
    this.transfer = transfer
    try {
      transfer.request = this.request(FtpOp.CreateFile, 0, name.length, name)
      this.startTimer()
    } catch {
      this.complete(ftpFailed)
    }
  }

  private handleWrite(t: Upload, op: FtpPacket): boolean {
    const request = t.request
    if (request === null || op.reqOpcode !== request.opcode || op.seq !== ((request.seq + 1) & 65535)) return false
    if (op.opcode === FtpOp.Nack) {
      this.complete(ftpFailed)
      return true
    }
    if (op.offset !== request.offset) return false
    if (request.opcode === FtpOp.CreateFile) this.sessionOpen = true
    if (request.opcode === FtpOp.TerminateSession) {
      this.sessionOpen = false
      const size = t.data.length
      // Already closed: complete() must not send another close.
      this.complete(done(size))
      return true
    }
    if (request.opcode === FtpOp.WriteFile) t.offset += request.size
    if (t.offset === t.data.length) {
      t.request = this.request(FtpOp.TerminateSession, 0, 0)
    } else {
      const bytes = t.data.subarray(t.offset, t.offset + FTP_MAX_PAYLOAD)
      t.request = this.request(FtpOp.WriteFile, t.offset, bytes.length, bytes)
    }
    return true
  }

  // Clear state before invoking callers, which may immediately start another file.
  private complete(outcome: FtpOutcome<Uint8Array | number | true>): void {
    const t = this.transfer
    const active = this.sessionOpen
    this.sessionOpen = false
    this.transfer = null
    this.timer.cancel()
    this.timer = NO_TIMER
    this.timerRunning = false
    if (active) {
      try {
        this.sendOp(FtpOp.TerminateSession, 0, 0, 0, 0, null)
      } catch {
        /* Link closed. */
      }
    }
    if (t === null) return
    if (outcome.kind === 'failed') {
      t.callback(ftpFailed)
      return
    }
    const value = outcome.value
    switch (t.kind) {
      case 'download':
        if (value instanceof Uint8Array) t.callback(done(value))
        break
      case 'upload':
        if (typeof value === 'number') t.callback(done(value))
        break
      case 'reset':
        if (value === true) t.callback(done(true))
        break
    }
  }

  cancel(): void {
    this.complete(ftpFailed)
  }

  terminateSession(): void {
    this.cancel()
  }

  /** Offers a received FTP message; true when it was accepted as a reply to the current request. */
  handleMessage(m: FtpInbound): boolean {
    const t = this.transfer
    if (
      t === null ||
      m.name !== 'FILE_TRANSFER_PROTOCOL' ||
      m.header.systemId !== this.targetSystem ||
      m.header.componentId !== this.targetComponent ||
      m.fields.targetSystem !== this.link.sourceSystem ||
      m.fields.targetComponent !== this.link.sourceComponent
    ) {
      return false
    }
    const op = parseOp(m.fields.payload)
    if (op === null || op.session !== this.session || (op.opcode !== FtpOp.Ack && op.opcode !== FtpOp.Nack)) return false
    try {
      switch (t.kind) {
        case 'reset': {
          if (t.request === null || op.reqOpcode !== FtpOp.ResetSessions || op.seq !== ((t.request.seq + 1) & 65535)) return false
          this.complete(op.opcode === FtpOp.Ack ? done(true) : ftpFailed)
          return true
        }
        case 'upload':
          return this.handleWrite(t, op)
        case 'download':
          return this.handleDownload(t, op)
      }
    } catch {
      this.complete(ftpFailed)
    }
    return false
  }

  private handleDownload(t: Download, op: FtpPacket): boolean {
    if (op.reqOpcode === FtpOp.OpenFileRO) {
      const request = t.openRequest
      if (request === null || op.seq !== ((request.seq + 1) & 65535)) return false
      if (op.opcode === FtpOp.Nack) {
        this.complete(ftpFailed)
        return true
      }
      this.sessionOpen = true
      if (op.size !== 4) return false
      t.fileSize = new DataView(op.payload.buffer, op.payload.byteOffset, 4).getUint32(0, true)
      if (t.fileSize > this.maxFileSize) {
        this.complete(ftpFailed)
        return true
      }
      t.openRequest = null
      t.buffer = new Uint8Array(t.fileSize)
      if (!t.fileSize && !t.sizeIsEstimate) {
        this.complete(done(t.buffer))
        return true
      }
      t.gaps = [{ offset: 0, length: t.fileSize }]
      t.burstRequest = this.request(FtpOp.BurstReadFile, 0, this.burstSize)
      return true
    }
    if (t.buffer === null) return false
    if (op.reqOpcode === FtpOp.BurstReadFile) {
      const burst = t.burstRequest
      if (burst === null) return false
      if (op.opcode === FtpOp.Nack) {
        if (op.size < 1) return false
        if (op.payload[0] !== FtpError.EndOfFile) {
          this.advanceSequence(op.seq)
          this.complete(ftpFailed)
        } else {
          if (op.size !== 1) return false
          if (t.sizeIsEstimate) {
            // Virtual parameter files only advertise an estimate. The EOF offset bounds the file;
            // still recover every missing byte below it before reporting completion.
            if (op.offset < t.highestReceivedOffset || op.offset < burst.offset || op.offset > this.maxFileSize) return false
            t.actualSize = op.offset
            this.resizeFile(t, op.offset)
          }
          this.advanceSequence(op.seq)
          t.burstRequest = null
          this.checkReadSend(t)
        }
        return true
      }
      if (!this.storeData(t, op)) return false
      this.advanceSequence(op.seq)
      if (!t.gaps.length && (!t.sizeIsEstimate || t.actualSize !== null)) {
        this.complete(done(t.buffer))
        return true
      }
      burst.sentTime = this.clock.now()
      burst.retries = 0
      const nextOffset = op.offset + op.size
      if (op.burstComplete && nextOffset > burst.offset) {
        if (nextOffset >= t.fileSize && !t.sizeIsEstimate) {
          t.burstRequest = null
          this.checkReadSend(t)
        } else {
          t.burstRequest = this.request(FtpOp.BurstReadFile, nextOffset, this.burstSize)
        }
      }
      return true
    }
    if (op.reqOpcode === FtpOp.ReadFile) {
      const seq = (op.seq - 1) & 65535
      const request = t.reads.get(seq)
      if (request === undefined || op.offset !== request.offset) return false
      if (op.opcode === FtpOp.Nack) {
        this.complete(ftpFailed)
        return true
      }
      if (op.size > request.size || !this.storeData(t, op)) return false
      t.reads.delete(seq)
      if (!t.gaps.length) this.complete(done(t.buffer))
      else this.checkReadSend(t)
      return true
    }
    return false
  }

  private resizeFile(t: Download, size: number): void {
    const oldSize = t.fileSize
    const buffer = new Uint8Array(size)
    if (t.buffer !== null) buffer.set(t.buffer.subarray(0, size))
    t.buffer = buffer
    t.fileSize = size
    if (size > oldSize) t.gaps.push({ offset: oldSize, length: size - oldSize })
    else
      t.gaps = t.gaps
        .filter((g) => g.offset < size)
        .map((g) => ({ offset: g.offset, length: Math.min(g.length, size - g.offset) }))
  }

  private storeData(t: Download, op: FtpPacket): boolean {
    const end = op.offset + op.size
    if (!op.size || end > this.maxFileSize) return false
    if (end > t.fileSize && t.sizeIsEstimate && t.actualSize === null) this.resizeFile(t, end)
    if (end > t.fileSize || t.buffer === null) return false
    t.highestReceivedOffset = Math.max(t.highestReceivedOffset, end)
    t.buffer.set(op.payload, op.offset)
    const missing: Gap[] = []
    for (const gap of t.gaps) {
      const gapEnd = gap.offset + gap.length
      if (end <= gap.offset || op.offset >= gapEnd) missing.push(gap)
      else {
        if (gap.offset < op.offset) missing.push({ offset: gap.offset, length: op.offset - gap.offset })
        if (end < gapEnd) missing.push({ offset: end, length: gapEnd - end })
      }
    }
    t.gaps = missing
    return true
  }

  private checkReadSend(t: Download): void {
    if (!t.gaps.length) {
      if (t.buffer !== null) this.complete(done(t.buffer))
      return
    }
    for (const gap of t.gaps) {
      const end = gap.offset + gap.length
      for (let offset = gap.offset; offset < end;) {
        const pending = [...t.reads.values()].find((r) => offset >= r.offset && offset < r.offset + r.size)
        if (pending !== undefined) {
          offset = pending.offset + pending.size
          continue
        }
        if (t.reads.size >= this.maxConcurrentReads) return
        const nextPending = [...t.reads.values()].filter((r) => r.offset > offset).map((r) => r.offset)
        const size = t.fixedReadSize
          ? this.burstSize
          : Math.min(this.burstSize, end - offset, ...nextPending.map((o) => o - offset))
        const request = this.request(FtpOp.ReadFile, offset, size)
        t.reads.set(request.seq, request)
        offset += size
      }
    }
  }
}
