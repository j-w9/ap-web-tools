/**
 * Telemetry log (`.tlog`) reader: walks the MAVLink frames, validates each against the
 * message table and collects per-system, per-component, per-message timing and size.
 * Payloads are never decoded.
 *
 * Port of upstream `load_tlog` (`StreamStats/StreamStats.js`).
 */
import { checkFrame, frameLength, readHeader, type MavlinkVersion } from './mavlink/frame.js'
import { mavlinkMessage, type MavlinkMessageName } from './mavlink/messages.js'

/** A tlog stores a big-endian 64-bit microsecond Unix timestamp before every frame. */
export const TLOG_TIMESTAMP_LENGTH = 8

/** One message type sent by one component. */
export interface TlogMessageStream {
  readonly name: MavlinkMessageName
  /** Receive time of each frame, seconds since the first frame in the log. */
  readonly time: Float64Array
  /** Size of each frame on the wire, in bits (frames vary: MAVLink 2 truncates payloads). */
  readonly sizeBits: Uint16Array
  readonly versions: ReadonlySet<MavlinkVersion>
  /** Whether any frame of this message was signed. */
  readonly signed: boolean
}

/** Everything one component (one system id, component id pair) sent. */
export interface TlogComponent {
  readonly systemId: number
  readonly componentId: number
  /** Valid frames received. */
  readonly received: number
  /** Frames missing according to gaps in the sequence numbers. */
  readonly dropped: number
  readonly versions: ReadonlySet<MavlinkVersion>
  /** Whether any frame from this component was signed. */
  readonly signed: boolean
  /** Messages in the order they first appeared. */
  readonly messages: readonly TlogMessageStream[]
}

/** The decoded tlog. */
export interface Tlog {
  /** Unix time of the first frame, or `undefined` if no valid frame was found. */
  readonly startTime: Date | undefined
  /** Seconds from the first to the last frame. */
  readonly duration: number
  /** Components ordered by system id, then component id. */
  readonly components: readonly TlogComponent[]
}

/** Thrown when timestamps run backwards, which upstream treats as a fatal error. */
export class TlogTimeError extends Error {
  constructor(
    readonly offset: number,
    readonly time: number,
    readonly previousTime: number
  ) {
    super(
      `Time went backwards at byte ${offset}: ${time.toFixed(3)} s after ${previousTime.toFixed(3)} s. ` +
        'The tlog may be corrupt or several logs joined together.'
    )
    this.name = 'TlogTimeError'
  }
}

interface MessageBuilder {
  name: MavlinkMessageName
  time: number[]
  sizeBits: number[]
  versions: Set<MavlinkVersion>
  signed: boolean
}

interface ComponentBuilder {
  systemId: number
  componentId: number
  nextSequence: number
  received: number
  dropped: number
  versions: Set<MavlinkVersion>
  signed: boolean
  messages: Map<MavlinkMessageName, MessageBuilder>
}

/**
 * Read a tlog. Bytes that do not start a known, checksum-valid frame are skipped one at a
 * time; a frame that would run past the end of the data stops the scan (as upstream does).
 *
 * @throws {TlogTimeError} if a frame's timestamp is earlier than the previous frame's.
 */
export function parseTlog(buffer: ArrayBuffer | Uint8Array): Tlog {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const length = bytes.byteLength

  const components = new Map<string, ComponentBuilder>()
  let firstTimestamp: bigint | undefined
  let endTime = 0

  let offset = TLOG_TIMESTAMP_LENGTH
  while (offset < length) {
    const read = readHeader(view, offset)
    if (read.kind === 'truncated') break
    if (read.kind === 'no-magic') {
      offset += 1
      continue
    }
    const header = read.header

    const total = frameLength(header)
    if (offset + total > length) break

    const message = mavlinkMessage(header.messageId)
    if (message === undefined || !checkFrame(bytes, view, offset, header, message.crcExtra)) {
      offset += 1
      continue
    }

    const key = `${header.systemId},${header.componentId}`
    let component = components.get(key)
    if (component === undefined) {
      component = {
        systemId: header.systemId,
        componentId: header.componentId,
        nextSequence: header.sequence,
        received: 0,
        dropped: 0,
        versions: new Set(),
        signed: false,
        messages: new Map()
      }
      components.set(key, component)
    }
    component.received++

    let stream = component.messages.get(message.name)
    if (stream === undefined) {
      stream = { name: message.name, time: [], sizeBits: [], versions: new Set(), signed: false }
      component.messages.set(message.name, stream)
    }

    const timestamp = view.getBigUint64(offset - TLOG_TIMESTAMP_LENGTH)
    firstTimestamp ??= timestamp
    const time = Number(timestamp - firstTimestamp) / 1_000_000
    if (time < endTime) throw new TlogTimeError(offset - TLOG_TIMESTAMP_LENGTH, time, endTime)
    endTime = time

    stream.time.push(time)
    stream.sizeBits.push(total * 8)
    stream.versions.add(header.version)
    stream.signed ||= header.signed

    component.versions.add(header.version)
    component.signed ||= header.signed

    // Sequence numbers wrap at 255; any gap counts as dropped frames.
    let sequence = header.sequence
    if (sequence < component.nextSequence) sequence += 256
    component.dropped += sequence - component.nextSequence
    component.nextSequence = (sequence + 1) % 256

    offset += total + TLOG_TIMESTAMP_LENGTH
  }

  const ordered = [...components.values()].sort((a, b) => a.systemId - b.systemId || a.componentId - b.componentId)
  return {
    startTime: firstTimestamp === undefined ? undefined : new Date(Number(firstTimestamp / 1000n)),
    duration: endTime,
    components: ordered.map((c) => ({
      systemId: c.systemId,
      componentId: c.componentId,
      received: c.received,
      dropped: c.dropped,
      versions: c.versions,
      signed: c.signed,
      messages: [...c.messages.values()].map((m) => ({
        name: m.name,
        time: Float64Array.from(m.time),
        sizeBits: Uint16Array.from(m.sizeBits),
        versions: m.versions,
        signed: m.signed
      }))
    }))
  }
}
