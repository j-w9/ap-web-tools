/**
 * `@apwt/mavlink`: typed MAVLink 1/2 codec for the ArduPilot dialect, generated from the official
 * XML definitions (see `definitions/README.md`). Replaces upstream's pymavlink-generated
 * `modules/MAVLink/mavlink.js`.
 *
 *   const parser = new MavlinkParser({ messages: [HEARTBEAT, ATTITUDE] })
 *   for (const m of parser.push(bytes)) if (m.name === 'ATTITUDE') console.log(m.fields.roll)
 *
 *   const encoder = new MavlinkEncoder({ systemId: 255, componentId: 190 })
 *   socket.send(encoder.encode(HEARTBEAT, { type: MavType.MAV_TYPE_GCS, ... }))
 */
export * from './generated/enums.js'
export * from './generated/messages.js'
export * from './generated/table.js'
export { CRC_X25_INIT, crcAccumulate, crcX25 } from './crc.js'
export { decodePayload, type FieldValue } from './decode.js'
export { FIELD_TYPE_SIZE, type EnumObject, type FieldDescriptor, type FieldType, type MessageDescriptor } from './descriptor.js'
export {
  encodeFrame,
  encodePayload,
  MavlinkEncoder,
  MAVLINK1_HEADER_LENGTH,
  MAVLINK1_MARKER,
  MAVLINK2_HEADER_LENGTH,
  MAVLINK2_MARKER,
  truncatedLength,
  type EncodableName,
  type EncoderOptions,
  type FrameAddress,
  type Mavlink1Format,
  type Mavlink2Format
} from './encode.js'
export { enumEntries, enumName, flagNames } from './enums.js'
export type { FieldInput, FrameHeader, FrameInfo, FrameSignature, Message, MessageInput, ReceivedMessage } from './message.js'
export { MavlinkParser, type GarbageReason, type ParseEvent, type ParserOptions, type ParserStats } from './parser.js'
export { sha256 } from './sha256.js'
export {
  createSignature,
  INCOMPAT_FLAG_SIGNED,
  MavlinkSigning,
  NEW_STREAM_MAX_AGE,
  readSignatureBlock,
  SIGNATURE_BLOCK_LENGTH,
  SIGNING_EPOCH_MS,
  SIGNING_KEY_LENGTH,
  signingKeyFromPassphrase,
  signingTimestamp,
  type SignatureRejection,
  type SigningOptions,
  type SigningStats
} from './signing.js'
export { mavComponentName, mavComponents, mavlinkMessage, type MavComponentName, type MessageTableEntry } from './tables.js'
