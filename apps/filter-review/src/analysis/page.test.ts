// Page-level oracle: upstream load(), load_parameters(), save_parameters() and
// open_in_filter_tool() run in a vm page stub, compared with the port's page model.
import { describe, expect, it } from 'vitest'
import { DataflashLog } from '@apwt/dataflash'
import { instanceTransfer } from './analyse.js'
import { GYRO_AXES } from './fft/batch-fft.js'
import { buildFilters } from './filters/filter-set.js'
import { filterToolUrl, filterToolValues } from './filter-tool-link.js'
import {
  FILTER_PARAM_NAMES,
  defaultPageValues,
  filterParamsFromPage,
  withPageValue,
  type FilterParamName,
  type PageValues
} from './page-values.js'
import { applyParamFile, filterParamFileText } from './param-file.js'
import { SPECTRUM_KINDS, spectrumTraceKey } from './selections.js'
import { loadIntoPage, type LoadedPage, type PageInputs } from './session.js'
import { expectComplexClose } from './test-utils/compare.js'
import { LogAppender, appendBatchGyro, appendRawGyro, appendTrackingMessages, fixture, patchParam } from './test-utils/logs.js'
import { loadFilterReviewPage, type UpstreamPage } from './test-utils/upstream-page.js'
import type { Pair } from './test-utils/upstream.js'

const INITIAL: PageInputs = { values: defaultPageValues(), windowSize: '1024', windowsPerBatch: '1' }

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

function upstreamValues(page: UpstreamPage): PageValues {
  return Object.fromEntries(FILTER_PARAM_NAMES.map((n) => [n, page.element(n).value])) as Record<FilterParamName, string>
}

/** Port state after a sequence of loads, threading the page inputs like the App does. */
function portLoads(logs: readonly Uint8Array[], start: PageInputs = INITIAL): LoadedPage {
  let inputs = start
  let page: LoadedPage | undefined
  for (const bytes of logs) {
    page = loadIntoPage(inputs, DataflashLog.parse(bytes))
    inputs = page.inputs
  }
  return page!
}

function expectSamePage(page: UpstreamPage, mine: LoadedPage): void {
  expect(mine.inputs.values).toEqual(upstreamValues(page))
  expect(mine.log.gyro.type).toBe(page.run('Gyro_batch.type'))
  expect(page.element('log_type_batch').checked).toBe(mine.log.gyro.type === 'batch')
  expect(String(mine.timeRange[0])).toBe(page.element('TimeStart').value)
  expect(String(mine.timeRange[1])).toBe(page.element('TimeEnd').value)
  expect(mine.inputs.windowSize).toBe(page.element('FFTWindow_size').value)
  expect(page.element(`filter_version_${mine.log.filterVersion}`).checked).toBe(true)
  expect(mine.log.loggedNotches.map((l) => l.harmonics)).toEqual(page.run('logged_tracking.map((l) => l.harmonics)'))

  // Default selections
  const shown = mine.selections.shown
  for (let sensor = 0; sensor < 3; sensor++) {
    for (const kind of SPECTRUM_KINDS) {
      const id = { pre: 'Pre', post: 'Post', est: 'PostEst' }[kind]
      GYRO_AXES.forEach((axis) => {
        expect(shown.has(spectrumTraceKey(sensor, kind, axis)), `Gyro${sensor}${id}${axis}`).toBe(
          page.element(`Gyro${sensor}${id}${axis.toUpperCase()}`).checked
        )
      })
    }
  }
  expect(page.element(`BodeGyroInst${mine.selections.bodeGyro}`).checked).toBe(true)
  expect(page.element(`SpecGyroInst${mine.selections.specGyro}`).checked).toBe(true)
  expect(page.element(mine.selections.specKind === 'pre' ? 'SpecGyroPre' : 'SpecGyroPost').checked).toBe(true)
  // "Primary" label, added whenever EKF3 names a primary
  for (let i = 0; i < 3; i++) {
    expect(page.element(`Gyro${i}`).firstElementChild.innerHTML.includes('Primary')).toBe(mine.log.ekfPrimary === i)
  }

  // Alerts: log problems, analysis, then the notch set-up
  const filters = buildFilters(
    filterParamsFromPage(mine.inputs.values, mine.log.sixteenHarmonics),
    mine.log.targets.all,
    mine.log.filterVersion
  )
  const mineAlerts = [...mine.log.warnings, ...(mine.result.error !== null ? [mine.result.error] : [])]
  if (mine.result.analysis?.warning !== undefined) mineAlerts.push(mine.result.analysis.warning)
  mineAlerts.push(...filters.notches.flatMap((n) => n.warnings))
  expect(new Set(page.alerts)).toEqual(new Set(mineAlerts))
}

/** Compare upstream FFT.H with the port's transfer functions for the current page values. */
function expectSameTransfer(page: UpstreamPage, mine: LoadedPage, values: PageValues): void {
  const filters = buildFilters(
    filterParamsFromPage(values, mine.log.sixteenHarmonics),
    mine.log.targets.all,
    mine.log.filterVersion
  )
  mine.result.analysis!.instances.forEach((a, i) => {
    if (a === null) return
    const theirs = page.run(`Gyro_batch[${i}].FFT.H`) as Pair[] | undefined
    const t = instanceTransfer(a, filters)
    expect(t.fft === undefined).toBe(theirs == null)
    t.fft?.forEach((h, j) => expectComplexClose(h, theirs![j]!, `H ${i}/${j}`))
  })
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
    const page = await loadFilterReviewPage()
    await page.load(bytes)
    const mine = portLoads([bytes])
    expectSamePage(page, mine)
    expectSameTransfer(page, mine, mine.inputs.values)
  })

  it('uses raw data when a log has both raw and batch data, even with "Batch" ticked', async () => {
    const bytes = batchLog({}, true)
    const page = await loadFilterReviewPage()
    page.element('log_type_batch').checked = true
    await page.load(bytes)
    const mine = portLoads([bytes])
    expect(mine.log.available).toEqual({ batch: true, raw: true })
    expect(mine.log.gyro.type).toBe('raw')
    expectSamePage(page, mine)
  })

  it('writes the batch window size back and a later raw log uses it', async () => {
    const batch = batchLog()
    const raw = rawLog()
    const page = await loadFilterReviewPage()
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
    const page = await loadFilterReviewPage()
    await page.load(first)
    await page.load(second)
    const mine = portLoads([first, second])
    expectSamePage(page, mine)
    // REF and OPTS come from the first log; FREQ went back to the reset default
    expect(mine.inputs.values.INS_HNTCH_REF).toBe('0.5')
    expect(mine.inputs.values.INS_HNTCH_OPTS).toBe('2')
    expect(mine.inputs.values.INS_HNTCH_FREQ).toBe('80')
  })

  it('leaves a drop-down empty for a value it does not offer', async () => {
    const bytes = rawLog({
      INS_HNTC2_ENABLE: 2,
      INS_HNTC2_MODE: 7,
      INS_HNTCH_ENABLE: 1,
      INS_HNTCH_MODE: 2,
      INS_HNTCH_HMNCS: -125
    })
    const page = await loadFilterReviewPage()
    await page.load(bytes)
    const mine = portLoads([bytes])
    expect(mine.inputs.values.INS_HNTC2_ENABLE).toBe('')
    expect(mine.inputs.values.INS_HNTC2_MODE).toBe('')
    expectSamePage(page, mine)
    expect(page.alerts).toContain('Unsupported notch mode NaN')
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
    const page = await loadFilterReviewPage()
    await page.load(bytes)
    page.alerts.length = 0
    await page.loadParameters(text)

    const mine = portLoads([bytes])
    const result = applyParamFile(text)
    expect(result.error).toBeUndefined()
    let values = mine.inputs.values
    const other = new Map<string, string>()
    for (const a of result.assignments) {
      if (a.kind === 'param') values = { ...values, [a.name]: a.value }
      else other.set(a.name, a.value)
    }
    expect(values).toEqual(upstreamValues(page))
    for (const id of ['TimeStart', 'TimeEnd', 'FFTWindow_per_batch']) expect(other.get(id)).toBe(page.element(id).value)
    expect(other.has('FFTWindow_size')).toBe(false)
    // Indented line ignored; invalid number and option text leave the input empty
    expect(values.INS_HNTCH_FREQ).toBe(mine.inputs.values.INS_HNTCH_FREQ)
    expect(values.INS_HNTCH_ATT).toBe('')
    expect(values.INS_HNTCH_FM_RAT).toBe('')
    expect(values.INS_HNTC2_ENABLE).toBe('')

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

  it('stops at a line naming a file input, as upstream throws there', async () => {
    const bytes = rawLog()
    const page = await loadFilterReviewPage()
    await page.load(bytes)
    const stop = 'INS_HNTCH_BW,10\nfileItem,x\nINS_HNTCH_ATT,20\n'
    await expect(page.loadParameters(stop)).rejects.toThrow('InvalidStateError')
    const result = applyParamFile(stop)
    expect(result.error).toContain('fileItem')
    expect(result.assignments).toEqual([{ kind: 'param', name: 'INS_HNTCH_BW', value: '10' }])
    expect(page.element('INS_HNTCH_BW').value).toBe('10')
    expect(page.element('INS_HNTCH_ATT').value).toBe('40')
  })
})

describe('upstream save_parameters()', () => {
  it('writes inputs in page order with empty inputs as 0', async () => {
    const bytes = rawLog({ INS_HNTCH_HMNCS: -125, INS_GYRO_FILTER: 0.65 })
    const page = await loadFilterReviewPage()
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
