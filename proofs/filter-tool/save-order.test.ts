// Row: "Saved order is number inputs then drop-downs; empty field saved as 0". Verdict:
// docs/bug-proofs/filter-tool.md. Param_Helpers.js is loaded here (see param-helpers.test.ts) to get
// the text save_parameters builds.
import { describe, expect, it } from 'vitest'
import { freshPage } from './_harness.js'

describe('save_parameters', () => {
  it('writes number inputs, then drop-downs, and an empty field as 0', () => {
    const page = freshPage()
    page.finishMetadata()
    page.el('INS_HNTCH_FREQ').value = ''
    page.call('save_parameters')
    expect(page.saved.map((s) => s.name)).toEqual(['filter.param'])
    const lines = page.saved[0]!.text.trimEnd().split('\n')
    expect(lines).toContain('INS_HNTCH_FREQ,0')
    const names = lines.map((l) => l.split(',')[0])
    expect(names.slice(-4)).toEqual(['INS_HNTCH_ENABLE', 'INS_HNTCH_MODE', 'INS_HNTC2_ENABLE', 'INS_HNTC2_MODE'])
    expect(names[0]).toBe('INS_GYRO_FILTER')
  })

  it('param_to_string("") is "0"', () => {
    const page = freshPage()
    expect(page.call('param_to_string', '')).toBe('0')
  })
})
