import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildSyntheticSidLog } from '../test-utils/synthetic-sid.js'
import { upstreamMessageList, upstreamParse } from '../test-utils/upstream.js'
import { loadLog } from './log.js'

const fixture = (name: string) => {
  const raw = readFileSync(resolve(__dirname, '../../../../packages/dataflash/test-fixtures', name))
  return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
}

describe('message pickers match upstream populate_log_message_select', () => {
  it.each([
    ['synthetic SID log', buildSyntheticSidLog()],
    ['copter-sitl.bin', fixture('copter-sitl.bin')],
    ['copter-files.bin', fixture('copter-files.bin')]
  ])('%s', async (_, bytes) => {
    const parser = await upstreamParse(bytes)
    const log = loadLog(bytes.slice().buffer)
    expect(log.messages.map((m) => m.name)).toEqual(upstreamMessageList(parser))
    for (const m of log.messages) expect([...m.fields], m.name).toEqual(parser.messageTypes[m.name]?.expressions)
  })
})

describe('loadLog', () => {
  it('reads the flight data and its time range', () => {
    const log = loadLog(buildSyntheticSidLog().slice().buffer)
    expect(log.flight.roll?.time.length).toBeGreaterThan(0)
    expect(log.flight.throttle?.values.length).toBeGreaterThan(0)
    expect(log.flight.altitude).toBeUndefined()
    const throttle = log.flight.throttle
    const roll = log.flight.roll
    if (!throttle || !roll || !log.timeRange) throw new Error('missing flight data')
    expect(log.timeRange[0]).toBe(Math.min(throttle.time[0]!, roll.time[0]!))
    expect(log.timeRange[1]).toBe(Math.max(throttle.time.at(-1)!, roll.time.at(-1)!))
    expect(log.messages.find((m) => m.name === 'IMU')).toBeUndefined()
    expect(log.messages.map((m) => m.name)).toContain('IMU[1]')
  })
})
