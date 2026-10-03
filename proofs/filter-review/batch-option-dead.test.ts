import { describe, expect, it } from 'vitest'
import { fakeLog, loadPage } from './_harness.js'

// Row: "Batch data can never be used when the log also has raw data".
describe('FilterReview load(): log with both batch (ISBH/ISBD) and raw (GYR) data', () => {
  it('uses raw data although Batch was ticked, because reset() ticks Raw first', async () => {
    const page = loadPage()
    const calls: string[] = []
    page.set('__calls', calls)
    // Record which loader load() picks; leave no gyro data so load() stops right after.
    page.run(`load_from_batch = function () { __calls.push("batch"); Gyro_batch = [] }`)
    page.run(`load_from_raw_log = function () { __calls.push("raw"); Gyro_batch = [] }`)

    // The user ticks "Batch" before choosing the file (both radios are enabled after start-up).
    expect(page.element('log_type_batch').disabled).toBe(false)
    page.element('log_type_batch').checked = true
    expect(page.element('log_type_raw').checked).toBe(false)

    await page.load(fakeLog({ params: {}, messages: { ISBH: { TimeUS: [0] }, ISBD: { TimeUS: [0] }, GYR: { TimeUS: [0] } } }))

    expect(calls).toEqual(['raw'])
    expect(page.element('log_type_batch').checked).toBe(false)
    expect(page.element('log_type_raw').checked).toBe(true)
    expect(page.alerts).toEqual(['No valid gyro data found in log'])
  })
})
