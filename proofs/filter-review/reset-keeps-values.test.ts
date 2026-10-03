import { describe, expect, it } from 'vitest'
import { loadPage } from './_harness.js'

// Row: "Inputs a later log does not set keep the previous log's values".
describe('FilterReview reset() between logs', () => {
  it('rewrites only the six non-zero notch defaults; other inputs keep the previous values', () => {
    const page = loadPage()
    // Values a first log set through parameter_set_value.
    page.run(`parameter_set_value("INS_HNTCH_REF", 0.5); parameter_set_value("INS_HNTCH_OPTS", 2);
              parameter_set_value("INS_HNTCH_ENABLE", 1); parameter_set_value("INS_GYRO_FILTER", 40);
              parameter_set_value("SCHED_LOOP_RATE", 800); parameter_set_value("INS_HNTCH_FREQ", 120)`)
    page.run('reset()')
    const value = (id: string): string => page.element(id).value
    expect(value('INS_HNTCH_FREQ')).toBe('80')
    expect([value('INS_HNTCH_REF'), value('INS_HNTCH_OPTS'), value('INS_HNTCH_ENABLE')]).toEqual(['0.5', '2', '1'])
    expect([value('INS_GYRO_FILTER'), value('SCHED_LOOP_RATE')]).toEqual(['40', '800'])
  })
})
