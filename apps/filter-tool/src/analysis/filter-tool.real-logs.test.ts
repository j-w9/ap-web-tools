// Real-log oracle: runs only when APWT_REAL_LOGS names a directory of DataFlash logs. The Filter Tool
// reads a log's parameters only through Filter Review's "Open in Filter Tool" link (it has no log
// loader of its own). For every .bin in the directory, the upstream Filter Review page builds that
// link from the log, the upstream Filter Tool page opens it, and the port opens the same link: the
// inputs, radios and every Bode plot (gyro filters, and each PID axis pre and post filtering) are
// compared exactly, apart from the proven fix for the gyro rate the link carries (row 14 of
// docs/bug-proofs/filter-review.md), which is asserted. A log Filter Review cannot use never enables
// the link, in upstream and in the port. Nothing about the logs is recorded here.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DataflashLog } from '@apwt/dataflash'
import { filterToolUrl, filterToolValues } from '../../../filter-review/src/analysis/filter-tool-link.js'
import { defaultPageValues } from '../../../filter-review/src/analysis/page-values.js'
import { loadIntoPage, type LoadedPage } from '../../../filter-review/src/analysis/session.js'
import { pageView } from '../../../filter-review/src/analysis/test-utils/page-compare.js'
import { loadFilterReviewPage } from '../../../filter-review/src/analysis/test-utils/upstream-page.js'
import { gyroPlot, pidPlot } from '../ui/traces.js'
import { gyroBode, pidBode } from './bode.js'
import { PID_AXES } from './params.js'
import { stateFromQuery, type PidSettings } from './settings.js'
import { provenChainedSpreadCase } from './test-utils/chained-spread.js'
import { AXIS_BUTTONS, AXIS_TITLES, expectSamePlot, freshPage, pageState, type UpstreamPlot } from './test-utils/page-compare.js'
import { loadUpstreamPage } from './test-utils/page.js'

const dir = process.env['APWT_REAL_LOGS']
const logs =
  dir === undefined
    ? []
    : readdirSync(dir)
        .filter((f) => f.toLowerCase().endsWith('.bin'))
        .sort()
const TIMEOUT = 30 * 60_000
const REVIEW = 'https://example.org/WebTools/FilterReview/'
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

describe.skipIf(dir === undefined)('Filter Tool opens real logs from Filter Review as upstream', () => {
  it.each(logs.length > 0 ? logs : ['(no logs)'])(
    '%s',
    async (name) => {
      expect(logs.length, `no .bin files in ${dir ?? ''}`).toBeGreaterThan(0)
      const bytes = new Uint8Array(readFileSync(join(dir!, name)))
      // Filter Review as a user opens the log, with upstream's proven fixes as its oracle tests
      const review = await loadFilterReviewPage({ fixed: true })
      await review.load(bytes)
      let mine: LoadedPage
      try {
        mine = loadIntoPage({ values: defaultPageValues(), windowSize: '1024', windowsPerBatch: '1' }, DataflashLog.parse(bytes))
      } catch (e) {
        // No link: upstream alerts the same and keeps "Open in Filter Tool" disabled
        expect(review.alerts).toEqual([(e as Error).message])
        expect(review.element('OpenFilterTool').disabled).toBe(true)
        return
      }
      expect(review.element('OpenFilterTool').disabled).toBe(false)
      const link = review.openInFilterTool(REVIEW)
      const v = pageView(review)
      const ours = filterToolUrl(
        REVIEW.replace('FilterReview', 'FilterTool'),
        mine.inputs.values,
        filterToolValues(mine.log, v.bodeGyro, v.range)
      )
      expect(ours).toBe(link)
      await tick()

      // Filter Tool opens the link
      const page = freshPage(link)
      page.finishMetadata()
      const state = stateFromQuery(new URL(link).search)
      const inputs = state.inputs
      // Proven upstream bug fixed (docs/bug-proofs/filter-review.md, row 14): upstream never reads
      // the link's GYRO_SAMPLE_RATE and stays at its 2000 Hz default; the port uses the rate. Every
      // other input and radio is upstream's.
      const rate = new URL(link).searchParams.get('GYRO_SAMPLE_RATE')
      expect(rate).not.toBeNull()
      const upstream = pageState(page, 'RLL')
      expect(upstream.inputs.GyroSampleRate).toBe(2000)
      expect(state).toEqual({ ...upstream, inputs: { ...upstream.inputs, GyroSampleRate: parseFloat(rate!) } })
      // From here upstream runs with the rate the link carries, as the fix reads it
      page.el('GyroSampleRate').value = rate!
      expect(pageState(page, 'RLL')).toEqual(state)

      // The original page differs from the patched one only in the proven chained-spread case
      const original = loadUpstreamPage()
      original.setHref(link)
      original.call('load')
      original.finishMetadata()
      original.el('GyroSampleRate').value = rate!
      const centres = (p: typeof page) =>
        JSON.stringify(
          (p.call('get_filters', inputs.GyroSampleRate) as { notches?: { center_freq_hz: number }[] }[]).map((f) =>
            (f.notches ?? []).map((x) => x.center_freq_hz)
          )
        )
      if (centres(original) !== centres(page)) expect(provenChainedSpreadCase(inputs, inputs.GyroSampleRate)).toBe(true)

      page.call('calculate_filter')
      expectSamePlot(page.context.Bode as UpstreamPlot, gyroPlot(gyroBode(inputs, state.gyro), state.gyro))
      for (const axis of PID_AXES) {
        for (const filtering of ['pre', 'post'] as const) {
          await tick()
          const s: PidSettings = { ...state.pid, filtering, axis }
          page.el(filtering === 'pre' ? 'PID_filtering_Pre' : 'PID_filtering_Post').checked = true
          page.call('calculate_pid', AXIS_BUTTONS[axis])
          expect(page.el('PID_title').innerHTML).toBe(AXIS_TITLES[axis])
          expectSamePlot(page.context.BodePID as UpstreamPlot, pidPlot(pidBode(inputs, axis, filtering, s), s))
        }
      }
    },
    TIMEOUT
  )
})
