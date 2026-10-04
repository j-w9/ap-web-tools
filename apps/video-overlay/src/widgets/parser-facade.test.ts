import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createContext, runInContext } from 'node:vm'
import { beforeAll, describe, expect, it } from 'vitest'
import { buildSyntheticLog, LogWriter } from '@apwt/dataflash/testing'
import { DataflashParserFacade } from './parser-facade.js'
import { DEFAULT_CUSTOM_HTML, SANDBOX_DOCUMENT } from './documents.js'
import { parseUpstream, readFixture, repoRoot, upstreamDir, type UpstreamParser } from '../test-utils/upstream.js'

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

/** The fixtures, and a synthetic log with every field type (int16[32] included) and FMTU units. */
function logBuffer(file: string): ArrayBuffer {
  if (file !== 'synthetic') return readFixture(file)
  const bytes = buildSyntheticLog()
  return bytes.slice().buffer
}

describe.each(['copter-sitl.bin', 'copter-files.bin', 'synthetic'])('log facade for widget scripts: %s', (file) => {
  let up: UpstreamParser
  let mine: DataflashParserFacade

  beforeAll(async () => {
    up = await parseUpstream(logBuffer(file))
    mine = new DataflashParserFacade()
    mine.processData(logBuffer(file), [])
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

  it('returns undefined where upstream throws for an instanced message read without an instance (proven bug #119)', () => {
    // Upstream's result for the bug input; proofs/video-overlay reproduces it on its own.
    expect(() => up.get('IMU', 'GyrX')).toThrow(TypeError)
    expect(() => up.get('IMU')).toThrow(TypeError)
    expect(() => up.get_instance('IMU', undefined, 'GyrX')).toThrow(TypeError)
    // Corrected: the same `undefined` as upstream's other no-data paths.
    expect(mine.get('IMU', 'GyrX')).toBeUndefined()
    expect(mine.get('IMU')).toBeUndefined()
    expect(mine.get_instance('IMU', undefined, 'GyrX')).toBeUndefined()
  })

  it('gives the same start time', () => {
    expect(mine.extractStartTime()?.getTime()).toBe(up.extractStartTime()?.getTime())
  })

  it('builds messageTypes as upstream: units, multipliers, complexFields, key order; µ for 1e-6 (proven bug)', () => {
    expect(Object.keys(mine.messageTypes)).toEqual(Object.keys(up.messageTypes))
    let relabelled = 0
    for (const [name, info] of Object.entries(up.messageTypes)) {
      const ours = mine.messageTypes[name]
      expect(ours === undefined ? undefined : Object.keys(ours), name).toEqual(Object.keys(info))
      // Upstream labels multiplier 1e-6 with `n` (nano); the port with `µ` (js-dataflash-parser.md #2).
      // Every other value is upstream's exactly.
      const expected = structuredClone(info) as { complexFields?: Record<string, { units: string; multiplier: unknown }> }
      for (const field of Object.values(expected.complexFields ?? {})) {
        if (field.multiplier !== 0.000001) continue
        expect(field.units.startsWith('n'), `${name} upstream`).toBe(true)
        field.units = '\u00b5' + field.units.slice(1)
        relabelled++
      }
      expect(structuredClone(ours), name).toEqual(expected)
    }
    expect(relabelled).toBeGreaterThan(0)
    if (up.messageTypes['IMU'] !== undefined) {
      const timeUs = (t: unknown) => (t as { complexFields: Record<string, { units: string }> }).complexFields['TimeUS']?.units
      expect(timeUs(up.messageTypes['IMU'])).toBe('ns')
      expect(timeUs(mine.messageTypes['IMU'])).toBe('µs')
    }
  })

  it('returns every field of every message and instance as upstream, with the same array types', () => {
    const upTypes = up.messageTypes as Record<string, { expressions: string[]; instances?: Record<string, string> }>
    let compared = 0
    for (const [name, info] of Object.entries(upTypes)) {
      if (name.includes('[')) continue
      const instances = info.instances === undefined ? [null] : Object.keys(info.instances)
      for (const inst of instances) {
        for (const field of [...info.expressions, undefined]) {
          const call = (p: { get_instance(n: string, i: unknown, f?: string): unknown }) => {
            try {
              return { value: p.get_instance(name, inst, field) }
            } catch (e) {
              return { threw: String(e) }
            }
          }
          const theirs = call(up)
          const ours = call(mine)
          const label = `${name}[${String(inst)}].${String(field)}`
          expect(typeName(ours), label).toEqual(typeName(theirs))
          expect(structuredClone(ours), label).toEqual(structuredClone(theirs))
          compared++
        }
      }
    }
    expect(compared).toBeGreaterThan(100)
  })

  it('matches instances as property keys, as upstream `instance in InstancesOffsetArray`', () => {
    for (const inst of ['0', '00', 0.0, '1.0', true, [0], 99]) {
      expect(typeName({ value: mine.get_instance('GPS', inst, 'Spd') }), String(inst)).toEqual(
        typeName({ value: up.get_instance('GPS', inst, 'Spd') })
      )
    }
    expect(mine.get(['ATT'], 'Roll')).toEqual(up.get(['ATT'] as unknown as string, 'Roll'))
  })

  it('returns a fresh copy on every call, so a script may modify what it gets', () => {
    const first = mine.get('ATT', 'Roll') as Float64Array
    first.fill(0)
    expect(mine.get('ATT', 'Roll')).toEqual(up.get('ATT', 'Roll'))
  })

  it('reports the same stats', () => {
    expect(structuredClone(mine.stats())).toEqual(structuredClone((up as unknown as { stats(): unknown }).stats()))
  })
})

/** Constructor name of a result (or of each value of an all-fields result), and "threw". */
function typeName(result: { value?: unknown; threw?: string }): unknown {
  if ('threw' in result) return 'threw'
  const value = result.value
  if (value === undefined) return 'undefined'
  if (ArrayBuffer.isView(value) || Array.isArray(value)) return describeColumn(value)
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, describeColumn(v)]))
}

function describeColumn(value: unknown): string {
  if (Array.isArray(value)) return `Array<${Array.isArray(value[0]) ? 'Array' : typeof value[0]}>`
  return (value as object).constructor.name
}

describe('log facade realm', () => {
  it('creates results in the calling document realm, as a module imported there would', () => {
    const realm = createContext({}) as Record<string, unknown>
    const vmGlobal = runInContext('globalThis', realm) as typeof globalThis
    const Facade = DataflashParserFacade.forRealm(vmGlobal)
    const log = new Facade()
    log.processData(readFixture('copter-sitl.bin'), [])
    expect(log.get('ATT', 'Roll')).toBeInstanceOf(vmGlobal.Float64Array)
    expect(log.get('PARM', 'Name')).toBeInstanceOf(vmGlobal.Array)
    expect(log.get('ATT')).toBeInstanceOf(vmGlobal.Object)
    expect(log.messageTypes).toBeInstanceOf(vmGlobal.Object)
    const start = log.extractStartTime()
    if (start !== undefined) expect(start).toBeInstanceOf(vmGlobal.Date)
  })
})

describe('widget documents', () => {
  it('are upstream sandbox page and default custom HTML, unchanged', () => {
    expect(SANDBOX_DOCUMENT).toBe(readFileSync(join(upstreamDir, 'VideoOverlay', 'Widgets', 'SandBox.html'), 'utf8'))
    const custom = readFileSync(join(upstreamDir, 'VideoOverlay', 'Widgets', 'CustomHTML.js'), 'utf8')
    expect(DEFAULT_CUSTOM_HTML).toBe(/options\.custom_HTML = `([\s\S]*?)`\n/.exec(custom)?.[1])
  })

  it('import the parser module the site serves at the path upstream imports from', () => {
    const shim = readFileSync(join(repoRoot, 'public', 'apps', 'modules', 'JsDataflashParser', 'parser.js'), 'utf8')
    expect(shim).toContain('export default window.parent.VideoOverlayDataflashParser.forRealm(window)')
    // apps/video-overlay/ + '../modules/JsDataflashParser/parser.js'
    expect(new URL('../modules/JsDataflashParser/parser.js', 'https://host/apps/video-overlay/').pathname).toBe(
      '/apps/modules/JsDataflashParser/parser.js'
    )
  })
})

describe('log facade for widget scripts: FMTU for an undefined type (proven parser bug, js-dataflash-parser.md #3)', () => {
  function bytes(withBadRecord: boolean): ArrayBuffer {
    const w = new LogWriter()
    w.defineFormat(0x80, 'FMT', 'BBnNZ', 'Type,Length,Name,Format,Columns')
    w.defineFormat(0xb1, 'FMTU', 'QBNN', 'TimeUS,FmtType,UnitIds,MultIds')
    w.defineFormat(30, 'IMU', 'QBf', 'TimeUS,I,T')
    if (withBadRecord) w.write('FMTU', [0, 99, '-#', '--'])
    w.write('FMTU', [0, 30, 's#O', 'F--'])
    for (let i = 0; i < 4; i++) w.write('IMU', [i, i % 2, 20 + i])
    return w.toBytes().slice().buffer
  }

  it('skips the record where upstream abandons every later FMTU', async () => {
    const up = await parseUpstream(bytes(true))
    const mine = new DataflashParserFacade()
    mine.processData(bytes(true), [])
    // Upstream: the IMU FMTU after the bad record is never applied.
    expect(up.messageTypes['IMU']?.instances).toBeUndefined()
    expect(up.messageTypes['IMU[0]']).toBeUndefined()
    // Port: the same messageTypes as upstream (µ for 1e-6 aside) for the log without the bad record.
    const clean = await parseUpstream(bytes(false))
    expect(mine.messageTypes['IMU']?.instances).toEqual({ 0: 'IMU[0]', 1: 'IMU[1]' })
    expect(Object.keys(mine.messageTypes)).toEqual(Object.keys(clean.messageTypes))
    const expected = structuredClone(clean.messageTypes) as unknown as Record<
      string,
      { complexFields: Record<string, { units: string }> }
    >
    for (const name of ['IMU', 'IMU[0]', 'IMU[1]']) expected[name]!.complexFields['TimeUS']!.units = 'µs'
    expect(structuredClone(mine.messageTypes)).toEqual(expected)
    expect(mine.get_instance('IMU', 1, 'T')).toEqual(clean.get_instance('IMU', 1, 'T'))
  })
})
