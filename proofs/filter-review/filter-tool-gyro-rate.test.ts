// Row: "Open in Filter Tool sends the gyro rate as GYRO_SAMPLE_RATE, which the Filter Tool never
// reads". Verdict: docs/bug-proofs/filter-review.md, row 14.
import { describe, expect, it } from 'vitest'
import { freshPage } from '../filter-tool/_harness.js'
import { fakeLog, loadPage, ramp } from './_harness.js'

const REVIEW = 'https://example.org/WebTools/FilterReview/'

/** The link the original FilterReview opens for 10 s of raw gyro data sampled every `periodUs`. */
async function filterToolLink(periodUs: number): Promise<string> {
  const page = loadPage()
  const n = Math.round(10_000_000 / periodUs) + 1
  const gyro = { SampleUS: ramp(n, 0, periodUs), GyrX: ramp(n, 0, 0), GyrY: ramp(n, 0, 0), GyrZ: ramp(n, 0, 0) }
  await page.load(fakeLog({ params: {}, instances: { GYR: { '0': gyro } } }))
  let opened = ''
  page.set('URL', URL)
  page.set('window', { location: { href: REVIEW }, open: (url: string) => (opened = url) })
  // The INS_* inputs are not needed here
  page.run('document.getElementsByTagName = () => []')
  page.run('open_in_filter_tool()')
  return opened
}

describe('Open in Filter Tool: gyro sample rate', () => {
  it('FilterReview adds the Bode IMU rate to the link as GYRO_SAMPLE_RATE', async () => {
    const link = new URL(await filterToolLink(1000))
    expect(link.pathname).toBe('/WebTools/FilterTool/')
    expect([...link.searchParams]).toEqual([['GYRO_SAMPLE_RATE', '1000']])
    expect(new URL(await filterToolLink(250)).searchParams.get('GYRO_SAMPLE_RATE')).toBe('4000')
  })

  it('the Filter Tool opens that link at its default 2000 Hz, and its Bode plot runs to about 1000 Hz', async () => {
    const link = await filterToolLink(1000)
    const page = freshPage({}, link)
    expect(page.read('GyroSampleRate')).toBe(2000)
    page.call('calculate_filter')
    const bode = page.context['Bode'] as { data: { x: number[] }[] }
    expect(Math.max(...bode.data[0]!.x)).toBeCloseTo(1000, 0)
  })

  it('the Filter Tool reads the rate when the link names its input, GyroSampleRate', () => {
    const page = freshPage({}, 'https://example.org/WebTools/FilterTool/?GyroSampleRate=1000')
    expect(page.read('GyroSampleRate')).toBe(1000)
    page.call('calculate_filter')
    const bode = page.context['Bode'] as { data: { x: number[] }[] }
    expect(Math.max(...bode.data[0]!.x)).toBeCloseTo(500, 0)
  })
})
