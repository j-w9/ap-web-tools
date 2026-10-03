/**
 * MAVLink 2 message signing (https://mavlink.io/en/guide/message_signing.html).
 *
 * A signed frame carries a 13-byte block after the checksum: link id (1 byte), a 48-bit
 * little-endian timestamp in 10 us units since 2015-01-01, and the first 6 bytes of
 * SHA-256(secret key ++ frame ++ link id ++ timestamp).
 *
 * Port of upstream `modules/MAVLink/mavlink.js` with its `runtime-fixes.patch`: `MAVLinkSigning`,
 * `mavlink20.create_signature`, `message.sign_packet`, `MAVLink20Processor.check_signature` and the
 * signature branch of `MAVLink20Processor.decode`. Its rules are kept exactly: the initial timestamp
 * is the current time; every signed frame sent advances it by one; a new stream (link id, system,
 * component) is accepted if its first timestamp is at most 6,000,000 (one minute) behind ours; a
 * stream's replay watermark, and our own timestamp, move only after a valid signature; and frames
 * failing verification (or unsigned ones) are offered to the allow-unsigned callback.
 */
import type { FrameHeader } from './message.js'
import { sha256 } from './sha256.js'

/** Length of the signature block: link id, timestamp and signature. */
export const SIGNATURE_BLOCK_LENGTH = 13
/** The SIGNED bit of the MAVLink 2 incompatibility flags. */
export const INCOMPAT_FLAG_SIGNED = 0x01
/**
 * Size of the key slot. Upstream copies the key into a 32-byte slot followed by the data, so a
 * shorter key is zero-padded and a longer one acts as its first 32 bytes (the data overwrites the
 * rest; a key longer than the slot plus the data throws `RangeError`).
 */
export const SIGNING_KEY_LENGTH = 32
/** Start of the signing timestamp epoch, 2015-01-01 UTC, in Unix milliseconds. */
export const SIGNING_EPOCH_MS = Date.UTC(2015, 0, 1)
/** How far (10 us units) a new stream's first timestamp may lag ours: upstream's `6000*1000`. */
export const NEW_STREAM_MAX_AGE = 6000 * 1000

/** Why a frame was refused by signature checking. Upstream reports all of these as "Invalid signature". */
export type SignatureRejection =
  /** The signature does not match the secret key. */
  | 'bad-signature'
  /** The timestamp is not newer than the last accepted one from the same stream. */
  | 'replayed'
  /** First frame of a stream, more than a minute older than our timestamp. */
  | 'stale-stream'
  /** Unsigned frame (or MAVLink 1) and `allowUnsigned` did not accept it. */
  | 'unsigned'

/** Signing timestamp (10 us units since 2015-01-01) for a Unix time in milliseconds. Upstream's initial `timestamp`. */
export function signingTimestamp(unixMs: number = Date.now()): number {
  return Math.max(0, Math.floor((unixMs - SIGNING_EPOCH_MS) * 100))
}

/**
 * Secret key for a passphrase, as Simple GCS (`app.js`) and Telemetry Dashboard derive it:
 * `mavlink20.sha256(new TextEncoder().encode(passphrase))`.
 */
export function signingKeyFromPassphrase(passphrase: string): Uint8Array {
  return sha256(new TextEncoder().encode(passphrase))
}

/**
 * First 6 bytes of SHA-256 over a 32-byte key slot followed by `data`. Upstream
 * `mavlink20.create_signature`, including its handling of keys that are not 32 bytes
 * (see `SIGNING_KEY_LENGTH`).
 */
export function createSignature(secretKey: Uint8Array, data: Uint8Array): Uint8Array {
  const input = new Uint8Array(SIGNING_KEY_LENGTH + data.length)
  input.set(secretKey, 0)
  input.set(data, SIGNING_KEY_LENGTH)
  return sha256(input).slice(0, 6)
}

/** Upstream `unpackUint48LE`, through BigInt as upstream does. */
function readUint48(bytes: Uint8Array, offset: number): number {
  let value = 0n
  for (let i = 5; i >= 0; i--) value = (value << 8n) | BigInt(bytes[offset + i]!)
  return Number(value)
}

/** Upstream `packUint48LE(BigInt(timestamp))`: the low 48 bits (BigInt throws for a non-integer). */
function writeUint48(bytes: Uint8Array, offset: number, timestamp: number): void {
  const value = BigInt(timestamp)
  for (let i = 0; i < 6; i++) bytes[offset + i] = Number((value >> BigInt(8 * i)) & 0xffn)
}

export interface SigningOptions {
  /** Secret key, e.g. from `signingKeyFromPassphrase`: 32 bytes (other lengths as upstream, see `SIGNING_KEY_LENGTH`). */
  readonly secretKey: Uint8Array
  /** Link id written into outgoing signatures. Default 0. */
  readonly linkId?: number
  /** Initial timestamp. Default: `signingTimestamp()` (now), as upstream. */
  readonly timestamp?: number
  /**
   * Upstream `allow_unsigned_callback`: called for unsigned frames and frames failing verification;
   * returning true delivers the frame anyway. Without it such frames are refused.
   */
  readonly allowUnsigned?: (header: FrameHeader) => boolean
}

/** Upstream's signing counters. */
export interface SigningStats {
  /** Signed frames checked (`sig_count`). */
  readonly signedFrames: number
  /** `goodsig_count`. */
  readonly goodSignatures: number
  /** `badsig_count`: replayed, stale and wrongly signed frames. */
  readonly badSignatures: number
  /** `unsigned_count`: frames `allowUnsigned` let through. */
  readonly acceptedUnsigned: number
  /** `reject_count`: frames `allowUnsigned` refused. Not counted when there is no `allowUnsigned`, as upstream. */
  readonly rejected: number
}

/**
 * Signing state shared by an encoder (outgoing signatures, timestamp) and a parser (verification,
 * per-stream replay protection). Upstream `MAVLinkSigning`; a parser or encoder without one is
 * upstream with an empty `secret_key` and `sign_outgoing` false.
 */
export class MavlinkSigning {
  readonly secretKey: Uint8Array
  /** Upstream `link_id`. */
  linkId: number
  /** Timestamp of the next outgoing signature; also the reference for accepting new streams. */
  timestamp: number
  private readonly allowUnsigned: ((header: FrameHeader) => boolean) | undefined
  private readonly streams = new Map<string, number>()
  private readonly counts = { signedFrames: 0, goodSignatures: 0, badSignatures: 0, acceptedUnsigned: 0, rejected: 0 }

  constructor(options: SigningOptions) {
    // Upstream treats an empty key as "signing off", which here is having no MavlinkSigning.
    if (options.secretKey.length === 0) throw new RangeError('MAVLink signing needs a secret key; omit signing to turn it off')
    this.secretKey = Uint8Array.from(options.secretKey)
    this.linkId = options.linkId ?? 0
    this.timestamp = options.timestamp ?? signingTimestamp()
    this.allowUnsigned = options.allowUnsigned
  }

  get stats(): SigningStats {
    return { ...this.counts }
  }

  /** Last accepted timestamp per stream, keyed `linkId,systemId,componentId` (upstream `stream_timestamps`). */
  get streamTimestamps(): ReadonlyMap<string, number> {
    return this.streams
  }

  /**
   * Appends a signature block to `unsigned`, a complete frame (SIGNED flag already set) without
   * one, and advances the timestamp by one. Upstream `sign_packet`.
   */
  sign(unsigned: Uint8Array): Uint8Array {
    const frame = new Uint8Array(unsigned.length + SIGNATURE_BLOCK_LENGTH)
    frame.set(unsigned)
    frame[unsigned.length] = this.linkId
    writeUint48(frame, unsigned.length + 1, this.timestamp)
    frame.set(createSignature(this.secretKey, frame.subarray(0, unsigned.length + 7)), unsigned.length + 7)
    this.timestamp += 1
    return frame
  }

  /**
   * Checks a complete received frame whose checksum is valid: a signed frame (`signed` true) is
   * verified, and a failing or unsigned one is offered to `allowUnsigned`. Returns `'verified'`,
   * `'allowed'` (let through by `allowUnsigned`) or why the frame must be refused.
   */
  check(frame: Uint8Array, header: FrameHeader, signed: boolean): 'verified' | 'allowed' | SignatureRejection {
    let rejection: SignatureRejection = 'unsigned'
    if (signed) {
      this.counts.signedFrames++
      const verdict = this.verify(frame, header)
      if (verdict === null) {
        this.counts.goodSignatures++
        return 'verified'
      }
      this.counts.badSignatures++
      rejection = verdict
    }
    if (this.allowUnsigned === undefined) return rejection
    if (this.allowUnsigned(header)) {
      this.counts.acceptedUnsigned++
      return 'allowed'
    }
    this.counts.rejected++
    return rejection
  }

  /** Upstream `check_signature`: null when the signature is good. */
  private verify(frame: Uint8Array, header: FrameHeader): Exclude<SignatureRejection, 'unsigned'> | null {
    const { linkId, timestamp } = readSignatureBlock(frame)
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
