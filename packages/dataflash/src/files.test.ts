import { describe, expect, it } from 'vitest'
import { DataflashLog } from './log.js'
import { LogWriter } from './test-support/synthetic-log.js'

const text = (bytes: Uint8Array | undefined) => (bytes ? new TextDecoder().decode(bytes) : undefined)

function fileLog(chunks: readonly [name: string, offset: number, data: string][]): DataflashLog {
  const w = new LogWriter()
  w.defineFormat(0x80, 'FMT', 'BBnNZ', 'Type,Length,Name,Format,Columns')
  w.defineFormat(20, 'FILE', 'NIBZ', 'FileName,Offset,Length,Data')
  for (const [name, offset, data] of chunks) w.write('FILE', [name, offset, data.length, data])
  return DataflashLog.parse(w.toBytes())
}

describe('files', () => {
  it('reassembles chunks at their offsets', () => {
    const log = fileLog([
      ['@SYS/a.txt', 0, 'hello '],
      ['@SYS/a.txt', 6, 'world']
    ])
    expect(text(log.files().get('@SYS/a.txt'))).toBe('hello world')
  })

  it('appends a file written twice, as upstream processFiles does (bug, reproduced)', () => {
    const log = fileLog([
      ['@SYS/a.txt', 0, 'first '],
      ['@SYS/a.txt', 6, 'copy'],
      ['@SYS/a.txt', 0, 'second'],
      ['@SYS/a.txt', 6, ' run']
    ])
    expect(text(log.files().get('@SYS/a.txt'))).toBe('first copysecond run')
  })

  it('lists message types with no records in stats, as upstream does', () => {
    const log = fileLog([['x', 0, 'y']])
    expect(log.stats().get('FILE')?.count).toBe(1)
    expect(log.stats().get('FMT')?.count).toBe(2)
  })
})
