// The name and instance tables must agree with the XML the package was generated from, for every
// message (including those newer than upstream's mavlink.js, which the oracle tests cannot cover).
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
    for (const m of xml.matchAll(/<message id="\d+" name="([A-Z0-9_]+)"[^>]*>([\s\S]*?)<\/message>/g)) {
      const message: XmlMessage = { fields: [], instance: undefined }
      for (const f of m[2]!.matchAll(/<field ([^>]*)>/g)) {
        const name = /name="([^"]+)"/.exec(f[1]!)![1]!
        message.fields.push(name)
        if (/instance="true"/.test(f[1]!)) message.instance = name
      }
      messages.set(m[1]!, message)
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
