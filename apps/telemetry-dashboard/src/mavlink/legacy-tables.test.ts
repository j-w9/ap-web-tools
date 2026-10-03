// The name and instance tables must agree with the XML the package was generated from, for every
// message the package defines (the oracle tests check the same against upstream's mavlink.js).
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ALL_MESSAGES } from '@apwt/mavlink'
import { describe, expect, it } from 'vitest'
import { legacyMessageInfo } from './legacy-message.js'

const DEFINITIONS = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../packages/mavlink/definitions')

interface XmlMessage {
  readonly fields: string[]
  instance: string | undefined
}

function readXml(): Map<string, XmlMessage> {
  const messages = new Map<string, XmlMessage>()
  for (const file of readdirSync(DEFINITIONS).filter((f) => f.endsWith('.xml'))) {
    const xml = readFileSync(resolve(DEFINITIONS, file), 'utf8').replace(/<!--[\s\S]*?-->/g, '')
    for (const m of xml.matchAll(/<message ([^>]*)>([\s\S]*?)<\/message>/g)) {
      const name = /name="([A-Z0-9_]+)"/.exec(m[1]!)?.[1]
      if (name === undefined) continue
      const message: XmlMessage = { fields: [], instance: undefined }
      for (const f of m[2]!.matchAll(/<field ([^>]*)>/g)) {
        const fieldName = /name="([^"]+)"/.exec(f[1]!)![1]!
        message.fields.push(fieldName)
        if (/instance="true"/.test(f[1]!)) message.instance = fieldName
      }
      messages.set(name, message)
    }
  }
  return messages
}

describe('legacy tables', () => {
  const xml = readXml()
  it('gives every field of every message its XML name and the XML instance field', () => {
    for (const descriptor of ALL_MESSAGES) {
      const expected = xml.get(descriptor.name)
      expect(expected, descriptor.name).toBeDefined()
      const info = legacyMessageInfo(descriptor)
      expect(info.fieldnames, descriptor.name).toEqual(expected?.fields)
      expect(info._instance_field, descriptor.name).toBe(expected?.instance)
    }
  })
})
