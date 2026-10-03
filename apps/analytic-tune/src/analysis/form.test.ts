import { describe, expect, it } from 'vitest'
import { notchEnabled, selectedFilters, trackingSourcesInUse } from './form.js'
import { DEFAULT_INPUTS, withInputs, type InputName } from './params.js'

const inputs = (entries: [InputName, number][]) => withInputs(DEFAULT_INPUTS, new Map(entries))

describe('form visibility', () => {
  it('enables notch fields from _ENABLE', () => {
    expect(notchEnabled(DEFAULT_INPUTS, 'INS_HNTCH')).toBe(true)
    expect(notchEnabled(DEFAULT_INPUTS, 'INS_HNTC2')).toBe(false)
  })

  it('shows the operating-point inputs enabled notches track', () => {
    expect([...trackingSourcesInUse(DEFAULT_INPUTS)]).toEqual(['throttle'])
    expect([...trackingSourcesInUse(inputs([['INS_HNTC2_MODE', 5]]))]).toEqual(['throttle'])
    expect([
      ...trackingSourcesInUse(
        inputs([
          ['INS_HNTCH_MODE', 3.7],
          ['INS_HNTC2_ENABLE', 1],
          ['INS_HNTC2_MODE', 2]
        ])
      )
    ]).toEqual(['esc', 'rpm'])
  })

  it('shows the FILTn_ groups the rate controller selects', () => {
    const roll = { vehicle: 'copter', axis: 'Roll' } as const
    expect(selectedFilters(DEFAULT_INPUTS, roll)).toEqual([])
    expect(
      selectedFilters(
        inputs([
          ['ATC_RAT_RLL_NTF', 2],
          ['ATC_RAT_RLL_NEF', 5]
        ]),
        roll
      )
    ).toEqual([2, 5])
    expect(
      selectedFilters(
        inputs([
          ['ATC_RAT_RLL_NTF', 3],
          ['ATC_RAT_RLL_NEF', 3]
        ]),
        roll
      )
    ).toEqual([3])
    expect(selectedFilters(inputs([['ATC_RAT_RLL_NEF', 9]]), roll)).toEqual([])
  })
})
