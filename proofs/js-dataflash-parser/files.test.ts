/**
 * Row: "FILE chunks appended in log order, `Offset`/`Length` ignored" (`parser.js` `processFiles`).
 * Runs the original parser on the real `copter-files.bin` fixture.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fixturePath, upstreamFiles, upstreamParse } from './_harness.js'

interface FileChunk {
  offset: number
  length: number
  dataLength: number
}

/** The FILE records the original decoded for `name`, in log order. */
function chunksOf(messages: Record<string, ArrayLike<unknown>>, name: string): FileChunk[] {
  const out: FileChunk[] = []
  const names = messages['FileName']!
  for (let i = 0; i < names.length; i++) {
    if (names[i] !== name) continue
    out.push({
      offset: messages['Offset']![i] as number,
      length: messages['Length']![i] as number,
      dataLength: (messages['Data']![i] as string).length
    })
  }
  return out
}

/** The decoded `Data` strings of `name`'s FILE records, in log order. */
function dataOf(messages: Record<string, ArrayLike<unknown>>, name: string): string[] {
  const out: string[] = []
  const names = messages['FileName']!
  for (let i = 0; i < names.length; i++) if (names[i] === name) out.push(messages['Data']![i] as string)
  return out
}

function bytesOf(data: string[]): number[] {
  return Array.from(data.join(''), (c) => c.charCodeAt(0))
}

describe('JsDataflashParser processFiles', () => {
  const bytes = new Uint8Array(readFileSync(fixturePath('copter-files.bin')))

  it('appends a second copy of @SYS/uarts.txt (Offset restarts at 0) after the first', async () => {
    const { parser } = await upstreamParse(bytes)
    const files = upstreamFiles(parser)
    const chunks = chunksOf(parser.messages['FILE']!, '@SYS/uarts.txt')

    // The firmware logged the file twice: 13 chunks of 64 bytes, then Offset starts again at 0.
    expect(chunks).toHaveLength(26)
    expect(chunks.map((c) => c.offset)).toEqual([...Array(13).keys(), ...Array(13).keys()].map((k) => k * 64))
    expect(chunks.every((c) => c.length === 64)).toBe(true)
    // The largest Offset + Length the log states is 832 bytes...
    expect(Math.max(...chunks.map((c) => c.offset + c.length))).toBe(832)
    // ...but the original's file is both copies back to back: bytes 832..1663 are the second
    // copy, which the log places at Offsets 0..831. (The two copies differ: the file holds counters.)
    const file = files['@SYS/uarts.txt']!
    expect(file.length).toBe(1664)
    const data = dataOf(parser.messages['FILE']!, '@SYS/uarts.txt')
    expect(Array.from(file.subarray(0, 832))).toEqual(bytesOf(data.slice(0, 13)))
    expect(Array.from(file.subarray(832))).toEqual(bytesOf(data.slice(13)))
    expect(bytesOf(data.slice(13))).not.toEqual(bytesOf(data.slice(0, 13)))
  })

  it('drops the trailing zero bytes of every chunk of the binary @SYS/storage.bin', async () => {
    const { parser } = await upstreamParse(bytes)
    const files = upstreamFiles(parser)
    const chunks = chunksOf(parser.messages['FILE']!, '@SYS/storage.bin')

    // 512 chunks, contiguous Offsets 0, 64, ..., each with Length 64: a 32768-byte file.
    expect(chunks).toHaveLength(512)
    expect(chunks.map((c) => c.offset)).toEqual([...Array(512).keys()].map((k) => k * 64))
    expect(chunks.every((c) => c.length === 64)).toBe(true)
    // The decoded `Data` strings are shorter than Length (first chunk 63, third 21 bytes)...
    expect(chunks.slice(0, 3).map((c) => c.dataLength)).toEqual([63, 64, 21])
    // ...so the original's file is 171 bytes instead of 32768.
    expect(files['@SYS/storage.bin']!.length).toBe(171)
  })
})
