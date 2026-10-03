/**
 * Message types derived from the generated `MessageMap`. A message is `{ name, id, fields }`; the
 * fields live in their own object because several MAVLink messages have fields called `name`,
 * `type` or `id`, which would collide with a flat discriminant.
 */
import type { ExtensionFieldMap, MessageIdMap, MessageMap, MessageName } from './generated/messages.js'

/**
 * A decoded message. With no argument this is the union of every message, discriminated on
 * `name`: `if (m.name === 'HEARTBEAT') m.fields.customMode`.
 */
export type Message<N extends MessageName = MessageName> = {
  readonly [K in N]: { readonly name: K; readonly id: MessageIdMap[K]; readonly fields: MessageMap[K] }
}[N]

/** Fields as the encoder accepts them for one value type. */
export type FieldInput<T> = T extends string
  ? string
  : T extends bigint
    ? bigint
    : T extends number
      ? T
      : T extends BigInt64Array | BigUint64Array
        ? ArrayLike<bigint>
        : ArrayLike<number>

/**
 * Fields accepted by the encoder for message `N`: extension fields may be omitted (they encode as
 * 0), arrays may be any array-like no longer than the field (missing elements encode as 0), and
 * strings no longer than the field in UTF-8 bytes. For a union of names this is the union of their
 * inputs, so a descriptor of unknown type cannot be encoded without saying which message it is.
 */
export type MessageInput<N extends MessageName> = N extends MessageName
  ? {
      readonly [K in Exclude<keyof MessageMap[N], ExtensionFieldMap[N]>]: FieldInput<MessageMap[N][K]>
    } & {
      readonly [K in Extract<keyof MessageMap[N], ExtensionFieldMap[N]>]?: FieldInput<MessageMap[N][K]>
    }
  : never

/** Header fields of a received frame. MAVLink 1 frames have no flags; they read as 0. */
export interface FrameHeader {
  readonly version: 1 | 2
  /** Payload length on the wire (after MAVLink 2 trailing-zero truncation). */
  readonly payloadLength: number
  readonly incompatFlags: number
  readonly compatFlags: number
  readonly sequence: number
  readonly systemId: number
  readonly componentId: number
  readonly messageId: number
}

/** The signature block of a signed MAVLink 2 frame. */
export interface FrameSignature {
  readonly linkId: number
  /** 48-bit timestamp, 10 microsecond units since 2015-01-01 UTC. */
  readonly timestamp: number
  /**
   * Whether the signature was checked against the parser's secret key and passed. False when the
   * parser has no signing state, or when a failing frame was let through by `allowUnsigned`.
   */
  readonly verified: boolean
}

/** What a parser knows about a frame besides its message. */
export interface FrameInfo {
  readonly header: FrameHeader
  readonly signature: FrameSignature | null
  /** The complete frame as received, including checksum and signature. */
  readonly frame: Uint8Array
}

/** A message as delivered by `MavlinkParser`: the decoded message plus its frame. */
export type ReceivedMessage<N extends MessageName = MessageName> = {
  readonly [K in N]: Message<K> & FrameInfo
}[N]
