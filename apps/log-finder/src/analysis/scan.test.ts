import { describe, expect, it } from 'vitest'
import { isLogFileName, scanLogs, type LogFileRef, type ScanEvent } from './scan.js'
import { readFixture } from './test-utils/upstream.js'

function ref(relativePath: string, read: () => Promise<ArrayBuffer>): LogFileRef<string> {
  return { relativePath, name: relativePath.split('/').pop() ?? relativePath, file: relativePath, read }
}

async function collect(files: readonly LogFileRef<string>[]): Promise<ScanEvent<string>[]> {
  const out: ScanEvent<string>[] = []
  for await (const e of scanLogs(files)) out.push(e)
  return out
}

describe('scanLogs', () => {
  it('yields start, then one event per file with progress', async () => {
    const events = await collect([
      ref('a/copter-sitl.bin', () => Promise.resolve(readFixture('copter-sitl.bin'))),
      ref('a/junk.bin', () => Promise.resolve(new ArrayBuffer(16))),
      ref('a/gone.bin', () => Promise.reject(new Error('missing'))),
      ref('b/copter-files.bin', () => Promise.resolve(readFixture('copter-files.bin')))
    ])
    expect(events.map((e) => (e.kind === 'start' ? `start ${e.total}` : `${e.kind} ${e.done}/${e.total}`))).toEqual([
      'start 4',
      'loaded 1/4',
      'skipped 2/4',
      'skipped 3/4',
      'loaded 4/4'
    ])
    const skipped = events.flatMap((e) => (e.kind === 'skipped' ? [e.skipped] : []))
    expect(skipped).toEqual([
      { relativePath: 'a/junk.bin', reason: 'not-a-log' },
      { relativePath: 'a/gone.bin', reason: 'unreadable' }
    ])
    const loaded = events.flatMap((e) => (e.kind === 'loaded' ? [e.log] : []))
    expect(loaded.map((l) => [l.name, l.file, l.summary.version.fwString])).toEqual([
      ['copter-sitl.bin', 'a/copter-sitl.bin', 'ArduCopter V4.8.0-dev (c664ff23)'],
      ['copter-files.bin', 'b/copter-files.bin', 'ArduCopter V4.6.3 (92b0cd78)']
    ])
  })

  it('stops reading when the consumer stops', async () => {
    let reads = 0
    const read = () => {
      reads++
      return Promise.resolve(readFixture('copter-files.bin'))
    }
    for await (const e of scanLogs([ref('1.bin', read), ref('2.bin', read), ref('3.bin', read)])) {
      if (e.kind === 'loaded') break
    }
    expect(reads).toBe(1)
  })

  it('accepts .bin names in any case', () => {
    expect(isLogFileName('00000001.BIN')).toBe(true)
    expect(isLogFileName('log.bin')).toBe(true)
    expect(isLogFileName('log.tlog')).toBe(false)
  })
})
