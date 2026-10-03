/**
 * Reads a MAVLink dialect (an XML file and everything it includes) into a model the emitter can
 * print directly: enums merged across files, and messages with their wire layout and CRC_EXTRA
 * worked out the way pymavlink's mavgen does.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { crcX25 } from '../src/crc.js'
import { FIELD_TYPE_SIZE, type FieldType } from '../src/descriptor.js'
import { childElement, childElements, parseXml, textContent, type XmlElement } from './xml.js'

export interface EnumEntryDefinition {
  readonly name: string
  readonly value: number
  readonly description: string
  /** `MAV_CMD` parameters: index (1-7), label and description. */
  readonly params: readonly { readonly index: number; readonly label: string; readonly description: string }[]
  readonly deprecated: string | undefined
}

export interface EnumDefinition {
  readonly name: string
  readonly bitmask: boolean
  readonly description: string
  readonly entries: readonly EnumEntryDefinition[]
  readonly deprecated: string | undefined
}

export interface FieldDefinition {
  /** Name as written in the XML (snake_case); also what CRC_EXTRA is computed from. */
  readonly name: string
  readonly type: FieldType
  /** Element count for arrays, 0 for scalars. */
  readonly arrayLength: number
  readonly extension: boolean
  readonly enumName: string | undefined
  /** `display="bitmask"` on the field itself. */
  readonly displayBitmask: boolean
  readonly units: string | undefined
  readonly description: string
  /** Byte offset in the payload, after wire ordering. */
  readonly offset: number
}

export interface MessageDefinition {
  readonly id: number
  readonly name: string
  readonly description: string
  readonly deprecated: string | undefined
  readonly workInProgress: boolean
  /** Fields in XML order (extensions last, as the XML has them). */
  readonly fields: readonly FieldDefinition[]
  readonly crcExtra: number
  /** Payload length of the base (MAVLink 1) fields. */
  readonly baseLength: number
  /** Payload length including extensions. */
  readonly length: number
  readonly file: string
}

export interface Dialect {
  /** Files read, in include order. */
  readonly files: readonly string[]
  /** Sorted by name. */
  readonly enums: readonly EnumDefinition[]
  /** Sorted by id. */
  readonly messages: readonly MessageDefinition[]
}

const FIELD_TYPES = Object.keys(FIELD_TYPE_SIZE)

function isFieldType(type: string): type is FieldType {
  return FIELD_TYPES.includes(type)
}

/** Splits `uint8_t[4]` into type and length; `uint8_t_mavlink_version` is a plain `uint8_t`. */
export function parseFieldType(raw: string): { readonly type: FieldType; readonly arrayLength: number } {
  const match = /^([a-z0-9_]+?)(?:_mavlink_version)?(?:\[(\d+)\])?$/.exec(raw)
  const type = match?.[1] ?? ''
  if (!isFieldType(type)) throw new Error(`Unsupported field type ${raw}`)
  return { type, arrayLength: match?.[2] === undefined ? 0 : Number(match[2]) }
}

function attribute(element: XmlElement, name: string): string | undefined {
  return element.attributes.get(name)
}

function requiredAttribute(element: XmlElement, name: string, file: string): string {
  const value = attribute(element, name)
  if (value === undefined) throw new Error(`${file}: <${element.name}> is missing ${name}=`)
  return value
}

function description(element: XmlElement): string {
  const node = childElement(element, 'description')
  return node === undefined ? '' : textContent(node)
}

/** Text for `<deprecated>` / `<superseded>`, or undefined if neither is present. */
function deprecation(element: XmlElement): string | undefined {
  for (const tag of ['deprecated', 'superseded'] as const) {
    const node = childElement(element, tag)
    if (node === undefined) continue
    const since = attribute(node, 'since')
    const replacedBy = attribute(node, 'replaced_by')
    const parts = [tag === 'deprecated' ? 'Deprecated' : 'Superseded']
    if (since !== undefined) parts.push(`since ${since}`)
    if (replacedBy !== undefined && replacedBy !== '') parts.push(`replaced by ${replacedBy}`)
    const text = textContent(node)
    return parts.join(' ') + '.' + (text === '' ? '' : ` ${text}`)
  }
  return undefined
}

function parseInteger(text: string, context: string): number {
  const trimmed = text.trim()
  const value = /^0x[0-9a-f]+$/i.test(trimmed)
    ? parseInt(trimmed, 16)
    : /^\d+\*\*\d+$/.test(trimmed)
      ? Number(trimmed.split('**')[0]) ** Number(trimmed.split('**')[1])
      : Number(trimmed)
  if (!Number.isSafeInteger(value)) throw new Error(`${context}: unsupported value ${text}`)
  return value
}

/** CRC_EXTRA: mavgen's checksum of the message name and its base fields in wire order. */
export function computeCrcExtra(
  name: string,
  wireOrderedBaseFields: readonly { name: string; type: FieldType; arrayLength: number }[]
): number {
  const bytes: number[] = []
  const text = (s: string): void => {
    for (let i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i))
  }
  text(name + ' ')
  for (const field of wireOrderedBaseFields) {
    text(field.type + ' ')
    text(field.name + ' ')
    if (field.arrayLength > 0) bytes.push(field.arrayLength)
  }
  const crc = crcX25(Uint8Array.from(bytes))
  return (crc & 0xff) ^ (crc >> 8)
}

/**
 * Wire order: base fields sorted by element size, largest first (stable, so equal sizes keep their
 * XML order), then extension fields in XML order.
 */
export function wireOrder<F extends { readonly type: FieldType; readonly extension: boolean }>(fields: readonly F[]): F[] {
  const base = fields.filter((f) => !f.extension)
  const extensions = fields.filter((f) => f.extension)
  return [...base.sort((a, b) => FIELD_TYPE_SIZE[b.type] - FIELD_TYPE_SIZE[a.type]), ...extensions]
}

type RawField = Omit<FieldDefinition, 'offset'>

function readMessage(element: XmlElement, file: string): MessageDefinition {
  const name = requiredAttribute(element, 'name', file)
  const id = parseInteger(requiredAttribute(element, 'id', file), `${file} ${name}`)
  const rawFields: RawField[] = []
  let extension = false
  for (const child of childElements(element)) {
    if (child.name === 'extensions') {
      extension = true
    } else if (child.name === 'field') {
      const { type, arrayLength } = parseFieldType(requiredAttribute(child, 'type', file))
      rawFields.push({
        name: requiredAttribute(child, 'name', file),
        type,
        arrayLength,
        extension,
        enumName: attribute(child, 'enum'),
        displayBitmask: attribute(child, 'display') === 'bitmask',
        units: attribute(child, 'units'),
        description: textContent(child)
      })
    }
  }
  if (new Set(rawFields.map((f) => f.name)).size !== rawFields.length) throw new Error(`${file}: duplicate field in ${name}`)

  const offsets = new Map<RawField, number>()
  let offset = 0
  let baseLength = 0
  for (const field of wireOrder(rawFields)) {
    offsets.set(field, offset)
    offset += FIELD_TYPE_SIZE[field.type] * Math.max(1, field.arrayLength)
    if (!field.extension) baseLength = offset
  }
  if (offset > 255) throw new Error(`${file}: ${name} payload is ${offset} bytes`)

  return {
    id,
    name,
    description: description(element),
    deprecated: deprecation(element),
    workInProgress: childElement(element, 'wip') !== undefined,
    fields: rawFields.map((field) => ({ ...field, offset: offsets.get(field) ?? 0 })),
    crcExtra: computeCrcExtra(
      name,
      wireOrder(rawFields).filter((f) => !f.extension)
    ),
    baseLength,
    length: offset,
    file
  }
}

function readEntry(element: XmlElement, file: string, enumName: string): EnumEntryDefinition {
  const name = requiredAttribute(element, 'name', file)
  return {
    name,
    value: parseInteger(requiredAttribute(element, 'value', file), `${file} ${enumName}.${name}`),
    description: description(element),
    params: childElements(element, 'param').map((param) => ({
      index: parseInteger(requiredAttribute(param, 'index', file), `${file} ${name} param`),
      label: attribute(param, 'label') ?? '',
      description: textContent(param)
    })),
    deprecated: deprecation(element)
  }
}

interface MutableEnum {
  name: string
  bitmask: boolean
  description: string
  entries: EnumEntryDefinition[]
  deprecated: string | undefined
}

/** Loads `rootFile` from `directory`, following `<include>`s (each file read once). */
export function loadDialect(directory: string, rootFile: string): Dialect {
  const files: string[] = []
  const enums = new Map<string, MutableEnum>()
  const messages = new Map<number, MessageDefinition>()

  const visit = (file: string): void => {
    if (files.includes(file)) return
    files.push(file)
    const root = parseXml(readFileSync(join(directory, file), 'utf8'))
    if (root.name !== 'mavlink') throw new Error(`${file}: root element is <${root.name}>`)
    for (const include of childElements(root, 'include')) visit(textContent(include))

    for (const group of childElements(root, 'enums')) {
      for (const element of childElements(group, 'enum')) {
        const name = requiredAttribute(element, 'name', file)
        let target = enums.get(name)
        if (target === undefined) {
          target = { name, bitmask: false, description: '', entries: [], deprecated: undefined }
          enums.set(name, target)
        }
        if (attribute(element, 'bitmask') === 'true') target.bitmask = true
        if (target.description === '') target.description = description(element)
        target.deprecated ??= deprecation(element)
        for (const entry of childElements(element, 'entry')) {
          const parsed = readEntry(entry, file, name)
          const existing = target.entries.find((e) => e.name === parsed.name)
          if (existing === undefined) target.entries.push(parsed)
          else if (existing.value !== parsed.value) throw new Error(`${file}: ${name}.${parsed.name} redefined with a new value`)
        }
      }
    }

    for (const group of childElements(root, 'messages')) {
      for (const element of childElements(group, 'message')) {
        const message = readMessage(element, file)
        const clash = messages.get(message.id) ?? [...messages.values()].find((m) => m.name === message.name)
        if (clash !== undefined)
          throw new Error(`${file}: ${message.name} (${message.id}) clashes with ${clash.name} (${clash.id})`)
        messages.set(message.id, message)
      }
    }
  }

  visit(rootFile)
  return {
    files,
    enums: [...enums.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    messages: [...messages.values()].sort((a, b) => a.id - b.id)
  }
}
