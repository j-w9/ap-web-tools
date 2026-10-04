// Page-level oracle: upstream load(), load_parameters(), save_parameters() and
// open_in_filter_tool() run in a vm page stub, compared with the port's page model.
import { describe, expect, it } from 'vitest'
import { DataflashLog } from '@apwt/dataflash'
import { buildFilters } from './filters/filter-set.js'
import { filterToolUrl, filterToolValues } from './filter-tool-link.js'
import { defaultPageValues, filterParamsFromPage, withPageValue } from './page-values.js'
import { applyParamFile, filterParamFileText } from './param-file.js'
import { loadIntoPage, type LoadedPage, type PageInputs } from './session.js'
import { LogAppender, appendBatchGyro, appendRawGyro, appendTrackingMessages, fixture, patchParam } from './test-utils/logs.js'
import { expectSamePage, expectSameTransfer, upstreamValues } from './test-utils/page-compare.js'
import { loadFilterReviewPage, type UpstreamPage } from './test-utils/upstream-page.js'

const INITIAL: PageInputs = { values: defaultPageValues(), windowSize: '1024', windowsPerBatch: '1' }

/**
 * Upstream page with the proven fixes the port makes (docs/bug-proofs/filter-review.md; edits in
 * test-utils/proven-fixes.ts). Everything those edits do not touch is the original page; the tests
 * below that reach a fixed bug also check the original's result.
 */
const fixedPage = (): Promise<UpstreamPage> => loadFilterReviewPage({ fixed: true })

function rawLog(params: Record<string, number> = {}, bytes = fixture('copter-sitl.bin')): Uint8Array {
  const log = new LogAppender(bytes)
  for (const [name, value] of Object.entries(params)) log.param(name, value)
  appendRawGyro(log, [0, 1], 10, 22, 1000)
  appendTrackingMessages(log, 8, 40)
  return log.toBytes()
}

function batchLog(params: Record<string, number> = {}, alsoRaw = false): Uint8Array {
  const log = new LogAppender(patchParam(fixture('copter-sitl.bin'), 'INS_LOG_BAT_OPT', 4))
  for (const [name, value] of Object.entries(params)) log.param(name, value)
  appendBatchGyro(log, [0, 1, 2, 3], 10, 8, 1024, 1000)
  if (alsoRaw) appendRawGyro(log, [0, 1], 10, 22, 1000)
  appendTrackingMessages(log, 8, 40)
  return log.toBytes()
}

/** Port state after a sequence of loads, threading the page inputs like the App does. */
function portLoads(logs: readonly Uint8Array[], start: PageInputs = INITIAL, preferBatch = false): LoadedPage {
  let inputs = start
  let page: LoadedPage | undefined
  for (const bytes of logs) {
    page = loadIntoPage(inputs, DataflashLog.parse(bytes), preferBatch)
    inputs = page.inputs
  }
  return page!
}

describe('upstream load() page state', () => {
  it('reads a raw log with notch parameters', async () => {
    const bytes = rawLog({
      INS_GYRO_FILTER: 45,
      INS_HNTCH_ENABLE: 1,
      INS_HNTCH_MODE: 3,
      INS_HNTCH_REF: 1,
      INS_HNTCH_OPTS: 3,
      INS_HNTCH_HMNCS: 11
    })
    const page = await fixedPage()
    await page.load(bytes)
    const mine = portLoads([bytes])
    expectSamePage(page, mine)
    expectSameTransfer(page, mine, mine.inputs.values)
  })

  it('proven upstream bug fixed: a log with both raw and batch data uses batch when "Batch" is ticked', async () => {
    // docs/bug-proofs/filter-review.md, row 1: the original ticks "Raw sensor" before reading the choice.
    const bytes = batchLog({}, true)
    const original = await loadFilterReviewPage()
    original.element('log_type_batch').checked = true
    await original.load(bytes)
    expect(original.run('Gyro_batch.type')).toBe('raw')

    const page = await fixedPage()
    page.element('log_type_batch').checked = true
    await page.load(bytes)
    const mine = portLoads([bytes], INITIAL, true)
    expect(mine.log.available).toEqual({ batch: true, raw: true })
    expect(mine.log.gyro.type).toBe('batch')
    expectSamePage(page, mine)
    // With "Raw sensor" ticked both use raw data, as the original always did.
    const raw = await fixedPage()
    await raw.load(bytes)
    const mineRaw = portLoads([bytes])
    expect(mineRaw.log.gyro.type).toBe('raw')
    expectSamePage(raw, mineRaw)
  })

  it('writes the batch window size back and a later raw log uses it', async () => {
    const batch = batchLog()
    const raw = rawLog()
    const page = await fixedPage()
    page.element('FFTWindow_per_batch').value = '3'
    await page.load(batch)
    const start: PageInputs = { ...INITIAL, windowsPerBatch: '3' }
    const afterBatch = portLoads([batch], start)
    expectSamePage(page, afterBatch)
    expect(afterBatch.inputs.windowSize).toBe('512')
    await page.load(raw)
    const afterRaw = portLoads([batch, raw], start)
    expectSamePage(page, afterRaw)
    expect(afterRaw.result.analysis!.instances[0]!.fft.windowSize).toBe(512)
  })

  it('keeps inputs a later log does not set, and resets the six defaults', async () => {
    const first = rawLog({
      INS_GYRO_FILTER: 33,
      SCHED_LOOP_RATE: 800,
      INS_HNTCH_ENABLE: 1,
      INS_HNTCH_REF: 0.5,
      INS_HNTCH_OPTS: 2,
      INS_HNTCH_FREQ: 120
    })
    const second = batchLog()
    const page = await fixedPage()
    await page.load(first)
    await page.load(second)
    const mine = portLoads([first, second])
    expectSamePage(page, mine)
    // REF and OPTS come from the first log; FREQ went back to the reset default
    expect(mine.inputs.values.INS_HNTCH_REF).toBe('0.5')
    expect(mine.inputs.values.INS_HNTCH_OPTS).toBe('2')
    expect(mine.inputs.values.INS_HNTCH_FREQ).toBe('80')
  })

  it('proven upstream bug fixed: keeps a drop-down value it does not offer as its number', async () => {
    // docs/bug-proofs/filter-review.md, row 9: the original leaves the drop-down empty (NaN).
    const bytes = rawLog({
      INS_HNTC2_ENABLE: 2,
      INS_HNTC2_MODE: 7,
      INS_HNTCH_ENABLE: 1,
      INS_HNTCH_MODE: 2,
      INS_HNTCH_HMNCS: -125
    })
    const original = await loadFilterReviewPage()
    await original.load(bytes)
    expect(original.element('INS_HNTC2_ENABLE').value).toBe('')
    expect(original.element('INS_HNTC2_MODE').value).toBe('')
    expect(original.alerts).toContain('Unsupported notch mode NaN')

    const page = await fixedPage()
    await page.load(bytes)
    const mine = portLoads([bytes])
    expect(mine.inputs.values.INS_HNTC2_ENABLE).toBe('2')
    expect(mine.inputs.values.INS_HNTC2_MODE).toBe('7')
    expectSamePage(page, mine)
    expect(page.alerts).toContain('Unsupported notch mode 7')
    expectSameTransfer(page, mine, mine.inputs.values)
  })
})

describe('upstream load_parameters()', () => {
  const text = [
    'INS_HNTCH_ENABLE=1',
    'INS_HNTCH_MODE\t4',
    '  INS_HNTCH_FREQ,150',
    'INS_HNTCH_BW,30\r',
    'INS_HNTCH_ATT 5.',
    'INS_HNTCH_REF,.5',
    'INS_HNTCH_FM_RAT,+1',
    'INS_HNTCH_HMNCS,7,extra',
    'INS_HNTC2_ENABLE,1.0',
    'INS_HNTC2_MODE,7',
    'INS_GYRO_FILTER,1e2',
    'SCHED_LOOP_RATE 500',
    'TimeStart,12',
    'TimeEnd 17.5',
    'FFTWindow_per_batch,4',
    '# comment line',
    'UNKNOWN_PARAM,3',
    'INS_HNTC2_OPTS'
  ].join('\n')

  it('sets the same inputs and filters as upstream', async () => {
    const bytes = rawLog({ INS_HNTCH_ENABLE: 1 })
    const page = await fixedPage()
    await page.load(bytes)
    page.alerts.length = 0
    await page.loadParameters(text)

    const mine = portLoads([bytes])
    const result = applyParamFile(text)
    expect(result.skipped).toEqual([])
    let values = mine.inputs.values
    const other = new Map<string, string>()
    for (const a of result.assignments) {
      if (a.kind === 'param') values = { ...values, [a.name]: a.value }
      else other.set(a.name, a.value)
    }
    expect(values).toEqual(upstreamValues(page))
    for (const id of ['TimeStart', 'TimeEnd', 'FFTWindow_per_batch']) expect(other.get(id)).toBe(page.element(id).value)
    expect(other.has('FFTWindow_size')).toBe(false)
    // Indented line ignored; invalid number text leaves the input empty; a drop-down keeps a
    // number it does not offer (proven bug fixed, row 9; the original leaves it empty)
    expect(values.INS_HNTCH_FREQ).toBe(mine.inputs.values.INS_HNTCH_FREQ)
    expect(values.INS_HNTCH_ATT).toBe('')
    expect(values.INS_HNTCH_FM_RAT).toBe('')
    expect(values.INS_HNTC2_ENABLE).toBe('1')
    expect(values.INS_HNTC2_MODE).toBe('7')

    const filters = buildFilters(
      filterParamsFromPage(values, mine.log.sixteenHarmonics),
      mine.log.targets.all,
      mine.log.filterVersion
    )
    expect(page.alerts).toEqual(filters.notches.flatMap((n) => n.warnings))
    expectSameTransfer(page, mine, values)

    // Saved file and Filter Tool link from the same inputs
    expect(filterParamFileText(values)).toBe(page.saveParameters())
    const range = { start: parseFloat(page.element('TimeStart').value), end: parseFloat(page.element('TimeEnd').value) }
    const bodeGyro = [0, 1, 2].find((i) => page.element(`BodeGyroInst${i}`).checked)!
    const theirs = new URL(page.openInFilterTool('https://example.org/WebTools/FilterReview/'))
    const ours = new URL(
      filterToolUrl('https://example.org/WebTools/FilterTool/', values, filterToolValues(mine.log, bodeGyro, range))
    )
    expect(ours.pathname).toBe(theirs.pathname)
    expect([...ours.searchParams]).toEqual([...theirs.searchParams])
  })

  it('proven upstream bug fixed: skips a line naming a file input, where upstream throws and stops', async () => {
    // docs/bug-proofs/filter-review.md, row 10 (the abort part).
    const bytes = rawLog()
    const stop = 'INS_HNTCH_BW,10\nfileItem,x\nINS_HNTCH_ATT,20\n'
    const original = await loadFilterReviewPage()
    await original.load(bytes)
    await expect(original.loadParameters(stop)).rejects.toThrow('InvalidStateError')
    expect(original.element('INS_HNTCH_BW').value).toBe('10')
    expect(original.element('INS_HNTCH_ATT').value).toBe('40')

    const page = await fixedPage()
    await page.load(bytes)
    await page.loadParameters(stop)
    const result = applyParamFile(stop)
    expect(result.skipped).toEqual(['fileItem,x'])
    expect(result.assignments).toEqual([
      { kind: 'param', name: 'INS_HNTCH_BW', value: '10' },
      { kind: 'param', name: 'INS_HNTCH_ATT', value: '20' }
    ])
    expect(page.element('INS_HNTCH_BW').value).toBe('10')
    expect(page.element('INS_HNTCH_ATT').value).toBe('20')
  })
})

describe('upstream save_parameters()', () => {
  it('writes inputs in page order with empty inputs as 0', async () => {
    const bytes = rawLog({ INS_HNTCH_HMNCS: -125, INS_GYRO_FILTER: 0.65 })
    const page = await fixedPage()
    await page.load(bytes)
    page.element('INS_HNTCH_BW').value = ''
    page.element('INS_HNTC2_MODE').value = '9'
    let values = portLoads([bytes]).inputs.values
    values = withPageValue(values, 'INS_HNTCH_BW', '')
    values = withPageValue(values, 'INS_HNTC2_MODE', '9')
    const saved = page.saveParameters()
    expect(filterParamFileText(values)).toBe(saved)
    expect(saved).toContain('INS_HNTCH_HMNCS,-125\n')
    expect(saved).toContain('INS_HNTCH_BW,0\n')
  })
})
