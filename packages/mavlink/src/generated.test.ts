// The checked-in `src/generated/` must be exactly what the generator produces from `definitions/`:
// edit the generator or the XML, then run `npm run generate` (in packages/mavlink).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadDialect, parseFieldType, wireOrder } from '../scripts/definitions.js'
import { camelCase, DEFINITIONS_DIR, GENERATED_DIR, generateSources, pascalCase, ROOT_DEFINITION } from '../scripts/emit.js'
import { decodeEntities, parseXml, textContent } from '../scripts/xml.js'

describe('generator', () => {
  it('regenerating produces no diff', async () => {
    const sources = await generateSources()
    expect([...sources.keys()].sort()).toEqual(['enums.ts', 'messages.ts', 'table.ts'])
    for (const [file, contents] of sources) {
      expect(
        readFileSync(join(GENERATED_DIR, file), 'utf8') === contents,
        `src/generated/${file} is stale: run npm run generate`
      ).toBe(true)
    }
  }, 30_000)

  it('reads the dialect upstream mavlink.js was generated from: all.xml and its includes', () => {
    const dialect = loadDialect(DEFINITIONS_DIR, ROOT_DEFINITION)
    // The same files as the "Generated from" line of upstream's mavlink.js (in include order here).
    expect([...dialect.files].sort()).toEqual(
      [
        'all.xml',
        'ardupilotmega.xml',
        'ASLUAV.xml',
        'common.xml',
        'development.xml',
        'icarous.xml',
        'minimal.xml',
        'python_array_test.xml',
        'standard.xml',
        'test.xml',
        'ualberta.xml',
        'uAvionix.xml',
        'loweheiser.xml',
        'storm32.xml',
        'AVSSUAS.xml',
        'cubepilot.xml',
        'csAirLink.xml'
      ].sort()
    )
    expect(dialect.messages).toHaveLength(347)
    expect(dialect.enums).toHaveLength(205)
    // ardupilotmega.xml extends MAV_CMD from common.xml.
    const command = dialect.enums.find((e) => e.name === 'MAV_CMD')
    expect(command?.entries.some((e) => e.name === 'MAV_CMD_NAV_WAYPOINT')).toBe(true)
    expect(command?.entries.some((e) => e.name === 'MAV_CMD_DO_SEND_BANNER')).toBe(true)
    const heartbeat = dialect.messages.find((m) => m.name === 'HEARTBEAT')
    expect(heartbeat).toMatchObject({ id: 0, crcExtra: 50, baseLength: 9, length: 9 })
  })

  it('orders fields for the wire by element size, extensions last', () => {
    const fields = [
      { name: 'a', type: 'uint8_t', extension: false },
      { name: 'b', type: 'uint32_t', extension: false },
      { name: 'c', type: 'uint8_t', extension: false },
      { name: 'd', type: 'double', extension: true },
      { name: 'e', type: 'uint16_t', extension: false }
    ] as const
    expect(wireOrder(fields).map((f) => f.name)).toEqual(['b', 'e', 'a', 'c', 'd'])
  })

  it('parses field types and names', () => {
    expect(parseFieldType('uint8_t[4]')).toEqual({ type: 'uint8_t', arrayLength: 4 })
    expect(parseFieldType('uint8_t_mavlink_version')).toEqual({ type: 'uint8_t', arrayLength: 0 })
    expect(parseFieldType('char[50]')).toEqual({ type: 'char', arrayLength: 50 })
    expect(() => parseFieldType('uint128_t')).toThrow(/Unsupported/)
    expect(camelCase('time_boot_ms')).toBe('timeBootMs')
    expect(camelCase('Vcc')).toBe('vcc')
    expect(camelCase('EAS2TAS')).toBe('eas2tas')
    expect(camelCase('omegaIx')).toBe('omegaIx')
    expect(pascalCase('GPS2_RAW')).toBe('Gps2Raw')
  })

  it('parses the XML the definitions use and rejects what it does not understand', () => {
    const root = parseXml('<?xml version="1.0"?>\n<!-- c --><a x="1" y=\'&lt;2&gt;\'><b/>t &amp; <c>u</c></a>')
    expect(root.name).toBe('a')
    expect(root.attributes.get('y')).toBe('<2>')
    expect(textContent(root)).toBe('t & u')
    expect(decodeEntities('&#65;&#x42;')).toBe('AB')
    expect(() => parseXml('<a><b></a>')).toThrow(/closes/)
    expect(() => parseXml('<a><![CDATA[x]]></a>')).toThrow(/not supported/)
    expect(() => parseXml('<a>&nbsp;</a>')).toThrow(/entity/)
    expect(() => parseXml('<a></a><b></b>')).toThrow(/root/)
  })
})
