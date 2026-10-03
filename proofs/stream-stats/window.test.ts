/**
 * Row: "Window size not validated" (`plot_log`/`plot_tlog`, `parseFloat(WindowSize.value)`).
 * index.html declares the box `min="0.1"`; the code uses whatever was typed.
 */
import { describe, expect, it } from 'vitest'
import { loadStreamStats, parseWithOriginal } from './_harness.js'
import { tenImuRecords } from './_log.js'

describe('Stream Stats window size', () => {
  it('window -4 gives negative messages per second and a one-point total', async () => {
    const page = loadStreamStats()
    page.setSettings('-4', false)
    page.plotLog(await parseWithOriginal(tenImuRecords()))

    const [imu] = page.rates()
    expect(imu?.x).toEqual([10, 6, 2, -2])
    expect(imu?.y).toEqual([-0.25, -1, -1, -0.25])
    expect(page.total().x).toEqual([10, 6, 2, -2])
    expect(page.total().y).toEqual([-0.25])
  })

  it.each(['0', ''])('window %j throws RangeError: Invalid array length', async (value) => {
    const page = loadStreamStats()
    page.setSettings(value, false)
    const log = await parseWithOriginal(tenImuRecords())
    expect(() => page.plotLog(log)).toThrow(new RangeError('Invalid array length'))
    // The pie was already updated; the rate plots were cleared and the totals never computed.
    expect(page.composition().values).toEqual([10, 2])
    expect(page.rates()).toEqual([])
    expect(page.total().y).toBeUndefined()
  })
})
