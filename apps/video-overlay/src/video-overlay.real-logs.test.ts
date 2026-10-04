/**
 * Real-log oracle, run only when `APWT_REAL_LOGS` names a directory of DataFlash `.bin` logs (the
 * logs are never part of the repository). For every log, upstream VideoOverlay (its log functions
 * and the upstream JsDataflashParser that widget scripts receive) and the port read the same bytes,
 * and every output is compared as the committed oracle tests compare it (`log-info.test.ts`,
 * `parser-facade.test.ts`), with the same documented differences.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { DateTime } from 'luxon'
import { DataflashLog } from '@apwt/dataflash'
import { defaultOffsetS, flightTimeText, logDateText, logDurationText } from './analysis/log-info.js'
import { timestampBounds } from './analysis/log-scan.js'
import { DataflashParserFacade } from './widgets/parser-facade.js'
import { parseUpstream, toArrayBuffer, upstreamLogFunctions, type UpstreamParser } from './test-utils/upstream.js'

const dir = process.env['APWT_REAL_LOGS']
const files = dir
  ? readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.bin'))
      .sort()
  : []
const TIMEOUT = 900_000

/** First difference between two values (Object.is for numbers, deep for arrays and objects), or undefined. */
function firstDifference(mine: unknown, theirs: unknown, path = ''): string | undefined {
  if (Object.is(mine, theirs)) return undefined
  const isList = (v: unknown): v is ArrayLike<unknown> => Array.isArray(v) || ArrayBuffer.isView(v)
  if (isList(mine) && isList(theirs)) {
    if (mine.length !== theirs.length) return `${path}: length ${mine.length} vs ${theirs.length}`
    for (let i = 0; i < mine.length; i++) {
      const d = firstDifference(mine[i], theirs[i], `${path}[${i}]`)
      if (d !== undefined) return d
    }
    return undefined
  }
  if (
    typeof mine === 'object' &&
    mine !== null &&
    typeof theirs === 'object' &&
    theirs !== null &&
    !isList(mine) &&
    !isList(theirs)
  ) {
    const a = Object.keys(mine)
    const b = Object.keys(theirs)
    if (a.join() !== b.join()) return `${path}: keys ${a.join()} vs ${b.join()}`
    for (const k of a) {
      const d = firstDifference((mine as Record<string, unknown>)[k], (theirs as Record<string, unknown>)[k], `${path}.${k}`)
      if (d !== undefined) return d
    }
    return undefined
  }
  return `${path}: ${String(mine)} vs ${String(theirs)}`
}

/** Constructor name of a result (or of each value of an all-fields result), and "threw" (as parser-facade.test.ts). */
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

describe.skipIf(!dir)('VideoOverlay on real logs (APWT_REAL_LOGS)', () => {
  beforeAll(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
  })

  describe.each(files.length > 0 ? files : ['(no logs)'])('%s', (file) => {
    let buffer: ArrayBuffer
    let up: UpstreamParser
    let mine: DataflashParserFacade

    beforeAll(async () => {
      buffer = toArrayBuffer(readFileSync(join(dir!, file)))
      up = await parseUpstream(buffer.slice(0))
      mine = new DataflashParserFacade()
      mine.processData(buffer.slice(0), [])
    }, TIMEOUT)

    it('log facts: flight time, duration, default offset and date (log-info.test.ts)', () => {
      const fns = upstreamLogFunctions(up)
      const log = DataflashLog.parse(buffer)
      const bounds = timestampBounds(buffer)
      expect(flightTimeText(log)).toBe(fns.getFlightTime())
      const upDuration = fns.getLogDurationUS()
      expect(bounds === undefined ? undefined : bounds.lastTimeUs - bounds.firstTimeUs).toBe(upDuration)
      // Upstream's duration text, from its own duration (VideoOverlay.js log input handler).
      const upDurationText = upDuration === undefined ? undefined : logDurationText({ firstTimeUs: 0, lastTimeUs: upDuration })
      expect(logDurationText(bounds)).toBe(upDurationText)
      expect(defaultOffsetS(bounds)).toBe(fns.defaultOffset())
      expect(logDateText(log.startTime())).toBe(
        DateTime.fromJSDate(up.extractStartTime() as Date).toFormat('dd/MM/yyyy hh:mm:ss a')
      )
    })

    it('widget log object: message types, fields and instances', () => {
      expect(Object.keys(mine.messageTypes).sort()).toEqual(Object.keys(up.messageTypes).sort())
      for (const [name, info] of Object.entries(up.messageTypes)) {
        expect(mine.messageTypes[name]?.expressions, name).toEqual(info.expressions)
        expect(mine.messageTypes[name]?.instances, name).toEqual(info.instances)
      }
    })

    it('widget log object: messageTypes as upstream, µ for 1e-6 (proven bug, js-dataflash-parser.md #2)', () => {
      expect(Object.keys(mine.messageTypes)).toEqual(Object.keys(up.messageTypes))
      for (const [name, info] of Object.entries(up.messageTypes)) {
        const ours = mine.messageTypes[name]
        expect(ours === undefined ? undefined : Object.keys(ours), name).toEqual(Object.keys(info))
        const expected = structuredClone(info) as { complexFields?: Record<string, { units: string; multiplier: unknown }> }
        for (const field of Object.values(expected.complexFields ?? {})) {
          if (field.multiplier !== 0.000001) continue
          expect(field.units.startsWith('n'), `${name} upstream`).toBe(true)
          field.units = 'µ' + field.units.slice(1)
        }
        expect(structuredClone(ours), name).toEqual(expected)
      }
    })

    it(
      'widget log object: every field of every message and instance, with the same array types',
      () => {
        let compared = 0
        for (const [name, info] of Object.entries(up.messageTypes)) {
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
              expect(firstDifference(ours, theirs, label), label).toBeUndefined()
              compared++
            }
          }
        }
        expect(compared).toBeGreaterThan(100)
      },
      TIMEOUT
    )

    it('widget log object: get without an instance, as widget scripts call it (proven bug #119 for instanced types)', () => {
      for (const [name, info] of Object.entries(up.messageTypes)) {
        if (name.includes('[')) continue
        for (const field of [info.expressions[0], undefined]) {
          const label = `${name}.${String(field)}`
          if (info.instances !== undefined) {
            // Upstream throws a TypeError; the port returns undefined (docs/bug-proofs/video-overlay.md #119).
            expect(() => up.get(name, field), label).toThrow(TypeError)
            expect(mine.get(name, field), label).toBeUndefined()
          } else {
            expect(firstDifference(mine.get(name, field), up.get(name, field), label), label).toBeUndefined()
          }
        }
      }
    })

    it('widget log object: start time and stats', () => {
      expect(mine.extractStartTime()?.getTime()).toBe(up.extractStartTime()?.getTime())
      expect(structuredClone(mine.stats())).toEqual(structuredClone((up as unknown as { stats(): unknown }).stats()))
    })
  })
})
