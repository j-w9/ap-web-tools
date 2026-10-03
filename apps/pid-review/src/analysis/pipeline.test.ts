// Oracle tests: upstream PIDReview.js runs in node:vm on the same logs and inputs as the port, and
// every loaded value, FFT result and plotted trace is compared exactly.
import { describe, expect, it } from 'vitest'
import { fftAmplitudeScale, fftFrequencyScale, type AmplitudeScale, type FrequencyScale } from '@apwt/signal'
import { createUpstreamPidReview, readFixture, type UpTrace, type UpstreamPidReview } from '../test-utils/upstream.js'
import { buildPidLog, type PidLogOptions } from '../test-utils/synthetic.js'
import { spectrogramTrace, spectrumTraces, stepTraces, timeInputTraces, timeOutputTraces } from '../ui/traces.js'
import { WINDOW_NOT_POWER_OF_TWO, computeAxisFft, parseWindowSize } from './batch-fft.js'
import type { LoadedLog, PidAxisData, PidAxisFft } from './data.js'
import { FFT_KEYS, type FftKey } from './keys.js'
import { LoadError, NO_PID_DATA, UNSUPPORTED_VEHICLE, loadLog } from './load.js'
import { DEFAULT_SHOWN_KEYS, selectionsForAxis, validSets } from './selection.js'
import { carryOverStaleMeans, stepResponses, type SetStepResponse } from './step-response.js'
import { PID_PARAM_KEYS } from './vehicle.js'

type Range = [number, number]

interface UpBatch extends Partial<Record<FftKey, ArrayLike<number> | null>> {
  time: ArrayLike<number>
  sample_rate: number
}
interface UpSetFft extends Partial<Record<FftKey, [number[], number[]][]>> {
  time: number[]
}
type UpSet = UpBatch[] & { FFT?: UpSetFft | null }
interface UpPid {
  id: string[]
  have_data: boolean
  params: { prefix: string | null; sets: (Record<string, number | null> & { start_time: number; end_time: number })[] }
  sets?: (UpSet | null)[] & {
    FFT?: {
      bins: number[]
      average_sample_rate: number
      window_size: number
      correction: { linear: number; energy: number }
    } | null
  }
}

const arr = (a: ArrayLike<number> | null | undefined): number[] => Array.from(a ?? [])
/** A trace's x or y data (Plotly's `Data` union does not expose them on every member). */
const traceArr = (trace: object, key: 'x' | 'y'): number[] => arr(Reflect.get(trace, key) as ArrayLike<number> | undefined)
const rows = (z: readonly (ArrayLike<number | null | undefined> | null)[] | undefined) =>
  (z ?? []).map((row) => Array.from(row ?? [], (v) => v ?? null))

function upPids(up: UpstreamPidReview): UpPid[] {
  return up.evaluate('Array.from(PID_log_messages)') as UpPid[]
}

function axisOf(log: LoadedLog, id: string[]): PidAxisData | undefined {
  return log.axes.find((a) => a.spec.key === id.join('_'))
}

/** Compare everything `load()` produced. */
function compareLoad(up: UpstreamPidReview, log: LoadedLog) {
  const pids = upPids(up)
  expect(log.axes.map((a) => a.spec.key)).toEqual(pids.filter((p) => p.have_data).map((p) => p.id.join('_')))
  expect([log.startTime, log.endTime]).toEqual(up.evaluate('[PID_log_messages.start_time, PID_log_messages.end_time]'))
  for (const pid of pids) {
    if (!pid.have_data) continue
    const axis = axisOf(log, pid.id)!
    expect(axis.paramSets.prefix).toBe(pid.params.prefix)
    expect(axis.paramSets.sets.map((s) => [s.startTime, s.endTime, ...PID_PARAM_KEYS.map((k) => s.values[k])])).toEqual(
      pid.params.sets.map((s) => [s.start_time, s.end_time, ...PID_PARAM_KEYS.map((k) => s[k])])
    )
    const upSets = Array.from(pid.sets!, (s) => s ?? null)
    expect(axis.sets.length).toBeGreaterThanOrEqual(upSets.length)
    axis.sets.forEach((set, i) => {
      const upSet = upSets[i] ?? null
      expect(set === null).toBe(upSet === null)
      if (!set || !upSet) return
      expect(set.length).toBe(upSet.length)
      set.forEach((batch, b) => {
        const ub = upSet[b]!
        expect(batch.sampleRate).toBe(ub.sample_rate)
        expect(arr(batch.time)).toEqual(arr(ub.time))
        for (const key of FFT_KEYS) {
          const v = ub[key]
          if (v == null) expect(batch.signals[key]).toBeUndefined()
          else expect(arr(batch.signals[key])).toEqual(arr(v))
        }
      })
    })
  }
}

/** Port batch FFT of every controller. */
function portFft(log: LoadedLog, windowSize: number): Map<string, PidAxisFft | null> {
  return new Map(log.axes.map((a) => [a.spec.key, computeAxisFft(a.sets, windowSize)]))
}

function compareFft(up: UpstreamPidReview, fft: Map<string, PidAxisFft | null>) {
  for (const pid of upPids(up)) {
    if (!pid.have_data) continue
    const mine = fft.get(pid.id.join('_')) ?? null
    const theirs = pid.sets!.FFT ?? null
    expect(mine === null).toBe(theirs === null)
    if (!mine || !theirs) continue
    expect(arr(mine.axis.bins)).toEqual(arr(theirs.bins))
    expect(mine.axis.averageSampleRate).toBe(theirs.average_sample_rate)
    expect(mine.axis.windowSize).toBe(theirs.window_size)
    expect(mine.axis.correction).toEqual({ ...theirs.correction })
    mine.sets.forEach((set, i) => {
      const upSet = pid.sets![i]?.FFT ?? null
      expect(set === null).toBe(upSet === null)
      if (!set || !upSet) return
      expect(arr(set.time)).toEqual(arr(upSet.time))
      for (const key of FFT_KEYS) {
        const spectra = set.spectra[key] ?? []
        const upSpectra = upSet[key] ?? []
        expect(spectra.length).toBe(upSpectra.length)
        spectra.forEach((s, k) => {
          expect(arr(s.re)).toEqual(arr(upSpectra[k]![0]))
          expect(arr(s.im)).toEqual(arr(upSpectra[k]![1]))
        })
      }
    })
  }
}

interface View {
  amplitude: AmplitudeScale
  frequency: FrequencyScale
  range: Range
  spectrogramKey: FftKey
}

function upScales(up: UpstreamPidReview, kind: 'linear' | 'dB' | 'PSD', log: boolean, rpm: boolean) {
  up.element('ScaleLinear').checked = kind === 'linear'
  up.element('ScaleLog').checked = kind === 'dB'
  up.element('ScalePSD').checked = kind === 'PSD'
  up.element('freq_ScaleLinear').checked = !log
  up.element('freq_ScaleLog').checked = log
  up.element('freq_Scale_Hz').checked = !rpm
  up.element('freq_Scale_RPM').checked = rpm
  return {
    amplitude: fftAmplitudeScale({ dB: kind === 'dB', psd: kind === 'PSD' }),
    frequency: fftFrequencyScale({ log, rpm })
  }
}

/** Compare the plots of the selected controller after an upstream redraw. */
function comparePlots(
  up: UpstreamPidReview,
  axis: PidAxisData,
  fft: PidAxisFft | null,
  view: View,
  steps: readonly (SetStepResponse | null)[] | null
) {
  const shownKeys = new Set(FFT_KEYS.filter((k) => up.element(`PIDX_${k}`).checked))
  const shownSets = axis.sets.map((_, i) => up.element(`set_selection_${i}`).checked)

  // Time domain.
  const upInputs = up.evaluate('TimeInputs') as { data: UpTrace[]; layout: { xaxis: { range: Range } } }
  const upOutputs = up.evaluate('TimeOutputs') as { data: UpTrace[] }
  expect([...upInputs.layout.xaxis.range]).toEqual(view.range)
  for (const [mine, theirs] of [
    [timeInputTraces(axis), upInputs.data],
    [timeOutputTraces(axis), upOutputs.data]
  ] as const) {
    mine.forEach((trace, i) => {
      const t = theirs[i]!
      expect(traceArr(trace, 'x')).toEqual(arr(t.x))
      // For a signal the message lacks, upstream's y holds only the NaN batch separators; the
      // port fills it with NaN. Both draw nothing.
      const y = traceArr(trace, 'y')
      if (arr(t.y).every(Number.isNaN)) expect(y.every(Number.isNaN)).toBe(true)
      else expect(y).toEqual(arr(t.y))
    })
  }

  // Spectrum.
  const upFft = up.evaluate('fft_plot.data') as UpTrace[]
  const traces = spectrumTraces(fft, { ...view, shownKeys, shownSets })
  if (fft) {
    expect(traces.length).toBe(upFft.length)
    traces.forEach((trace, i) => {
      const t = upFft[i]!
      expect(traceArr(trace, 'y')).toEqual(arr(t.y))
      if (t.y !== undefined) {
        expect(traceArr(trace, 'x')).toEqual(arr(t.x))
        expect(Reflect.get(trace, 'visible')).toBe(t.visible)
      }
      expect(Reflect.get(trace, 'meta')).toBe(t.meta)
    })
  }

  // Step response.
  if (fft && steps) {
    const upStep = up.evaluate('step_plot.data') as UpTrace[]
    const mine = stepTraces(steps, shownSets)
    expect(mine.length).toBe(upStep.length)
    mine.forEach((trace, i) => {
      expect(traceArr(trace, 'x')).toEqual(arr(upStep[i]!.x))
      expect(traceArr(trace, 'y')).toEqual(arr(upStep[i]!.y))
    })
  }

  // Spectrogram.
  if (fft) {
    const upSpec = (up.evaluate('Spectrogram.data') as UpTrace[])[0]!
    const spec = spectrogramTrace(fft, view.spectrogramKey, view.amplitude, view.frequency)[0]!
    expect(traceArr(spec, 'x')).toEqual(arr(upSpec.x))
    expect(traceArr(spec, 'y')).toEqual(arr(upSpec.y))
    expect(rows(Reflect.get(spec, 'z') as (number | null)[][])).toEqual(rows(upSpec.z))
    expect([...(up.evaluate('Spectrogram.layout.xaxis.range') as Range)]).toEqual(view.range)
  }
}

const upRange = (up: UpstreamPidReview): Range => [
  parseFloat(up.element('TimeStart').value),
  parseFloat(up.element('TimeEnd').value)
]

const spectrogramSelection = (up: UpstreamPidReview): FftKey => FFT_KEYS.find((k) => up.element(`Spec_${k}`).checked)!

/**
 * Load `buffer` in both, then for each step of `script` change the inputs, run the upstream
 * handler and compare. Tracks the port's step-plot state exactly as App.tsx does.
 */
async function runScenario(
  buffer: ArrayBuffer,
  script: readonly {
    window?: string
    range?: [string, string]
    scale?: ['linear' | 'dB' | 'PSD', boolean, boolean]
    axis?: string
    spec?: FftKey
    action: 're_calc' | 'redraw' | 'setup_axis' | 'none'
  }[] = []
) {
  const up = await createUpstreamPidReview()
  const err = await up.load(buffer)
  expect(err).toBeUndefined()
  const log = loadLog(buffer)
  compareLoad(up, log)

  let windowSize = 512
  let fft = portFft(log, windowSize)
  compareFft(up, fft)

  let key = log.axes[0]!.spec.key
  let scales = upScales(up, 'dB', false, false)
  const portStep = (prev: (SetStepResponse | null)[] | null, range: Range) => {
    const axis = log.axes.find((a) => a.spec.key === key)!
    const f = fft.get(key) ?? null
    return f ? carryOverStaleMeans(prev, stepResponses(axis.sets, f.axis, range), axis.sets) : prev
  }
  let range = upRange(up)
  expect(range).toEqual([Math.floor(log.startTime), Math.ceil(log.endTime)])
  let steps = portStep(null, range)
  const check = () => {
    const axis = log.axes.find((a) => a.spec.key === key)!
    comparePlots(up, axis, fft.get(key) ?? null, { ...scales, range, spectrogramKey: spectrogramSelection(up) }, steps)
  }
  check()

  for (const step of script) {
    if (step.window !== undefined) {
      up.element('FFTWindow_size').value = step.window
      up.call('clear_calculation')
      const parsed = parseWindowSize(step.window)
      if (parsed !== null) windowSize = parsed
    }
    if (step.range) {
      up.element('TimeStart').value = step.range[0]
      up.element('TimeEnd').value = step.range[1]
    }
    if (step.scale) scales = upScales(up, ...step.scale)
    if (step.spec) {
      for (const k of FFT_KEYS) up.element(`Spec_${k}`).checked = k === step.spec
    }
    if (step.axis !== undefined) {
      for (const pid of upPids(up)) up.element(`type_${pid.id.join('_')}`).checked = pid.id.join('_') === step.axis
    }
    if (step.action === 'none') continue
    const e = up.call(step.action)
    expect(e).toBeUndefined()
    if (step.action === 're_calc') fft = portFft(log, windowSize)
    range = upRange(up)
    if (step.action === 'setup_axis') {
      key = step.axis as typeof key
      steps = portStep(null, range)
    } else {
      steps = portStep(steps, range)
    }
    compareFft(up, fft)
    check()
  }
  return { up, log, steps }
}

describe('PID Review against upstream PIDReview.js', () => {
  it('loads the SITL fixtures identically', async () => {
    for (const name of ['copter-sitl.bin', 'copter-files.bin']) {
      const buffer = readFixture(name)
      const up = await createUpstreamPidReview()
      expect(await up.load(buffer)).toBeUndefined()
      compareLoad(up, loadLog(buffer))
    }
  })

  it('analyses the SITL fixture with small windows', async () => {
    await runScenario(readFixture('copter-sitl.bin'), [
      { window: '64', action: 're_calc' },
      { window: '128', action: 're_calc' },
      { range: ['10', '30'], action: 're_calc' },
      { axis: 'RATE_P', action: 'setup_axis' }
    ])
  })

  it('splits batches at gaps and parameter changes, with jitter (copter, D FF)', async () => {
    const buffer = buildPidLog({
      duration: 40,
      jitterUs: 300,
      gaps: [
        [6, 6.2],
        [20, 20.01]
      ],
      changes: [
        { time: 10, name: 'ATC_RAT_RLL_P', value: 0.2 },
        { time: 10.5, name: 'ATC_RAT_RLL_D', value: 0.004 },
        { time: 25, name: 'ATC_RAT_RLL_I', value: 0.2 },
        { time: 25, name: 'ATC_RAT_PIT_P', value: 0.15 }
      ]
    })
    await runScenario(buffer, [
      { action: 'redraw', scale: ['linear', false, false] },
      { action: 'redraw', scale: ['PSD', true, true] },
      { action: 're_calc', window: '1024' },
      { action: 're_calc', window: '256', range: ['8', '27'] },
      { action: 'setup_axis', axis: 'PIDP' },
      { action: 'setup_axis', axis: 'RATE_R' }
    ])
  })

  it('applies an edited time range on the next redraw, without Calculate', async () => {
    const buffer = buildPidLog({ duration: 30, changes: [{ time: 15, name: 'ATC_RAT_RLL_P', value: 0.2 }] })
    await runScenario(buffer, [
      { range: ['3', '12'], action: 'none' },
      { scale: ['linear', false, false], action: 'redraw' },
      { range: ['5', '9'], action: 'none' },
      { axis: 'PIDY', action: 'setup_axis' }
    ])
  })

  it('treats empty and reversed time inputs as upstream does (parseFloat, NaN)', async () => {
    const buffer = buildPidLog({ duration: 20 })
    await runScenario(buffer, [
      { range: ['', ''], action: 're_calc' },
      { range: ['', '10'], action: 're_calc' },
      { range: ['15', '4'], action: 're_calc' },
      { range: ['2.5', '7.25'], action: 're_calc' }
    ])
  })

  it('keeps a stale step mean when a set has no well-excited window (upstream redraw_step)', async () => {
    // Set 2 starts at 15 s; its targets are tiny until 22 s, so a 15-19 s range has no window
    // above 20 deg/s there while the full range does.
    const buffer = buildPidLog({
      duration: 30,
      quietSpans: [[15, 22]],
      changes: [{ time: 15, name: 'ATC_RAT_RLL_P', value: 0.2 }]
    })
    const { log, steps } = await runScenario(buffer, [
      { range: ['0', '30'], action: 're_calc' },
      { range: ['15', '19'], action: 're_calc' },
      { range: ['15', '19'], action: 'redraw', scale: ['linear', false, false] }
    ])
    expect(log.axes[0]!.paramSets.sets.length).toBe(2)
    // The last redraw shows set 2's mean from the full-range redraw, with no individual estimates.
    expect(steps?.[1]?.all).toEqual([])
    expect(steps?.[1]?.mean.length).toBeGreaterThan(0)
  })

  it('reproduces the noise-estimate growth at low logging rates', async () => {
    for (const rateHz of [40, 60, 90]) {
      const buffer = buildPidLog({ rateHz, duration: 60 })
      await runScenario(buffer, [
        { window: '64', action: 're_calc' },
        { window: '128', action: 're_calc' }
      ])
    }
  })

  it('handles logs without D FF and RATE-only controllers', async () => {
    const buffer = buildPidLog({ dff: false, duration: 20 })
    await runScenario(buffer, [
      { spec: 'P', action: 'none' },
      { axis: 'PIDP', action: 'setup_axis' },
      { axis: 'RATE_Y', action: 'setup_axis' }
    ])
  })

  it('reviews plane and rover logs', async () => {
    const plane = buildPidLog({
      buildType: 3,
      banner: 'ArduPlane V4.6.0 (1234abcd)',
      pidMessages: ['PIDR', 'PIDP', 'PIQR'],
      params: { RLL_RATE_P: 0.08, PTCH_RATE_P: 0.1, Q_A_RAT_RLL_P: 0.2 },
      stepAmplitude: 40
    })
    await runScenario(plane, [{ axis: 'PIQR', action: 'setup_axis' }])
    const rover = buildPidLog({
      buildType: 1,
      pidMessages: ['PIDS', 'PIDA'],
      rate: false,
      params: { ATC_STR_RAT_P: 0.2, ATC_SPEED_P: 0.2 }
    })
    await runScenario(rover, [{ axis: 'PIDA', action: 'setup_axis' }])
  })

  it('detects the vehicle as get_version_and_board does', async () => {
    const cases: [PidLogOptions, string | null][] = [
      // No VER: the bracketed boot banner gives the build type.
      [{ buildType: null, banner: 'ArduCopter V4.3.0 (abcdef12)' }, null],
      // Unsupported build types.
      [{ buildType: 7 }, UNSUPPORTED_VEHICLE],
      [{ buildType: 4 }, UNSUPPORTED_VEHICLE],
      // No VER and a banner without the lines that bracket it: upstream ignores the banner.
      [{ buildType: null, banner: 'ArduCopter V4.3.0 (abcdef12)', bracketed: false }, UNSUPPORTED_VEHICLE],
      // VER with an unknown build type: upstream keeps it rather than reading the banner.
      [{ buildType: 0, banner: 'ArduCopter V4.3.0 (abcdef12)' }, UNSUPPORTED_VEHICLE],
      // No VER and no banner.
      [{ buildType: null }, UNSUPPORTED_VEHICLE],
      // Copter log without any controller parameters.
      [{ params: { FOO: 1 } }, NO_PID_DATA]
    ]
    for (const [options, alert] of cases) {
      const buffer = buildPidLog({ duration: 5, ...options })
      const up = await createUpstreamPidReview()
      expect(await up.load(buffer)).toBeUndefined()
      expect(up.alerts).toEqual(alert === null ? [] : [alert])
      if (alert === null) {
        compareLoad(up, loadLog(buffer))
      } else {
        expect(() => loadLog(buffer)).toThrow(LoadError)
        expect(() => loadLog(buffer)).toThrow(alert)
      }
    }
  })

  it('counts controllers without usable batches in the overall time span', async () => {
    // PIDY is logged at 1 Hz (too few samples for a batch) over a longer span than PIDR.
    const buffer = buildPidLog({
      duration: 20,
      rate: false,
      pidMessages: ['PIDR', 'PIDY'],
      spans: { PIDR: [5, 15] },
      decimate: { PIDY: 400 }
    })
    const up = await createUpstreamPidReview()
    await up.load(buffer)
    const log = loadLog(buffer)
    compareLoad(up, log)
    expect(log.axes.map((a) => a.spec.key)).toEqual(['PIDR'])
    expect(log.startTime).toBeLessThan(log.axes[0]!.startTime)
  })

  it('rejects window sizes as upstream does', async () => {
    const buffer = buildPidLog({ duration: 10 })
    for (const window of ['300', '', '0', '-4', '0.5', '512.9', '1']) {
      const up = await createUpstreamPidReview()
      up.element('FFTWindow_size').value = window
      const err = await up.load(buffer)
      const size = parseWindowSize(window)
      if (size === null) {
        expect(up.alerts).toEqual([WINDOW_NOT_POWER_OF_TWO])
      } else {
        expect(up.alerts).toEqual([])
        if (err === undefined) compareFft(up, portFft(loadLog(buffer), size))
        else expect(() => portFft(loadLog(buffer), size)).toThrow()
      }
    }
  })

  it('sets up selections and the Tests table as add_param_sets does', async () => {
    const buffer = buildPidLog({ dff: false, duration: 20, changes: [{ time: 10, name: 'ATC_RAT_RLL_P', value: 0.2 }] })
    const up = await createUpstreamPidReview()
    await up.load(buffer)
    const log = loadLog(buffer)
    const fft = portFft(log, 512)
    let shown: ReadonlySet<FftKey> = new Set(DEFAULT_SHOWN_KEYS)
    let spectrogram: FftKey = 'Out'
    const upShown = () => new Set(FFT_KEYS.filter((k) => up.element(`PIDX_${k}`).checked))
    for (const [key, tick, spec] of [
      ['PIDR', ['P', 'Err', 'D'], 'P'],
      ['RATE_P', ['Out'], 'Tar'],
      ['PIDP', ['FF'], 'Act'],
      ['PIDR', [], 'I']
    ] as const) {
      // Tick boxes and the spectrogram radio on the current controller, then switch.
      for (const k of tick) up.element(`PIDX_${k}`).checked = true
      for (const k of FFT_KEYS) up.element(`Spec_${k}`).checked = k === spec
      shown = new Set([...shown, ...tick])
      spectrogram = spec
      for (const pid of upPids(up)) up.element(`type_${pid.id.join('_')}`).checked = pid.id.join('_') === key
      up.call('setup_axis')
      const axis = log.axes.find((a) => a.spec.key === key)!
      const next = selectionsForAxis(axis, shown, spectrogram)
      shown = next.shown
      spectrogram = next.spectrogram
      expect([...shown].sort()).toEqual([...upShown()].sort())
      expect(spectrogram).toBe(spectrogramSelection(up))
      const valid = validSets(axis, fft.get(key) ?? null)
      expect(valid).toEqual(axis.sets.map((_, i) => up.element(`set_selection_${i}`).checked))
    }
  })
})
