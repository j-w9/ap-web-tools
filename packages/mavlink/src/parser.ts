/**
 * Streaming MAVLink 1/2 frame parser: feed it bytes as they arrive (any fragmentation, several
 * frames per chunk) and it returns typed messages.
 *
 * Behaviour matches upstream `MAVLink20Processor` (with `runtime-fixes.patch`) except for one
 * deliberate improvement: after a CRC failure upstream discards the whole frame its length byte
 * claimed, which can swallow following good frames when the length byte itself was corrupted.
 * Here only the bytes up to the next start marker are discarded, as the MAVLink C library does.
 */
import { crcAccumulate, crcX25 } from './crc.js'
import type { MessageDescriptor } from './descriptor.js'
import { decodePayload } from './decode.js'
import { MAVLINK1_HEADER_LENGTH, MAVLINK1_MARKER, MAVLINK2_HEADER_LENGTH, MAVLINK2_MARKER } from './encode.js'
import type { MessageName } from './generated/messages.js'
import type { FrameHeader, FrameSignature, ReceivedMessage } from './message.js'
import {
  INCOMPAT_FLAG_SIGNED,
  SIGNATURE_BLOCK_LENGTH,
  readSignatureBlock,
  type MavlinkSigning,
  type SignatureRejection
} from './signing.js'

/** Why bytes were thrown away without being framed. */
export type GarbageReason =
  /** Bytes before a start marker. */
  | 'noise'
  /** A frame whose checksum did not match (or a false start marker). */
  | 'crc'
  /** A MAVLink 2 header with incompatibility flags we do not understand. */
  | 'incompat-flags'

/** One thing the parser found in the byte stream. */
export type ParseEvent<N extends MessageName = MessageName> =
  | { readonly kind: 'message'; readonly message: ReceivedMessage<N> }
  /** A well-formed frame whose message id is not among the parser's messages (its CRC cannot be checked). */
  | { readonly kind: 'unknown'; readonly header: FrameHeader; readonly frame: Uint8Array }
  /** A frame with a valid checksum that signing refused. */
  | { readonly kind: 'rejected'; readonly reason: SignatureRejection; readonly header: FrameHeader; readonly frame: Uint8Array }
  | { readonly kind: 'garbage'; readonly reason: GarbageReason; readonly bytes: Uint8Array }

export interface ParserStats {
  readonly bytesReceived: number
  readonly messagesReceived: number
  /** Frames with a bad checksum. */
  readonly crcErrors: number
  /** Well-formed frames with an id the parser does not know. */
  readonly unknownMessages: number
  /** Frames refused by signing. */
  readonly signatureErrors: number
  /** Bytes discarded as noise, failed frames or bad headers. */
  readonly droppedBytes: number
}

export interface ParserOptions<N extends MessageName> {
  /**
   * Messages to decode, e.g. `ALL_MESSAGES` or `[HEARTBEAT, ATTITUDE]`. The parser's message type
   * is narrowed to these, and a bundle contains only the descriptors listed.
   */
  readonly messages: readonly MessageDescriptor<N>[]
  /** Verify signatures (and refuse unsigned frames, unless the signing state allows them). */
  readonly signing?: MavlinkSigning
}

const MAX_FRAME_LENGTH = MAVLINK2_HEADER_LENGTH + 255 + 2 + SIGNATURE_BLOCK_LENGTH
const CHUNK_LENGTH = 4096

function isMarker(byte: number | undefined): boolean {
  return byte === MAVLINK2_MARKER || byte === MAVLINK1_MARKER
}

export class MavlinkParser<N extends MessageName = MessageName> {
  readonly signing: MavlinkSigning | undefined
  private readonly byId: ReadonlyMap<number, MessageDescriptor<N>>
  private readonly buffer = new Uint8Array(MAX_FRAME_LENGTH + CHUNK_LENGTH)
  private start = 0
  private end = 0
  private readonly counts = {
    bytesReceived: 0,
    messagesReceived: 0,
    crcErrors: 0,
    unknownMessages: 0,
    signatureErrors: 0,
    droppedBytes: 0
  }

  constructor(options: ParserOptions<N>) {
    this.byId = new Map(options.messages.map((m) => [m.id, m]))
    this.signing = options.signing
  }

  get stats(): ParserStats {
    return { ...this.counts }
  }

  /** Bytes held while waiting for the rest of a frame. */
  get buffered(): number {
    return this.end - this.start
  }

  /** Drops buffered bytes, e.g. after a reconnect. Statistics are kept. */
  reset(): void {
    this.start = 0
    this.end = 0
  }

  /** Feeds bytes and returns the messages completed by them. Discards are counted in `stats`. */
  push(chunk: Uint8Array): ReceivedMessage<N>[] {
    const messages: ReceivedMessage<N>[] = []
    for (const event of this.parse(chunk)) if (event.kind === 'message') messages.push(event.message)
    return messages
  }

  /** Feeds bytes and returns everything found, in stream order: messages and discards. */
  parse(chunk: Uint8Array): ParseEvent<N>[] {
    this.counts.bytesReceived += chunk.length
    const events: ParseEvent<N>[] = []
    // Large chunks (a whole log file) are fed in pieces so the buffer stays a few frames long.
    for (let offset = 0; offset < chunk.length || offset === 0; offset += CHUNK_LENGTH) {
      this.append(chunk.subarray(offset, offset + CHUNK_LENGTH))
      for (let event = this.next(); event !== null; event = this.next()) events.push(event)
    }
    return events
  }

  private append(piece: Uint8Array): void {
    if (this.end + piece.length > this.buffer.length) {
      const held = this.end - this.start
      // Never exceeds the buffer: at most one partial frame is held, plus one piece.
      this.buffer.copyWithin(0, this.start, this.end)
      this.start = 0
      this.end = held
    }
    this.buffer.set(piece, this.end)
    this.end += piece.length
  }

  /** Index of the next start marker after `from`, or the end of the buffer. */
  private nextMarker(from: number): number {
    for (let i = from; i < this.end; i++) if (isMarker(this.buffer[i])) return i
    return this.end
  }

  /** Discards from the current position up to the next marker after it. */
  private discard(reason: GarbageReason): ParseEvent<N> {
    const next = this.nextMarker(this.start + 1)
    const bytes = this.buffer.slice(this.start, next)
    this.counts.droppedBytes += bytes.length
    if (reason === 'crc') this.counts.crcErrors++
    this.start = next
    return { kind: 'garbage', reason, bytes }
  }

  private next(): ParseEvent<N> | null {
    const buffer = this.buffer
    const available = this.end - this.start
    if (available === 0) return null
    const marker = buffer[this.start]
    if (!isMarker(marker)) return this.discard('noise')

    const v2 = marker === MAVLINK2_MARKER
    if (available < 3) return null
    const payloadLength = buffer[this.start + 1]!
    const incompatFlags = v2 ? buffer[this.start + 2]! : 0
    if ((incompatFlags & ~INCOMPAT_FLAG_SIGNED) !== 0) return this.discard('incompat-flags')
    const signed = (incompatFlags & INCOMPAT_FLAG_SIGNED) !== 0
    const headerLength = v2 ? MAVLINK2_HEADER_LENGTH : MAVLINK1_HEADER_LENGTH
    const frameLength = headerLength + payloadLength + 2 + (signed ? SIGNATURE_BLOCK_LENGTH : 0)
    if (available < frameLength) return null

    const frame = buffer.slice(this.start, this.start + frameLength)
    const header: FrameHeader = v2
      ? {
          version: 2,
          payloadLength,
          incompatFlags,
          compatFlags: frame[3]!,
          sequence: frame[4]!,
          systemId: frame[5]!,
          componentId: frame[6]!,
          messageId: frame[7]! | (frame[8]! << 8) | (frame[9]! << 16)
        }
      : {
          version: 1,
          payloadLength,
          incompatFlags: 0,
          compatFlags: 0,
          sequence: frame[2]!,
          systemId: frame[3]!,
          componentId: frame[4]!,
          messageId: frame[5]!
        }

    const descriptor = this.byId.get(header.messageId)
    if (descriptor === undefined) {
      this.start += frameLength
      this.counts.unknownMessages++
      return { kind: 'unknown', header, frame }
    }

    const crcEnd = headerLength + payloadLength
    const crc = crcAccumulate(descriptor.crcExtra, crcX25(frame.subarray(1, crcEnd)))
    if (crc !== (frame[crcEnd]! | (frame[crcEnd + 1]! << 8))) return this.discard('crc')
    this.start += frameLength

    const verdict = this.signing?.check(frame, header, signed)
    if (verdict !== undefined && verdict !== 'verified' && verdict !== 'allowed') {
      this.counts.signatureErrors++
      return { kind: 'rejected', reason: verdict, header, frame }
    }
    const signature: FrameSignature | null = signed ? { ...readSignatureBlock(frame), verified: verdict === 'verified' } : null

    const fields = decodePayload(descriptor, frame.subarray(headerLength, crcEnd))
    const message = { name: descriptor.name, id: descriptor.id, fields, header, signature, frame }
    this.counts.messagesReceived++
    // `message` pairs a descriptor's name with that descriptor's decoded fields, which is exactly
    // one member of the union; TypeScript cannot follow the correlation through the generic `N`.
    return { kind: 'message', message: message as ReceivedMessage<N> }
  }
}
