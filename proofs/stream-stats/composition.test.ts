/**
 * Rows: "DataFlash composition pie plots bytes labelled as bits" (`plot_log`) and "Parser's
 * built-in FMT definition has no Size" (`parser.js` constructor, `stats()`).
 */
import { describe, expect, it } from 'vitest'
import { loadStreamStats, parseWithOriginal } from './_harness.js'
import { tenImuRecords } from './_log.js'

describe('Stream Stats plot_log composition (Bits per second)', () => {
  it('plots byte counts in a pie whose hover says bits, next to a byte total and a bit rate', async () => {
    const page = loadStreamStats()
    page.setSettings('10', true)
    page.plotLog(await parseWithOriginal(tenImuRecords()))

    const pie = page.composition()
    expect(pie.labels).toEqual(['IMU', 'FMT'])
    // IMU: 10 records x 16 bytes = 160 bytes; FMT: 2 records x 89 bytes = 178 bytes.
    expect(pie.values).toEqual([160, 178])
    expect(pie.hovertemplate).toBe('%{label}<br>%{value:,i} bits<br>%{percent}<extra></extra>')
    // The same page states the same 338 as bytes...
    expect(page.logStatsText()).toEqual(['Total size: 338 Bytes'])
    // ...and its IMU rate is in bits: 128 bps over the 10 s window = 1280 bits, not 160.
    const [imu] = page.rates()
    expect(imu?.y).toEqual([128])
    expect(page.rateAxis()).toBe('bits per second')
  })
})

describe('Stream Stats plot_log composition for a log without its own FMT record', () => {
  it('gives FMT a NaN msg_size and a NaN pie value', async () => {
    const log = (await parseWithOriginal(new Uint8Array(100))) as {
      stats(): Record<string, { count: number; msg_size: number; size: number }>
      FMT: { length: string; Size?: number }[]
    }
    // The constructor states FMT's length as '89' but gives it no Size.
    expect(log.FMT[128]?.length).toBe('89')
    expect(log.FMT[128]?.Size).toBeUndefined()
    expect(log.stats()).toEqual({ FMT: { count: 0, msg_size: NaN, size: NaN } })

    const page = loadStreamStats()
    page.setSettings('10', true)
    page.plotLog(log)
    expect(page.composition().labels).toEqual(['FMT'])
    expect(page.composition().values).toEqual([NaN])
  })
})
