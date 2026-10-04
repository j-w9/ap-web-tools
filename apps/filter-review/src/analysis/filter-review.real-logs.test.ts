// Real-log oracle: runs only when APWT_REAL_LOGS names a directory of DataFlash logs. For every .bin
// in it, the upstream FilterReview page (with the port's proven fixes, as the other oracle tests) and
// the port load the same log and every output is compared exactly: page state and alerts, every
// instance's FFT and filter responses, every plot under several views, each data source the log
// has, each notch tracking mode, a second FFT window setting and the Filter Tool link. A log the
// tool cannot use must fail with upstream's alert. Nothing about the logs is recorded here.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DataflashLog } from '@apwt/dataflash'
import { filterToolUrl, filterToolValues } from './filter-tool-link.js'
import { defaultPageValues, withPageValue, type PageValues } from './page-values.js'
import { calculate, loadIntoPage, windowSizeAfter, type LoadedPage, type PageInputs } from './session.js'
import {
  expectSameAnalysis,
  expectSamePage,
  expectSameRedraw,
  pageView,
  portFilters,
  upstreamValues
} from './test-utils/page-compare.js'
import { expectArrayClose } from './test-utils/compare.js'
import { loadFilterReviewPage, type UpstreamPage } from './test-utils/upstream-page.js'

const dir = process.env['APWT_REAL_LOGS']
const logs =
  dir === undefined
    ? []
    : readdirSync(dir)
        .filter((f) => f.toLowerCase().endsWith('.bin'))
        .sort()
const INITIAL: PageInputs = { values: defaultPageValues(), windowSize: '1024', windowsPerBatch: '1' }
const TIMEOUT = 60 * 60_000

/**
 * Let the event loop run between steps: the upstream page and the comparisons are synchronous, and
 * Vitest's worker must answer its runner within 60 s.
 */
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

/** Compare everything after a load, `re_calc()` or `redraw()`. */
function expectSameAll(page: UpstreamPage, mine: LoadedPage, values: PageValues): void {
  expect(upstreamValues(page)).toEqual(values)
  const transfers = expectSameAnalysis(page, mine, values)
  expectSameRedraw(page, mine, values, transfers)
}

/** Check the inputs and redraw, as a user clicking through the plot options. */
async function exerciseViews(page: UpstreamPage, mine: LoadedPage, values: PageValues): Promise<void> {
  const el = (id: string) => page.element(id)
  const analysis = mine.result.analysis!
  for (const id of ['Notch1Show', 'Notch2Show', 'SpecNotch1Show', 'SpecNotch2Show', 'SpecNotchShowLogged']) el(id).checked = true
  const transfers = expectSameAnalysis(page, mine, values)
  const redraw = async (): Promise<void> => {
    await tick()
    page.run('redraw()')
    expectSameRedraw(page, mine, values, transfers)
  }
  await redraw()

  // Every IMU, data source and axis of the spectrogram and every IMU of the Bode plot
  const sensors = [...new Set(analysis.instances.flatMap((a) => (a === null ? [] : [a.instance.sensorNum])))]
  for (const sensor of sensors) {
    el(`BodeGyroInst${sensor}`).checked = true
    el(`SpecGyroInst${sensor}`).checked = true
    const sources = [
      ...(mine.log.havePre ? ['SpecGyroPre', 'SpecGyroEstPost'] : []),
      ...(mine.log.havePost ? ['SpecGyroPost'] : [])
    ]
    for (const source of sources) {
      el(source).checked = true
      for (const axis of ['SpecGyroAxisX', 'SpecGyroAxisY', 'SpecGyroAxisZ']) {
        el(axis).checked = true
        await redraw()
      }
    }
  }

  // Scales, units, aliasing and phase wrap
  const views: [string, string, string, string][] = [
    ['ScaleLinear', 'freq_Scale_RPM', 'Aliasing_on', 'ScaleWrap'],
    ['ScalePSD', 'freq_Scale_Hz', 'Aliasing_only', 'ScaleUnWrap'],
    ['ScaleLog', 'freq_Scale_Hz', 'Aliasing_none', 'ScaleUnWrap']
  ]
  for (const ids of views) {
    for (const id of ids) el(id).checked = true
    await redraw()
  }

  // A narrower time range (redraw only, as upstream's inputs do)
  const v = pageView(page)
  const mid = Math.round((v.range.start + v.range.end) / 2)
  el('TimeStart').value = String(Math.max(v.range.start, mid - 5))
  el('TimeEnd').value = String(Math.min(v.range.end, mid + 5))
  await redraw()
  el('TimeStart').value = String(mine.timeRange[0])
  el('TimeEnd').value = String(mine.timeRange[1])
}

/** Notch 1 on each tracking mode (and multi-source where it applies), recalculated as the Calculate button does. */
async function exerciseTracking(page: UpstreamPage, mine: LoadedPage, values: PageValues): Promise<void> {
  const configs: [string, string][] = [
    ['0', '0'],
    ['1', '0'],
    ['1', '2'],
    ['2', '0'],
    ['3', '0'],
    ['3', '2'],
    ['4', '0'],
    ['4', '2'],
    ['5', '0']
  ]
  for (const [mode, opts] of configs) {
    let next = withPageValue(values, 'INS_HNTCH_ENABLE', '1')
    next = withPageValue(next, 'INS_HNTCH_MODE', mode)
    next = withPageValue(next, 'INS_HNTCH_OPTS', opts)
    page.element('INS_HNTCH_ENABLE').value = '1'
    page.element('INS_HNTCH_MODE').value = mode
    page.element('INS_HNTCH_OPTS').value = opts
    page.alerts.length = 0
    await tick()
    page.run('re_calc()')
    expect(page.alerts, `mode ${mode} opts ${opts}`).toEqual(portFilters(mine, next).notches.flatMap((n) => n.warnings))
    expectSameAll(page, mine, next)
  }
  // Back to the log's values
  for (const [name, value] of Object.entries(values)) page.element(name).value = value
  page.run('re_calc()')
}

/**
 * Other FFT window settings, applied with Calculate (upstream `clear_calculation()` then `re_calc()`):
 * one that is not a power of two (upstream alerts and stops), then a valid one.
 */
async function exerciseWindow(page: UpstreamPage, mine: LoadedPage, values: PageValues): Promise<void> {
  const batch = mine.log.gyro.type === 'batch'
  for (const setting of batch ? ['4', '3'] : ['1000', '512']) {
    const inputs: PageInputs = batch ? { ...mine.inputs, windowsPerBatch: setting } : { ...mine.inputs, windowSize: setting }
    page.element(batch ? 'FFTWindow_per_batch' : 'FFTWindow_size').value = setting
    page.alerts.length = 0
    await tick()
    let thrown = false
    try {
      page.run('clear_calculation(); re_calc()')
    } catch {
      thrown = true
    }
    const result = calculate(mine.log, inputs)
    expect(thrown, `window ${setting}`).toBe(result.error !== null)
    if (result.analysis === null) {
      expect(page.alerts).toEqual([result.error])
      continue
    }
    const next: LoadedPage = { ...mine, result, inputs: { ...inputs, windowSize: windowSizeAfter(result, inputs.windowSize) } }
    expect(page.element('FFTWindow_size').value).toBe(next.inputs.windowSize)
    const portAlerts = result.analysis.warning !== undefined ? [result.analysis.warning] : []
    portAlerts.push(...portFilters(next, values).notches.flatMap((n) => n.warnings))
    expect(page.alerts).toEqual(portAlerts)
    await tick()
    expectSameAll(page, next, values)
  }
}

/**
 * The original page (without the port's proven fixes) on the same log. Real batch logs reach one
 * proven fix, row 4 of docs/bug-proofs/filter-review.md: the original's FFT rate is the first
 * batch's rate summed once per batch, where the port averages the rates of the batches it uses.
 * The spectra themselves, the alerts, inputs and time range are the same; bins and window times
 * differ exactly when the two rates do.
 */
async function expectOriginalDiffersOnlyByRow4(
  bytes: Uint8Array,
  preferBatch: boolean,
  page: UpstreamPage,
  mine: LoadedPage
): Promise<void> {
  const original = await loadFilterReviewPage()
  original.element('log_type_batch').checked = preferBatch
  original.element('log_type_raw').checked = !preferBatch
  await original.load(bytes)
  await tick()
  expect(original.alerts).toEqual(page.alerts)
  expect(upstreamValues(original)).toEqual(upstreamValues(page))
  for (const id of ['TimeStart', 'TimeEnd', 'FFTWindow_size']) expect(original.element(id).value).toBe(page.element(id).value)
  mine.result.analysis!.instances.forEach((a, i) => {
    if (a === null) return
    const o = original.run(`Gyro_batch[${i}].FFT`) as {
      average_sample_rate: number
      bins: number[]
      time: number[]
      x: number[][]
      y: number[][]
      z: number[][]
    }
    expect(o.x.length).toBe(a.fft.x.length)
    for (let j = 0; j < a.fft.x.length; j++) {
      expectArrayClose(a.fft.x[j], o.x[j], `original x ${i}/${j}`)
      expectArrayClose(a.fft.y[j], o.y[j], `original y ${i}/${j}`)
      expectArrayClose(a.fft.z[j], o.z[j], `original z ${i}/${j}`)
    }
    // Original: the first batch's rate once per batch (its skip compares against an unset window size)
    const batches = a.instance.batches
    let sum = 0
    for (let b = 0; b < batches.length; b++) sum += batches[0]!.sampleRate
    expect(o.average_sample_rate, `original rate ${i}`).toBe(1 / (batches.length / sum))
    const same = o.average_sample_rate === a.fft.averageSampleRate
    expect(
      Array.from(o.bins).every((f, k) => f === a.fft.bins[k]),
      `bins ${i}`
    ).toBe(same)
  })
}

/** Load with one log type choice and compare everything. */
async function compareSource(bytes: Uint8Array, preferBatch: boolean): Promise<void> {
  const page = await loadFilterReviewPage({ fixed: true })
  page.element('log_type_batch').checked = preferBatch
  page.element('log_type_raw').checked = !preferBatch
  await page.load(bytes)
  await tick()
  const mine = loadIntoPage(INITIAL, DataflashLog.parse(bytes), preferBatch)
  expectSamePage(page, mine)
  if (mine.result.analysis === null) return
  const values = mine.inputs.values
  await tick()
  expectSameAll(page, mine, values)
  await expectOriginalDiffersOnlyByRow4(bytes, preferBatch, page, mine)

  // Filter Tool link from the loaded page
  const v = pageView(page)
  const theirs = new URL(page.openInFilterTool('https://example.org/WebTools/FilterReview/'))
  const ours = new URL(
    filterToolUrl('https://example.org/WebTools/FilterTool/', values, filterToolValues(mine.log, v.bodeGyro, v.range))
  )
  expect(ours.pathname).toBe(theirs.pathname)
  expect([...ours.searchParams]).toEqual([...theirs.searchParams])

  await exerciseViews(page, mine, values)
  await exerciseTracking(page, mine, values)
  await exerciseWindow(page, mine, values)
}

describe.skipIf(dir === undefined)('Filter Review matches upstream on real logs', () => {
  it.each(logs.length > 0 ? logs : ['(no logs)'])(
    '%s',
    async (name) => {
      expect(logs.length, `no .bin files in ${dir ?? ''}`).toBeGreaterThan(0)
      const bytes = new Uint8Array(readFileSync(join(dir!, name)))
      let available: { batch: boolean; raw: boolean }
      try {
        available = loadIntoPage(INITIAL, DataflashLog.parse(bytes)).log.available
      } catch (e) {
        // The port refuses the log: upstream must alert the same and stop.
        const page = await loadFilterReviewPage({ fixed: true })
        await page.load(bytes)
        expect(page.alerts).toEqual([(e as Error).message])
        // Nothing to analyse, and the Filter Tool link stays disabled
        expect(page.element('OpenFilterTool').disabled).toBe(true)
        expect(page.run('tracking_methods')).toBeUndefined()
        return
      }
      const choices = available.batch && available.raw ? [false, true] : [available.batch]
      for (const preferBatch of choices) await compareSource(bytes, preferBatch)
    },
    TIMEOUT
  )
})
