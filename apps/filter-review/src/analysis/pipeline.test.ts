// End-to-end oracle: load -> FFT -> filter simulation -> plot data, compared against upstream
// FilterReview's calculate(), calculate_transfer_function() and redraw() on the same log.
import { describe, expect, it } from 'vitest'
import { DataflashLog } from '@apwt/dataflash'
import { wrapPhase } from '@apwt/filters'
import { fftAmplitudeScale, fftFrequencyScale, type ComplexArray } from '@apwt/signal'
import { analyseGyro, instanceTransfer, type InstanceTransfer } from './analyse.js'
import { GYRO_AXES } from './fft/batch-fft.js'
import { buildFilters } from './filters/filter-set.js'
import { defaultNotchParams, type FilterParams, type NotchParams } from './filter-params.js'
import type { FilterVersion } from './filter-version.js'
import { loadFilterReviewLog, trackingContext, type LoadOptions } from './load.js'
import { aliasHelper, type AliasMode } from './plots/alias.js'
import { bodeResponse } from './plots/bode.js'
import { harmonicStats, loggedNotchLines, notchMarkers, notchTrackingLines } from './plots/notch-lines.js'
import { spectrogramData } from './plots/spectrogram.js'
import { estimatedPostSpectrum, meanSpectrum } from './plots/spectrum.js'
import { expectArrayClose, expectComplexClose } from './test-utils/compare.js'
import { LogAppender, appendBatchGyro, appendRawGyro, appendTrackingMessages, fixture, patchParam } from './test-utils/logs.js'
import { upstreamLoadGyro } from './test-utils/upstream-load.js'
import { loadFilterReviewUpstream, parseWithUpstream, type Pair } from './test-utils/upstream.js'

interface Scenario {
  name: string
  build: () => Uint8Array
  load: LoadOptions
  window: { windowSize?: number; windowsPerBatch?: number }
  version: FilterVersion
  filters: { gyroFilter: number; loopRate: number; notches: [Partial<NotchParams>, Partial<NotchParams>] }
  view: {
    dB: boolean
    psd: boolean
    rpm: boolean
    alias: AliasMode
    wrap: boolean
    range: [number, number]
    bodeGyro: number
    specGyro: number
    specSource: 'pre' | 'post' | 'est'
    specAxis: 0 | 1 | 2
  }
}

const scenarios: Scenario[] = [
  {
    name: 'raw, ESC per-motor double notch + multi-source throttle triple notch, v4',
    build: () => {
      const log = new LogAppender(fixture('copter-sitl.bin'))
      appendRawGyro(log, [0, 1], 10, 22, 1000)
      appendTrackingMessages(log, 8, 40)
      return log.toBytes()
    },
    load: {},
    window: { windowSize: 512 },
    version: 4,
    filters: {
      gyroFilter: 45,
      loopRate: 400,
      notches: [
        {
          enable: 1,
          mode: 3,
          freq: 60,
          bandwidth: 30,
          attenuation: 35,
          ref: 1,
          minRatio: 0.8,
          harmonics: 0b1011,
          options: 1 | 2
        },
        {
          enable: 1,
          mode: 1,
          freq: 90,
          bandwidth: 40,
          attenuation: 40,
          ref: 0.25,
          minRatio: 0.5,
          harmonics: 1,
          options: 2 | 16 | 32
        }
      ]
    },
    view: {
      dB: true,
      psd: false,
      rpm: false,
      alias: 'none',
      wrap: false,
      range: [12, 19],
      bodeGyro: 0,
      specGyro: 1,
      specSource: 'est',
      specAxis: 1
    }
  },
  {
    name: 'raw pre+post, FFT multi-peak notch + static quintuple notch, aliasing, v2',
    build: () => {
      const log = new LogAppender(patchParam(fixture('copter-sitl.bin'), 'INS_RAW_LOG_OPT', 8))
      appendRawGyro(log, [0, 1, 2, 3], 10, 18, 1200)
      appendTrackingMessages(log, 8, 40)
      return log.toBytes()
    },
    load: {},
    window: { windowSize: 1024 },
    version: 2,
    filters: {
      gyroFilter: 0,
      loopRate: 400,
      notches: [
        { enable: 1, mode: 4, freq: 70, bandwidth: 20, attenuation: 30, ref: 1, minRatio: 1, harmonics: 3, options: 2 },
        { enable: 1, mode: 0, freq: -150, bandwidth: 50, attenuation: 25, ref: 0, minRatio: 1, harmonics: 1, options: 64 }
      ]
    },
    view: {
      dB: false,
      psd: true,
      rpm: true,
      alias: 'on',
      wrap: true,
      range: [11, 17],
      bodeGyro: 1,
      specGyro: 0,
      specSource: 'post',
      specAxis: 2
    }
  },
  {
    name: 'batch pre+post, RPM notch + FFT centre notch, alias only, v1',
    build: () => {
      const log = new LogAppender(patchParam(fixture('copter-sitl.bin'), 'INS_LOG_BAT_OPT', 4))
      appendBatchGyro(log, [0, 1, 2, 3], 10, 12, 1024, 1000)
      appendTrackingMessages(log, 8, 40)
      return log.toBytes()
    },
    load: {},
    window: { windowsPerBatch: 3 },
    version: 1,
    filters: {
      gyroFilter: 20,
      loopRate: 300,
      notches: [
        { enable: 1, mode: 2, freq: 50, bandwidth: 25, attenuation: 40, ref: 2, minRatio: 1, harmonics: 0b111, options: 0 },
        { enable: 1, mode: 4, freq: 80, bandwidth: 40, attenuation: 40, ref: 1, minRatio: 1, harmonics: 1, options: 16 }
      ]
    },
    view: {
      dB: false,
      psd: false,
      rpm: false,
      alias: 'only',
      wrap: false,
      range: [10, 22],
      bodeGyro: 0,
      specGyro: 0,
      specSource: 'pre',
      specAxis: 0
    }
  }
]

function upstreamNotch(p: NotchParams): Record<string, number> {
  return {
    enable: p.enable,
    mode: p.mode,
    freq: p.freq,
    bandwidth: p.bandwidth,
    attenuation: p.attenuation,
    ref: p.ref,
    min_ratio: p.minRatio,
    harmonics: p.harmonics,
    options: p.options
  }
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
  H?: Pair[]
  bode?: { freq: number[]; H?: Pair[] }
}

describe.each(scenarios)('pipeline matches upstream: $name', (s) => {
  it('agrees on FFTs, transfer functions and every plot trace', async () => {
    const bytes = s.build()
    const loaded = loadFilterReviewLog(DataflashLog.parse(bytes), s.load)
    const params: FilterParams = {
      gyroFilter: s.filters.gyroFilter,
      loopRate: s.filters.loopRate,
      notches: [
        { ...defaultNotchParams(), ...s.filters.notches[0] },
        { ...defaultNotchParams(), ...s.filters.notches[1] }
      ]
    }
    loaded.loggedNotches.forEach((l, i) => (l.harmonics = params.notches[i]!.harmonics))

    // ---- mine
    const analysis = analyseGyro(loaded.gyro, loaded.targets.all, s.window)
    const filters = buildFilters(params, loaded.targets.all, s.version)
    expect(filters.notches.every((n) => n.enabled)).toBe(true)
    const transfers: (InstanceTransfer | null)[] = analysis.instances.map((a) =>
      a === null ? null : instanceTransfer(a, filters)
    )

    // ---- upstream
    const up = loadFilterReviewUpstream()
    const upLog = await parseWithUpstream(bytes)
    upstreamLoadGyro(up, upLog, loaded.gyro.type === 'batch')
    up.element('FFTWindow_size').value = String(s.window.windowSize ?? 1024)
    up.element('FFTWindow_per_batch').value = String(s.window.windowsPerBatch ?? 1)
    up.set('__p0', upstreamNotch(params.notches[0]))
    up.set('__p1', upstreamNotch(params.notches[1]))
    up.run(`
      filter_version = ${s.version}
      tracking_methods = [new StaticTarget(), new ThrottleTarget(__log), new RPMTarget(__log, 1, 2), new ESCTarget(__log), new FFTTarget(__log), new RPMTarget(__log, 2, 5)]
      logged_tracking = [new LoggedNotch(__log, 0), new LoggedNotch(__log, 1)]
      Gyro_batch.have_pre = ${loaded.havePre}
      Gyro_batch.have_post = ${loaded.havePost}
      filters = []
      filters.static = new DigitalBiquadFilter(${params.gyroFilter})
      filters.notch = [new HarmonicNotchFilter(__p0), new HarmonicNotchFilter(__p1)]
      for (let i = 0; i < 2; i++) logged_tracking[i].harmonics = filters.notch[i].harmonics()
      calculate()
      calculate_transfer_function()
    `)
    expect(up.alerts).toEqual(filters.notches.flatMap((n) => n.warnings))

    // FFT and transfer functions
    analysis.instances.forEach((a, i) => {
      const theirs = up.run(`Gyro_batch[${i}]?.FFT`) as UpFft | undefined
      if (a === null) {
        expect(theirs, `instance ${i}`).toBeUndefined()
        return
      }
      const fft = theirs!
      expectArrayClose(a.fft.bins, fft.bins, `bins ${i}`)
      expectArrayClose(a.fft.time, fft.time, `time ${i}`)
      expect(a.fft.averageSampleRate).toBe(fft.average_sample_rate)
      expect(a.fft.windowSize).toBe(fft.window_size)
      expect(a.fft.correction).toEqual(fft.correction)
      expect(a.fft.x.length).toBe(fft.x.length)
      for (let j = 0; j < a.fft.x.length; j++) {
        expectArrayClose(a.fft.x[j], fft.x[j], `x ${i}/${j}`)
        expectArrayClose(a.fft.z[j], fft.z[j], `z ${i}/${j}`)
      }
      const t = transfers[i]!
      expect(t.fft === undefined, `H presence ${i}`).toBe(fft.H === undefined)
      expect(t.bode === undefined, `bode presence ${i}`).toBe(fft.bode?.H === undefined)
      t.fft?.forEach((h: ComplexArray, j) => expectComplexClose(h, fft.H![j]!, `H ${i}/${j}`))
      if (t.bode !== undefined) {
        expectArrayClose(a.bode!.freq, fft.bode!.freq, `bode freq ${i}`)
        for (let j = 0; j < t.bode.length; j += 3) expectComplexClose(t.bode[j]!, fft.bode!.H![j]!, `bode H ${i}/${j}`)
      }
    })

    // ---- redraw with the scenario's view settings
    const v = s.view
    const el = (id: string) => up.element(id)
    el('ScaleLog').checked = v.dB
    el('ScalePSD').checked = v.psd
    el('freq_Scale_RPM').checked = v.rpm
    el('Aliasing_none').checked = v.alias === 'none'
    el('Aliasing_only').checked = v.alias === 'only'
    el('SCHED_LOOP_RATE').value = String(params.loopRate)
    el('TimeStart').value = String(v.range[0])
    el('TimeEnd').value = String(v.range[1])
    el('Notch1Show').checked = true
    el('SpecNotch1Show').checked = true
    el('SpecNotch2Show').checked = true
    el('SpecNotchShowLogged').checked = true
    el('ScaleWrap').checked = v.wrap
    el(`BodeGyroInst${v.bodeGyro}`).checked = true
    el(`SpecGyroInst${v.specGyro}`).checked = true
    el('SpecGyroPost').checked = v.specSource === 'post'
    el('SpecGyroEstPost').checked = v.specSource === 'est'
    el(`SpecGyroAxis${'XYZ'[v.specAxis]}`).checked = true
    up.run('setup_plots(); redraw()')

    const amp = fftAmplitudeScale({ dB: v.dB, psd: v.psd })
    const freqScale = fftFrequencyScale({ rpm: v.rpm })
    const range = { start: v.range[0], end: v.range[1] }
    const plotIndex = (sensor: number, type: number, axis: number): number => sensor * 9 + type * 3 + axis
    const trace = (index: number): { x: number[]; y: number[] } =>
      up.run(`fft_plot.data[${index}]`) as { x: number[]; y: number[] }

    // FFT plot: pre/post means and the post-filter estimate
    analysis.instances.forEach((a, i) => {
      if (a === null) return
      const alias = aliasHelper(a.fft, v.alias, params.loopRate)
      GYRO_AXES.forEach((axis, k) => {
        const t = trace(plotIndex(a.instance.sensorNum, a.instance.postFilter ? 1 : 0, k))
        expectArrayClose(freqScale.transform(alias.bins), t.x, `fft x ${i}${axis}`)
        expectArrayClose(amp.scale(alias.apply(meanSpectrum(a.fft, axis, amp, range)!)), t.y, `fft y ${i}${axis}`)
        const h = transfers[i]?.fft
        if (h !== undefined) {
          const est = trace(plotIndex(a.instance.sensorNum, 2, k))
          const mine = estimatedPostSpectrum(a.fft, axis, amp, range, h, loaded.gyro.quantizationNoise)!
          expectArrayClose(amp.scale(alias.apply(mine)), est.y, `est y ${i}${axis}`)
        }
      })
    })

    // Notch markers on the FFT plot
    const ctx = trackingContext(loaded, s.version)
    filters.notches.forEach((notch, i) => {
      const markers = notchMarkers(notch, ctx, range)
      expect(markers.map((m) => m.harmonic).reduce((acc, h) => acc | (1 << (h - 1)), 0)).toBe(notch.harmonics)
      for (const marker of markers) {
        const lineIndex = i * 32 + (marker.harmonic - 1) * 2
        const line = up.run(`fft_plot.layout.shapes[${lineIndex}]`) as { x0: number; visible: boolean }
        const band = up.run(`fft_plot.layout.shapes[${lineIndex + 1}]`) as { x0: number; x1: number }
        expect(line.visible).toBe(i === 0)
        expectArrayClose(
          freqScale.transform([marker.mean, marker.min, marker.max]),
          [line.x0, band.x0, band.x1],
          `marker ${i}/${marker.harmonic}`
        )
      }
    })

    // Bode plot
    let bodeIndex = -1
    analysis.instances.forEach((a, i) => {
      if (a?.instance.sensorNum === v.bodeGyro && a.bode !== undefined) bodeIndex = i
    })
    const bodeA = analysis.instances[bodeIndex]!
    const bode = bodeResponse(bodeA.bode!.freq, transfers[bodeIndex]!.bode!, bodeA.fft.time, range)
    const phases = v.wrap
      ? wrapPhase([bode.phaseMean, bode.phaseMax, bode.phaseMin])
      : [bode.phaseMean, bode.phaseMax, bode.phaseMin]
    const upBode = up.run('Bode.data') as { x: number[]; y: number[] }[]
    expectArrayClose(freqScale.transform(bode.freq), upBode[2]!.x, 'bode x')
    expectArrayClose(amp.scale(bode.ampMean), upBode[2]!.y, 'bode amp')
    expectArrayClose(phases[0], upBode[3]!.y, 'bode phase')
    expectArrayClose(amp.scale([...bode.ampMax, ...Array.from(bode.ampMin).reverse()]), upBode[0]!.y, 'bode amp band')
    expectArrayClose([...phases[1]!, ...Array.from(phases[2]!).reverse()], upBode[1]!.y, 'bode phase band')

    // Spectrogram
    const post = v.specSource === 'post'
    const specA = analysis.instances.find(
      (a) => a !== null && a.fft.x.length > 0 && a.instance.postFilter === post && a.instance.sensorNum === v.specGyro
    )!
    const spec = spectrogramData(specA.fft, {
      axis: GYRO_AXES[v.specAxis]!,
      scale: amp,
      alias: aliasHelper(specA.fft, v.alias, params.loopRate),
      ...(v.specSource === 'est'
        ? { estimate: { transfer: transfers[specA.instance.index]!.fft!, quantizationNoise: loaded.gyro.quantizationNoise } }
        : {})
    })
    const heat = up.run('Spectrogram.data[0]') as { x: number[]; y: number[]; z: (number[] | undefined[])[] }
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
    expect(spec.z.some((row) => row === null)).toBe(loaded.gyro.type === 'raw')

    // Spectrogram tracking lines, simulated and logged
    filters.notches.forEach((notch, i) => {
      expect(notchTrackingLines(notch, ctx).length).toBeGreaterThan(0)
      expect(loggedNotchLines(loaded.loggedNotches[i]!).length).toBeGreaterThan(0)
      for (const line of notchTrackingLines(notch, ctx)) {
        const t = up.run(`Spectrogram.data[${1 + i * 16 + line.harmonic - 1}]`) as { x: number[]; y: number[]; visible: boolean }
        expect(t.visible).toBe(true)
        expectArrayClose(line.time, t.x, `track x ${i}/${line.harmonic}`)
        expectArrayClose(freqScale.transform(line.freq), t.y, `track y ${i}/${line.harmonic}`)
      }
      for (const line of loggedNotchLines(loaded.loggedNotches[i]!)) {
        const t = up.run(`Spectrogram.data[${1 + i * 16 + 32 + line.harmonic - 1}]`) as {
          x: number[]
          y: number[]
          visible: boolean
        }
        expect(t.visible).toBe(true)
        expectArrayClose(line.time, t.x, `logged x ${i}/${line.harmonic}`)
        expectArrayClose(freqScale.transform(line.freq), t.y, `logged y ${i}/${line.harmonic}`)
      }
    })

    // harmonicStats on a multi target averages the peaks
    const multi = filters.notches[0]!.targetFrequency(ctx)!
    expect(Number.isFinite(harmonicStats(multi, 1, 0, range).mean)).toBe(true)
  })
})
