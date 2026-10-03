// Row: "Whole share URL lowercased, values included". Verdict: docs/bug-proofs/filter-tool.md.
import { describe, expect, it } from 'vitest'
import { freshPage } from './_harness.js'

describe('load() from a share link', () => {
  it('skips Throttle=Infinity (lowercased to "infinity", parseFloat NaN)', () => {
    const page = freshPage({}, 'https://example.org/FilterTool/?Throttle=Infinity&INS_GYRO_FILTER=4.5E1')
    expect(page.read('Throttle')).toBe(0.3)
    expect(page.read('INS_GYRO_FILTER')).toBe(45)
  })

  it('get_link cannot produce Infinity: a number input does not hold it', () => {
    const page = freshPage()
    page.el('Throttle').value = 'Infinity'
    expect(page.el('Throttle').value).toBe('')
    page.el('Throttle').value = '0.5'
    page.call('get_link')
    expect(page.clipboard).toHaveLength(1)
    expect(new URL(page.clipboard[0]!).searchParams.get('Throttle')).toBe('0.5')
  })
})
