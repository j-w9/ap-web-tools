// Row: "`load_parameters` does not trim lines and sets any element by id". Verdict:
// docs/bug-proofs/filter-tool.md.
import { describe, expect, it } from 'vitest'
import { freshPage, loadParamFile } from './_harness.js'

describe('load_parameters', () => {
  it('ignores an indented line', async () => {
    const page = freshPage()
    await loadParamFile(page, '  INS_GYRO_FILTER 45\n\tINS_HNTCH_FREQ,80\n')
    expect(page.read('INS_GYRO_FILTER')).toBe(20)
    expect(page.read('INS_HNTCH_FREQ')).toBe(0)
  })

  it('empties a field for NAME, with no value', async () => {
    const page = freshPage()
    await loadParamFile(page, 'INS_GYRO_FILTER,\n')
    expect(page.el('INS_GYRO_FILTER').value).toBe('')
  })

  it('sets inputs that are not parameters', async () => {
    const page = freshPage()
    await loadParamFile(page, 'GyroSampleRate 1000\nThrottle 0.5\nRPM1 3000\n')
    expect(page.read('GyroSampleRate')).toBe(1000)
    expect(page.read('Throttle')).toBe(0.5)
    expect(page.read('RPM1')).toBe(3000)
  })
})
