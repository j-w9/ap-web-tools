/**
 * MAVLink 2 message signing (https://mavlink.io/en/guide/message_signing.html).
 *
 * A signed frame carries a 13-byte block after the checksum: link id (1 byte), a 48-bit
 * little-endian timestamp in 10 us units since 2015-01-01, and the first 6 bytes of
 * SHA-256(secret key ++ frame ++ link id ++ timestamp).
 *
 * Behaviour follows upstream `mavlink.js` with its `runtime-fixes.patch` applied: a new stream is
 * accepted if its timestamp is at most one minute behind ours, a stream's replay watermark only
 * advances after a valid signature, and our own timestamp moves past every accepted one. Parts of
 * the structure are adapted from `vendor/arduconfigurator/packages/protocol-mavlink/src/
 * mavlink-v2-codec.ts` (ArduConfigurator, same authors, GPL-3.0).
 */
import type { FrameHeader } from './message.js'
import { sha256 } from './sha256.js'

/** Length of the signature block: link id, timestamp and signature. */
export const SIGNATURE_BLOCK_LENGTH = 13
/** The SIGNED bit of the MAVLink 2 incompatibility flags. */
export const INCOMPAT_FLAG_SIGNED = 0x01
/** Secret keys are exactly this long. */
export const SIGNING_KEY_LENGTH = 32
/** Start of the signing timestamp epoch, 2015-01-01 UTC, in Unix milliseconds. */
export const SIGNING_EPOCH_MS = Date.UTC(2015, 0, 1)
/** How far (10 us units) a new stream's first timestamp may lag ours: one minute. */
export const NEW_STREAM_MAX_AGE = 6_000_000

const TIMESTAMP_MAX = 2 ** 48 - 1

/** Why a frame was refused by signature checking. */
export type SignatureRejection =
  /** The signature does not match the secret key. */
  | 'bad-signature'
  /** The timestamp is not newer than the last accepted one from the same stream. */
  | 'replayed'
  /** First frame of a stream, more than a minute older than our timestamp. */
  | 'stale-stream'
  /** Unsigned frame (or MAVLink 1) and `allowUnsigned` did not accept it. */
  | 'unsigned'

/** Signing timestamp (10 us units since 2015-01-01) for a Unix time in milliseconds. */
export function signingTimestamp(unixMs: number = Date.now()): number {
  return Math.min(TIMESTAMP_MAX, Math.max(0, Math.floor((unixMs - SIGNING_EPOCH_MS) * 100)))
}

/** Derives a secret key from a passphrase the way Mission Planner and MAVProxy do: SHA-256 of its UTF-8. */
export function signingKeyFromPassphrase(passphrase: string): Uint8Array {
  return sha256(new TextEncoder().encode(passphrase))
}

/** First 6 bytes of SHA-256(key ++ data). Upstream `mavlink20.create_signature`. */
export function createSignature(secretKey: Uint8Array, data: Uint8Array): Uint8Array {
  const input = new Uint8Array(secretKey.length + data.length)
  input.set(secretKey)
  input.set(data, secretKey.length)
  return sha256(input).subarray(0, 6)
}

function readUint48(bytes: Uint8Array, offset: number): number {
  let value = 0
  for (let i = 5; i >= 0; i--) value = value * 256 + bytes[offset + i]!
  return value
}

function writeUint48(bytes: Uint8Array, offset: number, value: number): void {
  let rest = value
  for (let i = 0; i < 6; i++) {
    bytes[offset + i] = rest % 256
    rest = Math.floor(rest / 256)
  }
}

export interface SigningOptions {
  /** 32-byte secret key, e.g. from `signingKeyFromPassphrase`. */
  readonly secretKey: Uint8Array
  /** Link id written into outgoing signatures. Default 0. */
  readonly linkId?: number
  /** Initial timestamp. Default: `signingTimestamp()` (now). */
  readonly timestamp?: number
  /**
   * Called for unsigned frames (and frames failing verification); returning true delivers the
   * frame anyway. Without it, unsigned frames are rejected once a key is set, as upstream does.
   */
  readonly allowUnsigned?: (header: FrameHeader) => boolean
}

export interface SigningStats {
  readonly goodSignatures: number
  readonly badSignatures: number
  /** Unsigned (or failed) frames that `allowUnsigned` let through. */
  readonly acceptedUnsigned: number
  /** Frames refused, for any `SignatureRejection`. */
  readonly rejected: number
}

/**
 * Signing state shared by an encoder (outgoing signatures, timestamp) and a parser (verification,
 * per-stream replay protection). Upstream `MAVLinkSigning`.
 */
export class MavlinkSigning {
  readonly secretKey: Uint8Array
  linkId: number
  /** Timestamp of the next outgoing signature; also the reference for accepting new streams. */
  timestamp: number
  private readonly allowUnsigned: ((header: FrameHeader) => boolean) | undefined
  private readonly streams = new Map<string, number>()
  private readonly counts = { goodSignatures: 0, badSignatures: 0, acceptedUnsigned: 0, rejected: 0 }

  constructor(options: SigningOptions) {
    if (options.secretKey.length !== SIGNING_KEY_LENGTH) {
      throw new RangeError(`MAVLink signing keys are ${SIGNING_KEY_LENGTH} bytes, got ${options.secretKey.length}`)
    }
    this.secretKey = Uint8Array.from(options.secretKey)
    this.linkId = options.linkId ?? 0
    this.timestamp = options.timestamp ?? signingTimestamp()
    this.allowUnsigned = options.allowUnsigned
  }

  get stats(): SigningStats {
    return { ...this.counts }
  }

  /** Last accepted timestamp per stream, keyed `linkId,systemId,componentId`. */
  get streamTimestamps(): ReadonlyMap<string, number> {
    return this.streams
  }

  /**
   * Appends a signature block to `unsigned`, a complete frame (SIGNED flag already set) without
   * one, and advances the timestamp.
   */
  sign(unsigned: Uint8Array): Uint8Array {
    const frame = new Uint8Array(unsigned.length + SIGNATURE_BLOCK_LENGTH)
    frame.set(unsigned)
    frame[unsigned.length] = this.linkId
    writeUint48(frame, unsigned.length + 1, this.timestamp)
    frame.set(createSignature(this.secretKey, frame.subarray(0, unsigned.length + 7)), unsigned.length + 7)
    this.timestamp = Math.min(TIMESTAMP_MAX, this.timestamp + 1)
    return frame
  }

  /**
   * Checks a complete received frame: signed frames are verified (`signed` true), and unsigned or
   * failing ones are offered to `allowUnsigned`. Returns `'verified'` (good signature), `'allowed'`
   * (let through by `allowUnsigned`) or why the frame must be refused.
   */
  check(frame: Uint8Array, header: FrameHeader, signed: boolean): 'verified' | 'allowed' | SignatureRejection {
    let rejection: SignatureRejection = 'unsigned'
    if (signed) {
      const verdict = this.verify(frame, header)
      if (verdict === null) {
        this.counts.goodSignatures++
        return 'verified'
      }
      this.counts.badSignatures++
      rejection = verdict
    }
    if (this.allowUnsigned?.(header) === true) {
      this.counts.acceptedUnsigned++
      return 'allowed'
    }
    this.counts.rejected++
    return rejection
  }

  private verify(frame: Uint8Array, header: FrameHeader): Exclude<SignatureRejection, 'unsigned'> | null {
    const block = frame.length - SIGNATURE_BLOCK_LENGTH
    const linkId = frame[block]!
    const timestamp = readUint48(frame, block + 1)
    const stream = `${linkId},${header.systemId},${header.componentId}`
    const last = this.streams.get(stream)
    if (last !== undefined) {
      if (timestamp <= last) return 'replayed'
    } else if (timestamp + NEW_STREAM_MAX_AGE < this.timestamp) {
      return 'stale-stream'
    }
    const expected = createSignature(this.secretKey, frame.subarray(0, frame.length - 6))
    for (let i = 0; i < 6; i++) if (expected[i] !== frame[frame.length - 6 + i]) return 'bad-signature'
    this.streams.set(stream, timestamp)
    this.timestamp = Math.max(this.timestamp, timestamp + 1)
    return null
  }
}

/** Link id and timestamp of a signed frame's signature block. */
export function readSignatureBlock(frame: Uint8Array): { readonly linkId: number; readonly timestamp: number } {
  const block = frame.length - SIGNATURE_BLOCK_LENGTH
  return { linkId: frame[block] ?? 0, timestamp: readUint48(frame, block + 1) }
}
