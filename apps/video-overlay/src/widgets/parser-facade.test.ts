import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { DataflashParserFacade } from './parser-facade.js'
import { DEFAULT_CUSTOM_HTML, SANDBOX_DOCUMENT } from './documents.js'
import { parseUpstream, readFixture, upstreamDir, type UpstreamParser } from '../test-utils/upstream.js'

/** Compare columns element by element (NaN-safe, arrays deep). */
function expectSameColumn(mine: unknown, theirs: unknown, label: string) {
  if (theirs === undefined) {
    expect(mine, label).toBeUndefined()
    return
  }
  expect(mine, label).toBeDefined()
  const a = mine as ArrayLike<unknown>
  const b = theirs as ArrayLike<unknown>
  expect(a.length, label).toBe(b.length)
  expect(
    Array.from(a, (v) => (ArrayBuffer.isView(v) ? Array.from(v as Int16Array) : v)),
    label
  ).toEqual(Array.from(b))
}

describe.each(['copter-sitl.bin', 'copter-files.bin'])('log facade for widget scripts: %s', (file) => {
  let up: UpstreamParser
  let mine: DataflashParserFacade

  beforeAll(async () => {
    up = await parseUpstream(readFixture(file))
    mine = new DataflashParserFacade()
    mine.processData(readFixture(file), [])
  })

  it('lists the same message types, fields and instances', () => {
    expect(Object.keys(mine.messageTypes).sort()).toEqual(Object.keys(up.messageTypes).sort())
    for (const [name, info] of Object.entries(up.messageTypes)) {
      expect(mine.messageTypes[name]?.expressions, name).toEqual(info.expressions)
      expect(mine.messageTypes[name]?.instances, name).toEqual(info.instances)
    }
  })

  it('returns the same columns from get and get_instance, as widget scripts call them', () => {
    // The fields the default widgets read, plus every field of a few messages.
    const calls: [string, number | null, string | undefined][] = [
      ['ATT', null, 'TimeUS'],
      ['ATT', null, 'Roll'],
      ['ATT', null, 'Pitch'],
      ['CTUN', null, 'ThO'],
      ['POS', null, 'RelHomeAlt'],
      ['BAT', 0, 'Volt'],
      ['BAT', 0, 'Curr'],
      ['GPS', 0, 'Spd'],
      ['GPS', 0, 'TimeUS'],
      ['GPS', 7, 'Spd'],
      ['NOPE', null, 'X'],
      ['ATT', null, 'Nope'],
      ['PARM', null, 'Name'],
      ['MSG', null, 'Message']
    ]
    for (const [name, inst, field] of calls) {
      const label = `${name}[${String(inst)}].${String(field)}`
      expectSameColumn(
        inst === null ? mine.get(name, field) : mine.get_instance(name, inst, field),
        inst === null ? up.get(name, field) : up.get_instance(name, inst, field),
        label
      )
    }
    const att = mine.get('ATT') as Record<string, unknown>
    const upAtt = up.get('ATT') as Record<string, unknown>
    expect(Object.keys(att)).toEqual(Object.keys(upAtt))
    for (const key of Object.keys(upAtt)) expectSameColumn(att[key], upAtt[key], `ATT.${key}`)
  })

  it('throws like upstream when an instanced message is read without an instance', () => {
    expect(() => up.get('IMU', 'GyrX')).toThrow(TypeError)
    expect(() => mine.get('IMU', 'GyrX')).toThrow(TypeError)
  })

  it('gives the same start time', () => {
    expect(mine.extractStartTime()?.getTime()).toBe(up.extractStartTime()?.getTime())
  })
})

describe('widget documents', () => {
  const PARSER_IMPORT =
    "const import_done = import(window.parent.location.href + '../modules/JsDataflashParser/parser.js').then((mod) => { DataflashParser = mod.default })"

  it('are upstream sandbox page and default custom HTML with only the parser import swapped', () => {
    const sandbox = readFileSync(join(upstreamDir, 'VideoOverlay', 'Widgets', 'SandBox.html'), 'utf8')
    const [before, after] = sandbox.split(PARSER_IMPORT)
    expect(after).toBeDefined()
    expect(SANDBOX_DOCUMENT.startsWith(before!)).toBe(true)
    expect(SANDBOX_DOCUMENT.endsWith(after!)).toBe(true)
    expect(SANDBOX_DOCUMENT).toContain('window.parent.VideoOverlayDataflashParser')

    const custom = readFileSync(join(upstreamDir, 'VideoOverlay', 'Widgets', 'CustomHTML.js'), 'utf8')
    const original = /options\.custom_HTML = `([\s\S]*?)`\n/.exec(custom)?.[1]
    expect(original).toBeDefined()
    expect(DEFAULT_CUSTOM_HTML.replace(/\/\/ Port:.*\n\s*const import_done = .*/, PARSER_IMPORT)).toBe(original)
  })
})
