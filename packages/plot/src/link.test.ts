import { describe, expect, it, vi } from 'vitest'

vi.mock('./plotly.js', () => ({ Plotly: { relayout: vi.fn(() => Promise.resolve()) } }))

const { linkAxisRanges, linkAutorangeReset } = await import('./link.js')
type Element = Parameters<typeof linkAutorangeReset>[0][number]

function fakePlot(): { element: Element; removed: ReturnType<typeof vi.fn> } {
  const removed = vi.fn()
  return { element: { on: vi.fn(), removeListener: removed } as unknown as Element, removed }
}

describe('link teardown', () => {
  it('removes the listeners it added', () => {
    const a = fakePlot()
    const b = fakePlot()
    linkAxisRanges([
      { element: a.element, axis: 'x' },
      { element: b.element, axis: 'x' }
    ])()
    expect(a.removed).toHaveBeenCalledTimes(1)
  })

  it('does not throw for a plot that was purged before the link was torn down', () => {
    const a = fakePlot()
    const b = fakePlot()
    const unlink = linkAutorangeReset([a.element, b.element])
    // Plotly.purge deletes the emitter methods.
    delete (a.element as Partial<Element>).removeListener
    expect(unlink).not.toThrow()
    expect(b.removed).toHaveBeenCalledTimes(1)
  })
})
