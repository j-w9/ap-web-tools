import { describe, expect, it } from 'vitest'
import { withEmptyNote } from './layout-helpers.js'

describe('withEmptyNote', () => {
  it('adds a centred note and keeps existing annotations', () => {
    const out = withEmptyNote({ annotations: [{ text: 'a' }] }, 'Open a log')
    expect(out.annotations).toHaveLength(2)
    expect(out.annotations?.[1]).toMatchObject({ text: 'Open a log', x: 0.5, y: 0.5, showarrow: false })
  })

  it('returns the layout unchanged for null', () => {
    const layout = { title: { text: 't' } }
    expect(withEmptyNote(layout, null)).toBe(layout)
  })
})
