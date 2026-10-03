/**
 * Lookup tables for tools that only frame MAVLink (Stream Stats): message id to name and
 * CRC_EXTRA, component id to `MAV_COMPONENT` name. They come from the same generated definitions as
 * the codec but do not pull in message layouts, so a bundle using only these stays small.
 */
import { enumEntries } from './enums.js'
import { MavComponent } from './generated/enums.js'
import { MESSAGE_TABLE } from './generated/table.js'

/** One `MESSAGE_TABLE` row. */
export type MessageTableEntry = (typeof MESSAGE_TABLE)[number]

/** `MAV_COMPONENT` entry name, e.g. `MAV_COMP_ID_AUTOPILOT1`. */
export type MavComponentName = keyof typeof MavComponent

/** Every `MAV_COMPONENT` entry, by ascending id. */
export function mavComponents(): readonly { readonly id: number; readonly name: MavComponentName }[] {
  return enumEntries(MavComponent).map(({ name, value }) => ({ id: value, name }))
}

let messagesById: ReadonlyMap<number, MessageTableEntry> | undefined
let componentsById: ReadonlyMap<number, MavComponentName> | undefined

/** Id, name and CRC_EXTRA of a message id, or `undefined` if the dialect has no such message. */
export function mavlinkMessage(id: number): MessageTableEntry | undefined {
  messagesById ??= new Map(MESSAGE_TABLE.map((m) => [m.id, m]))
  return messagesById.get(id)
}

/** `MAV_COMPONENT` name of a component id, or `undefined` for ids without one. */
export function mavComponentName(id: number): MavComponentName | undefined {
  componentsById ??= new Map(mavComponents().map((c) => [c.id, c.name]))
  return componentsById.get(id)
}
