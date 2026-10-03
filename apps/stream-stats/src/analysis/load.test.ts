import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadLog, logFormat } from './load.js'
import { buildTlog } from './test-support/tlog-writer.js'

describe('logFormat', () => {
  it('tells formats apart by extension', () => {
    expect(logFormat('flight.BIN')).toBe('bin')
    expect(logFormat('flight.tlog')).toBe('tlog')
    expect(logFormat('flight.ulg')).toBeNull()
    expect(logFormat(null)).toBe('bin')
  })
})

describe('loadLog', () => {
  it('loads a DataFlash log', () => {
    const buffer = readFileSync(resolve(__dirname, '../../../../packages/dataflash/test-fixtures/copter-sitl.bin'))
    const loaded = loadLog(new Uint8Array(buffer).slice().buffer, 'bin')
    expect(loaded.kind).toBe('bin')
    if (loaded.kind !== 'bin') return
    expect(loaded.log.byteLength).toBe(buffer.byteLength)
    const imu = loaded.log.messages.find((m) => m.name === 'IMU')
    expect(imu?.time?.length).toBe(imu?.count)
    const fmt = loaded.log.messages.find((m) => m.name === 'FMT')
    expect(fmt?.time).toBeNull()
    expect(loaded.log.messageTypes).toContain('PARM')
  })

  it('loads a tlog', () => {
    const loaded = loadLog(buildTlog([{ timeUs: 1n, name: 'HEARTBEAT' }]).buffer, 'tlog')
    expect(loaded.kind).toBe('tlog')
  })

  it('loads files without usable data as empty logs, as upstream', () => {
    const tlog = loadLog(new ArrayBuffer(100), 'tlog')
    expect(tlog.kind === 'tlog' && tlog.tlog.components).toEqual([])
    const bin = loadLog(new ArrayBuffer(100), 'bin')
    expect(bin.kind === 'bin' && bin.log.messages.every((m) => m.count === 0)).toBe(true)
  })
})
