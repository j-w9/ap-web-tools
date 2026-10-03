import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadLog } from './load.js'

const fixture = (name: string) => readFileSync(resolve(__dirname, '../../../../packages/dataflash/test-fixtures', name)).buffer

describe('loadLog', () => {
  it('loads copter rate controllers from a SITL log', () => {
    const log = loadLog(fixture('copter-sitl.bin'))
    const keys = log.axes.map((a) => a.spec.key)
    expect(keys.length).toBeGreaterThan(0)
    expect(log.endTime).toBeGreaterThan(log.startTime)
    for (const axis of log.axes) {
      expect(axis.paramSets.sets.length).toBeGreaterThan(0)
      const batches = axis.sets.flatMap((s) => s ?? [])
      expect(batches.length).toBeGreaterThan(0)
      for (const b of batches) {
        expect(b.signals.Tar.length).toBe(b.time.length)
        expect(b.signals.Out.length).toBe(b.time.length)
        expect(b.sampleRate).toBeGreaterThan(0)
      }
    }
    expect(log.messageTypes).toContain('PARM')
  })
})
