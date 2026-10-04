import { describe, expect, it } from 'vitest'
import { importPaletteFiles, type PaletteFile } from './palette-imports.js'

const files: PaletteFile[] = [
  { url: 'a.json', pos: { x: 1, y: 0, w: 2, h: 2 } },
  { url: 'b.json', pos: { x: 3, y: 0, w: 3, h: 2 } },
  { url: 'c.json', pos: { x: 0, y: 2, w: 2, h: 2 } }
]

function fakeFetch(responses: Record<string, unknown>): (url: string) => Promise<unknown> {
  return (url) => (url in responses ? Promise.resolve(responses[url]) : Promise.reject(new TypeError('Failed to fetch')))
}

describe('palette example files', () => {
  it('adds every widget, placed at its palette position, when all files load', async () => {
    const added: unknown[] = []
    const results = await importPaletteFiles(
      files,
      fakeFetch({
        'a.json': { widget: { type: 'A' } },
        'b.json': { widget: { type: 'B' } },
        'c.json': { widget: { type: 'C' } }
      }),
      (widget) => added.push(widget)
    )
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled'])
    expect(added).toEqual([
      { type: 'A', x: 1, y: 0, w: 2, h: 2 },
      { type: 'B', x: 3, y: 0, w: 3, h: 2 },
      { type: 'C', x: 0, y: 2, w: 2, h: 2 }
    ])
  })

  it('proven bug #71: settles when a file fails to load or has no widget, leaving only that file out', async () => {
    // Upstream never settled here, so the palette stayed in batch mode with no widget initialised
    // (proofs/telemetry-dashboard "#71 …").
    const added: unknown[] = []
    const results = await importPaletteFiles(files, fakeFetch({ 'a.json': { widget: { type: 'A' } }, 'c.json': {} }), (widget) =>
      added.push(widget)
    )
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'rejected'])
    expect(added).toEqual([{ type: 'A', x: 1, y: 0, w: 2, h: 2 }])
  })
})
