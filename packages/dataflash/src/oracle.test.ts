/**
 * Oracle test: compare against the upstream JsDataflashParser on real logs.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { DataflashLog } from './log.js'
import type { Column } from './decode.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = join(here, '..', 'test-fixtures')
const upstreamPath = join(here, '..', '..', '..', 'upstream', 'modules', 'JsDataflashParser', 'parser.js')

/** Minimal typing of the upstream parser surface we exercise. */
interface UpstreamMessageType {
  expressions: string[]
  instances?: Record<string, string>
}
interface UpstreamParser {
  processData(buffer: ArrayBuffer, msgs: string[]): unknown
  messageTypes: Record<string, UpstreamMessageType>
  messages: Record<string, Record<string, unknown>>
  get(name: string, field?: string): unknown
  get_instance(name: string, instance: string, field?: string): unknown
  parseAtOffset(name: string): void
  extractStartTime(): Date | undefined
}
type UpstreamCtor = new (sendPostMessage: boolean) => UpstreamParser

async function loadUpstream(): Promise<UpstreamCtor> {
  // parser.js registers a Worker message listener at module scope.
  const g = globalThis as unknown as Record<string, unknown>
  g['self'] ??= { addEventListener: () => undefined, postMessage: () => undefined }
  const mod = (await import(/* @vite-ignore */ upstreamPath)) as { default: UpstreamCtor }
  return mod.default
}

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

function expectColumnEqual(mine: Column | undefined, theirs: unknown, label: string): void {
  expect(mine, label).toBeDefined()
  if (mine === undefined) return
  const other = theirs as ArrayLike<unknown>
  expect(other, label).toBeDefined()
  expect(mine.length, `${label} length`).toBe(other.length)
  for (let i = 0; i < mine.length; i++) {
    const a = mine[i]
    const b = other[i]
    if (a instanceof Int16Array) {
      expect(Array.from(a), `${label}[${i}]`).toEqual(b)
    } else if (!Object.is(a, b) && !(typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b))) {
      // Fail with context on the first mismatch.
      expect(a, `${label}[${i}]`).toBe(b)
    }
  }
}

describe.each(['copter-sitl.bin', 'copter-files.bin'])('oracle: %s', (file) => {
  let Upstream: UpstreamCtor
  let up: UpstreamParser
  let log: DataflashLog
  const silence = (): (() => void) => {
    const orig = console.log
    console.log = () => undefined
    return () => {
      console.log = orig
    }
  }

  beforeAll(async () => {
    Upstream = await loadUpstream()
    const raw = readFileSync(join(fixtures, file))
    const restore = silence()
    try {
      up = new Upstream(false)
      up.processData(toArrayBuffer(raw), [])
    } finally {
      restore()
    }
    log = DataflashLog.parse(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength))
  })

  it('finds the same message types, fields and instances', () => {
    const upstreamNames = Object.keys(up.messageTypes)
      .filter((n) => !n.includes('['))
      .sort()
    expect([...log.messageTypes().keys()].sort()).toEqual(upstreamNames)
    expect(upstreamNames.length).toBeGreaterThan(30)
    for (const name of upstreamNames) {
      const theirs = up.messageTypes[name] as UpstreamMessageType
      const mine = log.messageType(name)
      expect(mine, name).toBeDefined()
      if (mine === undefined) continue
      expect([...mine.fieldNames], name).toEqual(theirs.expressions)
      const theirInstances = theirs.instances === undefined ? [] : Object.keys(theirs.instances).map(Number)
      expect([...log.instances(name)], `${name} instances`).toEqual(theirInstances)
    }
    expect(log.instances('IMU').length).toBeGreaterThan(1)
  })

  it('decodes every column of every message identically', () => {
    for (const [name, info] of log.messageTypes()) {
      const instances = log.instances(name)
      for (const field of info.fieldNames) {
        if (instances.length === 0) {
          expectColumnEqual(log.get(name, field), up.get(name, field), `${name}.${field}`)
        } else {
          for (const inst of instances) {
            expectColumnEqual(
              log.getInstance(name, inst, field),
              up.get_instance(name, String(inst), field),
              `${name}[${inst}].${field}`
            )
          }
        }
      }
    }
  })

  it('matches parameters (last value wins)', () => {
    const names = up.get('PARM', 'Name') as string[]
    const values = up.get('PARM', 'Value') as Float64Array
    const expected = new Map<string, number>()
    for (let i = 0; i < names.length; i++) expected.set(names[i] as string, values[i] as number)
    expect(log.params()).toEqual(expected)
    expect(expected.size).toBeGreaterThan(100)
  })

  it('matches mode names and start time', () => {
    const restore = silence()
    try {
      up.parseAtOffset('MSG')
      up.parseAtOffset('MODE')
    } finally {
      restore()
    }
    const theirs = up.messages['MODE']?.['asText'] as string[]
    expect(log.modes().map((m) => m.name)).toEqual(theirs)
    expect(log.vehicleType()).toBe('copter')
    const upStart = up.extractStartTime()
    const myStart = log.startTime()
    expect(myStart?.getTime()).toBe(upStart?.getTime())
    if (file === 'copter-sitl.bin') {
      expect(myStart).toBeInstanceOf(Date)
      expect(myStart?.getUTCFullYear()).toBeGreaterThanOrEqual(2024)
    }
  })

  it('reassembles embedded files', () => {
    const files = log.files()
    if (file === 'copter-files.bin') {
      expect(files.size).toBeGreaterThan(0)
      const uarts = files.get('@SYS/uarts.txt')
      expect(uarts).toBeDefined()
      expect(new TextDecoder().decode(uarts)).toMatch(/UART/i)
    } else {
      expect(files.size).toBe(0)
    }
  })
})
