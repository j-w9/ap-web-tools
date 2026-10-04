/**
 * Streaming MAVLink 1/2 frame parser: feed it bytes as they arrive (any fragmentation, several
 * frames per chunk) and it returns typed messages.
 *
 * Port of upstream `MAVLink20Processor.parseBuffer` / `parseChar` / `parsePrefix` / `parseLength` /
 * `parsePayload` / `decode` (`modules/MAVLink/mavlink.js` with `runtime-fixes.patch`), with the same
 * results for every input except one proven upstream bug:
 *
 * - Bytes before a start marker (0xFD or 0xFE, whichever comes first) are discarded as one run.
 * - At a marker, the frame length is taken from the first three bytes: payload length + header
 *   (6 for MAVLink 1, 10 for MAVLink 2) + 2, plus 13 when a MAVLink 2 frame's SIGNED flag is set.
 *   The parser waits for that many bytes.
 * - The frame is then refused, in this order, for unknown incompatibility flags, an unknown message
 *   id, a checksum mismatch or a signature refusal; otherwise it is decoded.
 * - A frame refused for its incompatibility flags or its checksum is not well formed: only its start
 *   marker is dropped, and the search for a marker resumes at the next byte. Upstream consumes the
 *   whole claimed length, so a false start marker in noise or a corrupted length byte loses up to
 *   280 bytes and any good frames inside them; its own TODO says to cut off one byte (proven upstream
 *   bug #150, see `docs/bug-proofs/mavlink.md`). Every other frame consumes its claimed length.
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

/** Why bytes were thrown away without being decoded. */
export type GarbageReason =
  /** Bytes before a start marker (upstream "Bad prefix"). */
  | 'noise'
  /**
   * A start marker whose frame, as long as its length byte claimed, has a checksum that did not
   * match. Only the marker byte is dropped (see `next`).
   */
  | 'crc'
  /** A MAVLink 2 start marker whose frame has incompatibility flags other than SIGNED; only the marker is dropped. */
  | 'incompat-flags'

/**
 * One thing the parser found in the byte stream. Everything but `message` is one of upstream's
 * `BAD_DATA` messages.
 */
export type ParseEvent<N extends MessageName = MessageName> =
  | { readonly kind: 'message'; readonly message: ReceivedMessage<N> }
  /** A frame whose message id is not among the parser's messages (its checksum cannot be checked). */
  | { readonly kind: 'unknown'; readonly header: FrameHeader; readonly frame: Uint8Array }
  /** A frame with a valid checksum that signing refused. */
  | { readonly kind: 'rejected'; readonly reason: SignatureRejection; readonly header: FrameHeader; readonly frame: Uint8Array }
  | { readonly kind: 'garbage'; readonly reason: GarbageReason; readonly bytes: Uint8Array }

export interface ParserStats {
  /** Upstream `total_bytes_received`. */
  readonly bytesReceived: number
  /** Upstream `total_packets_received`. */
  readonly messagesReceived: number
  /** Upstream `total_receive_errors`: every event other than a message. */
  readonly receiveErrors: number
  /** Frames with a bad checksum. */
  readonly crcErrors: number
  /** Frames with an id the parser does not know. */
  readonly unknownMessages: number
  /** Frames refused by signing. */
  readonly signatureErrors: number
  /** Bytes discarded as noise, frames with a bad checksum or unknown incompatibility flags. */
  readonly droppedBytes: number
}

export interface ParserOptions<N extends MessageName> {
  /**
   * Messages to decode, e.g. `ALL_MESSAGES` (what upstream decodes) or `[HEARTBEAT, ATTITUDE]`. The
   * parser's message type is narrowed to these, and a bundle contains only the descriptors listed.
   */
  readonly messages: readonly MessageDescriptor<N>[]
  /** Verify signatures (and refuse unsigned frames, unless the signing state allows them). */
  readonly signing?: MavlinkSigning
}

function isMarker(byte: number | undefined): boolean {
  return byte === MAVLINK2_MARKER || byte === MAVLINK1_MARKER
}

export class MavlinkParser<N extends MessageName = MessageName> {
  readonly signing: MavlinkSigning | undefined
  private readonly byId: ReadonlyMap<number, MessageDescriptor<N>>
  private buffer = new Uint8Array(1024)
  private start = 0
  private end = 0
  private readonly counts = {
    bytesReceived: 0,
    messagesReceived: 0,
    receiveErrors: 0,
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
    this.append(chunk)
    const events: ParseEvent<N>[] = []
    for (let event = this.next(); event !== null; event = this.next()) {
      if (event.kind !== 'message') this.counts.receiveErrors++
      events.push(event)
    }
    return events
  }

  private append(chunk: Uint8Array): void {
    const held = this.end - this.start
    if (this.end + chunk.length > this.buffer.length) {
      if (held + chunk.length > this.buffer.length) {
        const grown = new Uint8Array(Math.max(this.buffer.length * 2, held + chunk.length))
        grown.set(this.buffer.subarray(this.start, this.end))
        this.buffer = grown
      } else {
        this.buffer.copyWithin(0, this.start, this.end)
      }
      this.start = 0
      this.end = held
    }
    this.buffer.set(chunk, this.end)
    this.end += chunk.length
  }

  /** Takes `length` bytes off the front of the buffer. */
  private take(length: number): Uint8Array {
    const bytes = this.buffer.slice(this.start, this.start + length)
    this.start += length
    return bytes
  }

  private garbage(reason: GarbageReason, bytes: Uint8Array): ParseEvent<N> {
    this.counts.droppedBytes += bytes.length
    if (reason === 'crc') this.counts.crcErrors++
    return { kind: 'garbage', reason, bytes }
  }

  private next(): ParseEvent<N> | null {
    const buffer = this.buffer
    const available = this.end - this.start
    if (available === 0) return null

    // parsePrefix: discard up to the first marker of either version (or everything).
    if (!isMarker(buffer[this.start])) {
      let next = this.start + 1
      while (next < this.end && !isMarker(buffer[next])) next++
      return this.garbage('noise', this.take(next - this.start))
    }

    // parseLength / parsePayload: the frame's length comes from its first three bytes alone.
    if (available < 3) return null
    const v2 = buffer[this.start] === MAVLINK2_MARKER
    const headerLength = v2 ? MAVLINK2_HEADER_LENGTH : MAVLINK1_HEADER_LENGTH
    const payloadLength = buffer[this.start + 1]!
    const signed = v2 && (buffer[this.start + 2]! & INCOMPAT_FLAG_SIGNED) !== 0
    const frameLength = payloadLength + headerLength + 2 + (signed ? SIGNATURE_BLOCK_LENGTH : 0)
    if (available < frameLength) return null
    // Upstream drops the whole claimed length before decoding, so a false start marker in noise (or
    // a corrupted length byte) loses good frames inside it. Its own TODO says a frame that is not well
    // formed should cut off one byte only: the port does that when the checksum or the incompatibility
    // flags fail (proven upstream bug #150, see `docs/bug-proofs/mavlink.md`). Unknown ids and
    // signature failures still consume the whole frame, as upstream.
    const frame = this.buffer.slice(this.start, this.start + frameLength)
    const event = this.decode(frame, v2, headerLength, payloadLength, signed)
    this.start += event.kind === 'garbage' ? 1 : frameLength
    return event
  }

  /** Upstream `decode`, on a copy of the frame at the front of the buffer. */
  private decode(frame: Uint8Array, v2: boolean, headerLength: number, payloadLength: number, signed: boolean): ParseEvent<N> {
    const header: FrameHeader = v2
      ? {
          version: 2,
          payloadLength,
          incompatFlags: frame[2]!,
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

    if ((header.incompatFlags & ~INCOMPAT_FLAG_SIGNED) !== 0) return this.garbage('incompat-flags', frame.slice(0, 1))

    const descriptor = this.byId.get(header.messageId)
    if (descriptor === undefined) {
      this.counts.unknownMessages++
      return { kind: 'unknown', header, frame }
    }

    const crcEnd = headerLength + payloadLength
    const crc = crcAccumulate(descriptor.crcExtra, crcX25(frame.subarray(1, crcEnd)))
    if (crc !== (frame[crcEnd]! | (frame[crcEnd + 1]! << 8))) return this.garbage('crc', frame.slice(0, 1))

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
