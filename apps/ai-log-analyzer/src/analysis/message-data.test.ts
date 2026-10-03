/**
 * Oracle test: the `get` tool's JSON must equal what upstream's `window.get` uploaded, computed
 * with the upstream JsDataflashParser on the same logs.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { DataflashLog } from '@apwt/dataflash'
import { buildSyntheticLog } from '@apwt/dataflash/testing'
import { describeColumns, getMessageColumns } from './message-data.js'

interface UpstreamParser {
  processData(buffer: ArrayBuffer, msgs: string[]): unknown
  messageTypes: Record<string, object>
  get(name: string): unknown
  get_instance(name: string, instance: string): unknown
}
type UpstreamCtor = new (sendPostMessage: boolean) => UpstreamParser

const repo = resolve(__dirname, '../../../..')

async function loadUpstream(): Promise<UpstreamCtor> {
  // parser.js registers a Worker message listener at module scope.
  const g = globalThis as unknown as Record<string, unknown>
  g['self'] ??= { addEventListener: () => undefined, postMessage: () => undefined }
  const mod = (await import(/* @vite-ignore */ resolve(repo, 'upstream/modules/JsDataflashParser/parser.js'))) as {
    default: UpstreamCtor
  }
  return mod.default
}

function parseUpstream(Upstream: UpstreamCtor, bytes: Uint8Array): UpstreamParser {
  const log = console.log
  console.log = () => undefined
  try {
    const up = new Upstream(false)
    up.processData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, [])
    return up
  } finally {
    console.log = log
  }
}

/** Upstream `window.get` (logAnalyzer.js) up to the upload: the JSON text, or undefined. */
function upstreamGet(up: UpstreamParser, message: string): string | undefined {
  let output: unknown
  if (message in up.messageTypes) {
    const info = up.messageTypes[message] as object
    if ('instances' in info) {
      for (const inst of Object.keys(info.instances as object)) output = up.get_instance(message, inst)
    } else {
      output = up.get(message)
    }
  }
  return output === undefined ? undefined : JSON.stringify(output)
}

const mineGet = (log: DataflashLog, message: string) => {
  const columns = getMessageColumns(log, message)
  return columns && JSON.stringify(columns)
}

const ODD_KEYS = ['NOPE', 'att', 'IMU[0]', 'constructor', '__proto__', 'toString', 'undefined', 'null', '[object Object]', '']

const sources: [string, () => Uint8Array][] = [
  ['copter-sitl.bin', () => readFileSync(resolve(repo, 'packages/dataflash/test-fixtures/copter-sitl.bin'))],
  ['copter-files.bin', () => readFileSync(resolve(repo, 'packages/dataflash/test-fixtures/copter-files.bin'))],
  ['synthetic log', buildSyntheticLog]
]

describe.each(sources)('get output matches upstream: %s', (_name, bytes) => {
  let up: UpstreamParser
  let log: DataflashLog

  beforeAll(async () => {
    const data = bytes()
    up = parseUpstream(await loadUpstream(), data)
    log = DataflashLog.parse(data)
  })

  it('for every message type upstream knows, byte for byte', () => {
    const names = Object.keys(up.messageTypes)
    expect(names.length).toBeGreaterThan(5)
    for (const name of names) expect(mineGet(log, name), name).toBe(upstreamGet(up, name))
  })

  it('for odd keys the model may send', () => {
    for (const name of ODD_KEYS) expect(mineGet(log, name), name).toBe(upstreamGet(up, name))
  })
})

describe('getMessageColumns', () => {
  const log = DataflashLog.parse(buildSyntheticLog())

  it('returns only the last instance of an instanced message (upstream bug)', () => {
    const imu = getMessageColumns(log, 'IMU')
    const instance = imu?.I
    expect(instance && ArrayBuffer.isView(instance) ? Array.from(instance) : instance).toEqual(new Array(50).fill(1))
  })

  it('keeps text and int16[32] fields as plain arrays', () => {
    expect(getMessageColumns(log, 'MSG')?.Message).toEqual(['ArduCopter V4.5.1 (deadbeef)', 'Frame: QUAD/X'])
    const a = getMessageColumns(log, 'TYP1')?.A
    expect(a?.[0]).toEqual(Array.from({ length: 32 }, (_, j) => j * 100 - 1600))
  })

  it('returns undefined for absent types and types without records', () => {
    expect(getMessageColumns(log, 'NOPE')).toBeUndefined()
    expect(getMessageColumns(log, 'EMPT')).toBeUndefined()
  })

  it('describes the data in one line', () => {
    const att = getMessageColumns(log, 'ATT')
    expect(att && describeColumns('ATT', att)).toBe('ATT: 25 records, 9 fields')
  })
})
