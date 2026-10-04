// Test-only: compare the port's page state, FFTs, filter responses and plot data with an upstream
// FilterReview page (test-utils/upstream-page.ts) after upstream `load()`, `re_calc()` or `redraw()`.
// Shared by the page oracle tests and the real-log tests; every comparison is exact.
import { expect } from 'vitest'
import { wrapPhase } from '@apwt/filters'
import { fftAmplitudeScale, fftFrequencyScale, type ComplexArray } from '@apwt/signal'
import { instanceTransfer, type InstanceTransfer } from '../analyse.js'
import { GYRO_AXES } from '../fft/batch-fft.js'
import { buildFilters, type FilterSet } from '../filters/filter-set.js'
import { trackingContext } from '../load.js'
import { FILTER_PARAM_NAMES, filterParamsFromPage, type FilterParamName, type PageValues } from '../page-values.js'
import { aliasHelper, type AliasMode } from '../plots/alias.js'
import { bodeResponse } from '../plots/bode.js'
import { loggedNotchLines, notchMarkers, notchTrackingLines } from '../plots/notch-lines.js'
import { spectrogramData } from '../plots/spectrogram.js'
import { estimatedPostSpectrum, meanSpectrum } from '../plots/spectrum.js'
import { SPECTRUM_KINDS, spectrumTraceKey } from '../selections.js'
import type { LoadedPage } from '../session.js'
import { expectArrayClose, expectComplexClose } from './compare.js'
import type { UpstreamPage } from './upstream-page.js'
import type { Pair } from './upstream.js'

/** Upstream filter inputs as the page holds them. */
export function upstreamValues(page: UpstreamPage): PageValues {
  return Object.fromEntries(FILTER_PARAM_NAMES.map((n) => [n, page.element(n).value])) as Record<FilterParamName, string>
}

/** The port's filters for page values. */
export function portFilters(mine: LoadedPage, values: PageValues): FilterSet {
  return buildFilters(filterParamsFromPage(values, mine.log.sixteenHarmonics), mine.log.targets.all, mine.log.filterVersion)
}

/** Page inputs, log type, time range, default selections and alerts after upstream `load()`. */
export function expectSamePage(page: UpstreamPage, mine: LoadedPage): void {
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
  const filters = portFilters(mine, mine.inputs.values)
  const mineAlerts = [...mine.log.warnings, ...(mine.result.error !== null ? [mine.result.error] : [])]
  if (mine.result.analysis?.warning !== undefined) mineAlerts.push(mine.result.analysis.warning)
  mineAlerts.push(...filters.notches.flatMap((n) => n.warnings))
  // Every upstream alert is shown; the port also shows some messages upstream only logs to the console
  const mineSet = new Set(mineAlerts)
  for (const alert of page.alerts) expect(mineSet, 'upstream alert').toContain(alert)
  const upstreamMessages = new Set([...page.alerts, ...page.consoleMessages])
  for (const message of mineAlerts) expect(upstreamMessages, 'port warning').toContain(message)
}

/** Compare upstream FFT.H with the port's transfer functions for the given page values. */
export function expectSameTransfer(page: UpstreamPage, mine: LoadedPage, values: PageValues): void {
  const filters = portFilters(mine, values)
  mine.result.analysis!.instances.forEach((a, i) => {
    if (a === null) return
    const theirs = page.run(`Gyro_batch[${i}].FFT.H`) as Pair[] | undefined
    const t = instanceTransfer(a, filters)
    expect(t.fft === undefined).toBe(theirs == null)
    t.fft?.forEach((h, j) => expectComplexClose(h, theirs![j]!, `H ${i}/${j}`))
  })
}

interface UpFft {
  bins: number[]
  time: number[]
  average_sample_rate: number
  window_size: number
  correction: { linear: number; energy: number }
  x: number[][]
  y: number[][]
  z: number[][]
  H?: Pair[] | null
  bode?: { freq: number[]; H?: Pair[] } | null
}

/**
 * Every instance's FFT (bins, window times, rate, size, correction, all three axes) and filter
 * response on the FFT bins and on the Bode grid, for the filters of `values`. Returns the port's
 * transfer functions for the plot comparisons.
 */
export function expectSameAnalysis(page: UpstreamPage, mine: LoadedPage, values: PageValues): (InstanceTransfer | null)[] {
  const analysis = mine.result.analysis!
  const filters = portFilters(mine, values)
  expect(page.run('Gyro_batch.length')).toBe(analysis.instances.length)
  return analysis.instances.map((a, i) => {
    const theirs = page.run(`Gyro_batch[${i}]?.FFT`) as UpFft | null | undefined
    if (a === null) {
      expect(page.run(`Gyro_batch[${i}] == null`), `instance ${i}`).toBe(true)
      return null
    }
    const fft = theirs!
    expect(a.instance.sensorNum).toBe(page.run(`Gyro_batch[${i}].sensor_num`))
    expect(a.instance.postFilter).toBe(page.run(`Gyro_batch[${i}].post_filter`))
    expectArrayClose(a.fft.bins, fft.bins, `bins ${i}`)
    expectArrayClose(a.fft.time, fft.time, `time ${i}`)
    expect(a.fft.averageSampleRate).toBe(fft.average_sample_rate)
    expect(a.fft.windowSize).toBe(fft.window_size)
    expect(a.fft.correction).toEqual(fft.correction)
    expect(a.fft.x.length).toBe(fft.x.length)
    for (let j = 0; j < a.fft.x.length; j++) {
      expectArrayClose(a.fft.x[j], fft.x[j], `x ${i}/${j}`)
      expectArrayClose(a.fft.y[j], fft.y[j], `y ${i}/${j}`)
      expectArrayClose(a.fft.z[j], fft.z[j], `z ${i}/${j}`)
    }
    const t = instanceTransfer(a, filters)
    expect(t.fft === undefined, `H presence ${i}`).toBe(fft.H == null)
    expect(t.bode === undefined, `bode presence ${i}`).toBe(fft.bode?.H == null)
    t.fft?.forEach((h: ComplexArray, j) => expectComplexClose(h, fft.H![j]!, `H ${i}/${j}`))
    if (t.bode !== undefined) {
      expectArrayClose(a.bode!.freq, fft.bode!.freq, `bode freq ${i}`)
      t.bode.forEach((h, j) => expectComplexClose(h, fft.bode!.H![j]!, `bode H ${i}/${j}`))
    }
    return t
  })
}

/** The view upstream's `redraw()` reads from the page inputs. */
export interface PageView {
  readonly dB: boolean
  readonly psd: boolean
  readonly rpm: boolean
  readonly alias: AliasMode
  readonly wrap: boolean
  readonly range: { readonly start: number; readonly end: number }
  readonly bodeGyro: number
  readonly specGyro: number
  readonly specSource: 'pre' | 'post' | 'est'
  readonly specAxis: 0 | 1 | 2
}

/** Radio index of a group of three ids (upstream checks 0, then 1, else 2). */
function radio3(page: UpstreamPage, ids: readonly [string, string, string]): 0 | 1 | 2 {
  return page.element(ids[0]).checked ? 0 : page.element(ids[1]).checked ? 1 : 2
}

/** Read the current view from the upstream page inputs. */
export function pageView(page: UpstreamPage): PageView {
  const el = (id: string) => page.element(id)
  return {
    dB: el('ScaleLog').checked,
    psd: el('ScalePSD').checked,
    rpm: el('freq_Scale_RPM').checked,
    alias: el('Aliasing_none').checked ? 'none' : el('Aliasing_only').checked ? 'only' : 'on',
    wrap: el('ScaleWrap').checked,
    range: { start: parseFloat(el('TimeStart').value), end: parseFloat(el('TimeEnd').value) },
    bodeGyro: radio3(page, ['BodeGyroInst0', 'BodeGyroInst1', 'BodeGyroInst2']),
    specGyro: radio3(page, ['SpecGyroInst0', 'SpecGyroInst1', 'SpecGyroInst2']),
    specSource: el('SpecGyroEstPost').checked ? 'est' : el('SpecGyroPost').checked ? 'post' : 'pre',
    specAxis: radio3(page, ['SpecGyroAxisX', 'SpecGyroAxisY', 'SpecGyroAxisZ'])
  }
}

/**
 * Every plot after an upstream `redraw()`: FFT means (logged and estimated) of every instance, notch
 * markers, the Bode plot of the selected IMU, the spectrogram of the selected IMU, source and axis,
 * and its simulated and logged notch tracking lines. Uses the view the page inputs hold.
 */
export function expectSameRedraw(
  page: UpstreamPage,
  mine: LoadedPage,
  values: PageValues,
  transfers: readonly (InstanceTransfer | null)[]
): void {
  const v = pageView(page)
  const analysis = mine.result.analysis!
  const filters = portFilters(mine, values)
  const loopRate = filterParamsFromPage(values, mine.log.sixteenHarmonics).loopRate
  const amp = fftAmplitudeScale({ dB: v.dB, psd: v.psd })
  const freqScale = fftFrequencyScale({ rpm: v.rpm })
  const range = v.range
  const plotIndex = (sensor: number, type: number, axis: number): number => sensor * 9 + type * 3 + axis
  const trace = (index: number) => page.run(`fft_plot.data[${index}]`) as { x: number[]; y: number[] }

  // FFT plot: pre/post means and the post-filter estimate
  analysis.instances.forEach((a, i) => {
    if (a === null || a.fft.x.length === 0) return
    const alias = aliasHelper(a.fft, v.alias, loopRate)
    GYRO_AXES.forEach((axis, k) => {
      const t = trace(plotIndex(a.instance.sensorNum, a.instance.postFilter ? 1 : 0, k))
      expectArrayClose(freqScale.transform(alias.bins), t.x, `fft x ${i}${axis}`)
      expectArrayClose(amp.scale(alias.apply(meanSpectrum(a.fft, axis, amp, range)!)), t.y, `fft y ${i}${axis}`)
      const h = transfers[i]?.fft
      if (h !== undefined) {
        const est = trace(plotIndex(a.instance.sensorNum, 2, k))
        const estimate = estimatedPostSpectrum(a.fft, axis, amp, range, h, mine.log.gyro.quantizationNoise)!
        expectArrayClose(freqScale.transform(alias.bins), est.x, `est x ${i}${axis}`)
        expectArrayClose(amp.scale(alias.apply(estimate)), est.y, `est y ${i}${axis}`)
      }
    })
  })

  // Notch markers on the FFT plot
  const ctx = trackingContext(mine.log)
  filters.notches.forEach((notch, i) => {
    const markers = notchMarkers(notch, ctx, range)
    const show = page.element(`Notch${i + 1}Show`).checked
    for (let h = 0; h < 16; h++) {
      const marker = markers.find((m) => m.harmonic === h + 1)
      const lineIndex = i * 32 + h * 2
      const line = page.run(`fft_plot.layout.shapes[${lineIndex}]`) as { x0: number; x1: number; visible: boolean }
      const band = page.run(`fft_plot.layout.shapes[${lineIndex + 1}]`) as { x0: number; x1: number; visible: boolean }
      if (marker === undefined) {
        expect([line.visible, band.visible], `marker ${i}/${h + 1} hidden`).toEqual([false, false])
        continue
      }
      expect([line.visible, band.visible]).toEqual([show, show])
      expectArrayClose(
        freqScale.transform([marker.mean, marker.mean, marker.min, marker.max]),
        [line.x0, line.x1, band.x0, band.x1],
        `marker ${i}/${marker.harmonic}`
      )
    }
  })

  // Bode plot: the last instance of the selected IMU with a Bode response, as upstream picks it
  let bodeIndex = -1
  analysis.instances.forEach((a, i) => {
    if (a !== null && a.fft.x.length > 0 && a.instance.sensorNum === v.bodeGyro && transfers[i]?.bode !== undefined) bodeIndex = i
  })
  if (bodeIndex >= 0) {
    const bodeA = analysis.instances[bodeIndex]!
    const bode = bodeResponse(bodeA.bode!.freq, transfers[bodeIndex]!.bode!, bodeA.fft.time, range)
    const phases = v.wrap
      ? wrapPhase([bode.phaseMean, bode.phaseMax, bode.phaseMin])
      : [bode.phaseMean, bode.phaseMax, bode.phaseMin]
    const upBode = page.run('Bode.data') as { x: number[]; y: number[] }[]
    expectArrayClose(freqScale.transform(bode.freq), upBode[2]!.x, 'bode x')
    expectArrayClose(amp.scale(bode.ampMean), upBode[2]!.y, 'bode amp')
    expectArrayClose(phases[0], upBode[3]!.y, 'bode phase')
    expectArrayClose(amp.scale([...bode.ampMax, ...Array.from(bode.ampMin).reverse()]), upBode[0]!.y, 'bode amp band')
    expectArrayClose([...phases[1]!, ...Array.from(phases[2]!).reverse()], upBode[1]!.y, 'bode phase band')
  }

  // Spectrogram of the selected IMU and source, as upstream `find_instance` picks it
  const post = v.specSource === 'post'
  const specA = analysis.instances.find(
    (a) => a !== null && a.fft.x.length > 0 && a.instance.postFilter === post && a.instance.sensorNum === v.specGyro
  )
  if (specA != null) {
    const spec = spectrogramData(specA.fft, {
      axis: GYRO_AXES[v.specAxis]!,
      scale: amp,
      alias: aliasHelper(specA.fft, v.alias, loopRate),
      ...(v.specSource === 'est'
        ? { estimate: { transfer: transfers[specA.instance.index]!.fft!, quantizationNoise: mine.log.gyro.quantizationNoise } }
        : {})
    })
    const heat = page.run('Spectrogram.data[0]') as { x: number[]; y: number[]; z: (number[] | undefined[])[] }
    expectArrayClose(spec.time, heat.x, 'spec time')
    expectArrayClose(freqScale.transform(spec.freq), heat.y, 'spec freq')
    expect(spec.z.length).toBe(heat.z.length)
    spec.z.forEach((row, j) => {
      if (row === null)
        expect(
          heat.z[j]!.every((e) => e === undefined),
          `gap ${j}`
        ).toBe(true)
      else expectArrayClose(row, heat.z[j] as number[], `spec z ${j}`)
    })

    // Spectrogram tracking lines, simulated and logged (only drawn while the notch is enabled)
    const showLogged = page.element('SpecNotchShowLogged').checked
    filters.notches.forEach((notch, i) => {
      const show = page.element(`SpecNotch${i + 1}Show`).checked
      const lines = notchTrackingLines(notch, ctx)
      const logged = notch.enabled && mine.log.loggedNotches[i]!.haveData() ? loggedNotchLines(mine.log.loggedNotches[i]!) : []
      for (let h = 0; h < 16; h++) {
        type Line = { x: number[]; y: number[]; visible: boolean }
        const t = page.run(`Spectrogram.data[${1 + i * 16 + h}]`) as Line
        const line = lines.find((l) => l.harmonic === h + 1)
        expect(t.visible, `track visible ${i}/${h + 1}`).toBe(line !== undefined && show)
        if (line !== undefined) {
          expectArrayClose(line.time, t.x, `track x ${i}/${line.harmonic}`)
          expectArrayClose(freqScale.transform(line.freq), t.y, `track y ${i}/${line.harmonic}`)
        }
        const l = page.run(`Spectrogram.data[${1 + i * 16 + 32 + h}]`) as Line
        const loggedLine = logged.find((x) => x.harmonic === h + 1)
        expect(l.visible, `logged visible ${i}/${h + 1}`).toBe(loggedLine !== undefined && show && showLogged)
        if (loggedLine !== undefined) {
          expectArrayClose(loggedLine.time, l.x, `logged x ${i}/${loggedLine.harmonic}`)
          expectArrayClose(freqScale.transform(loggedLine.freq), l.y, `logged y ${i}/${loggedLine.harmonic}`)
        }
      }
    })
  }
}
