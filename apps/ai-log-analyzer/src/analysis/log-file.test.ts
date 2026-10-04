import { describe, expect, it } from 'vitest'
import { logNotReadText, readsLogFile } from './log-file.js'

describe('chosen log files (proven upstream bug #137)', () => {
  it('reads exactly the files upstream read: names ending in .bin, any case', () => {
    for (const name of ['flight.bin', 'FLIGHT.BIN', 'a.b.Bin', '.bin']) expect(readsLogFile(name), name).toBe(true)
    // Upstream offered these but never read them (and reported them ready: see proofs/ai-log-analyzer).
    for (const name of ['flight.log', 'flight.LOG', 'flight.bin.log', 'bin', 'flight.tlog'])
      expect(readsLogFile(name), name).toBe(false)
  })

  it('reads a log handed over by another tool', () => {
    expect(readsLogFile(null)).toBe(true)
  })

  it('names the file that was not read', () => {
    expect(logNotReadText('flight.log')).toBe('flight.log was not read: only .bin logs can be analysed.')
  })
})
