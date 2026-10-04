// Test-only: compare the port with an upstream PID Review page (test-utils/upstream.ts) after
// upstream `load()`, `re_calc()`, `redraw()` and `setup_axis()`: loaded data, FFTs and every plotted
// trace, exactly. Shared by the oracle tests and the real-log tests.
import { expect } from 'vitest'
import { fftAmplitudeScale, fftFrequencyScale, type AmplitudeScale, type FrequencyScale } from '@apwt/signal'
import { spectrogramTrace, spectrumTraces, stepTraces, timeInputTraces, timeOutputTraces } from '../ui/traces.js'
import { computeAxisFft, parseWindowSize } from '../analysis/batch-fft.js'
import type { LoadedLog, PidAxisData, PidAxisFft } from '../analysis/data.js'
import { FFT_KEYS, type FftKey } from '../analysis/keys.js'
import { loadLog } from '../analysis/load.js'
import { stepResponses, type SetStepResponse } from '../analysis/step-response.js'
import { PID_PARAM_KEYS } from '../analysis/vehicle.js'
import { createUpstreamPidReview, type UpTrace, type UpstreamPidReview } from './upstream.js'

export type Range = [number, number]

export interface UpBatch extends Partial<Record<FftKey, ArrayLike<number> | null>> {
  time: ArrayLike<number>
  sample_rate: number
}
export interface UpSetFft extends Partial<Record<FftKey, [number[], number[]][]>> {
  time: number[]
}
export type UpSet = UpBatch[] & { FFT?: UpSetFft | null }
export interface UpPid {
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

export const arr = (a: ArrayLike<number> | null | undefined): number[] => Array.from(a ?? [])
/** A trace's x or y data (Plotly's `Data` union does not expose them on every member). */
export const traceArr = (trace: object, key: 'x' | 'y'): number[] => arr(Reflect.get(trace, key) as ArrayLike<number> | undefined)
export const rows = (z: readonly (ArrayLike<number | null | undefined> | null)[] | undefined) =>
  (z ?? []).map((row) => Array.from(row ?? [], (v) => v ?? null))

export function upPids(up: UpstreamPidReview): UpPid[] {
  return up.evaluate('Array.from(PID_log_messages)') as UpPid[]
}

export function axisOf(log: LoadedLog, id: string[]): PidAxisData | undefined {
  return log.axes.find((a) => a.spec.key === id.join('_'))
}

/** Compare everything `load()` produced. */
export function compareLoad(up: UpstreamPidReview, log: LoadedLog) {
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
export function portFft(log: LoadedLog, windowSize: number): Map<string, PidAxisFft | null> {
  return new Map(log.axes.map((a) => [a.spec.key, computeAxisFft(a.sets, windowSize)]))
}

export function compareFft(up: UpstreamPidReview, fft: Map<string, PidAxisFft | null>) {
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

export interface View {
  amplitude: AmplitudeScale
  frequency: FrequencyScale
  range: Range
  spectrogramKey: FftKey
}

export function upScales(up: UpstreamPidReview, kind: 'linear' | 'dB' | 'PSD', log: boolean, rpm: boolean) {
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
export function comparePlots(
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

export const upRange = (up: UpstreamPidReview): Range => [
  parseFloat(up.element('TimeStart').value),
  parseFloat(up.element('TimeEnd').value)
]

export const spectrogramSelection = (up: UpstreamPidReview): FftKey => FFT_KEYS.find((k) => up.element(`Spec_${k}`).checked)!

export interface ScenarioStep {
  window?: string
  range?: [string, string]
  scale?: ['linear' | 'dB' | 'PSD', boolean, boolean]
  axis?: string
  spec?: FftKey
  action: 're_calc' | 'redraw' | 'setup_axis' | 'none'
}

/**
 * Let the event loop run between steps: upstream and the comparisons are synchronous, and Vitest's
 * worker must answer its runner within 60 s.
 */
export const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

/**
 * Load `buffer` in both, then for each step of `script` (or the script built from the loaded log)
 * change the inputs, run the upstream handler and compare. Tracks the port's step-plot state
 * exactly as App.tsx does.
 */
export async function runScenario(
  buffer: ArrayBuffer,
  script: readonly ScenarioStep[] | ((log: LoadedLog) => readonly ScenarioStep[]) = []
) {
  const up = await createUpstreamPidReview({ fixed: true })
  const err = await up.load(buffer)
  expect(err).toBeUndefined()
  await tick()
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
    return f ? stepResponses(axis.sets, f.axis, range) : prev
  }
  let range = upRange(up)
  expect(range).toEqual([Math.floor(log.startTime), Math.ceil(log.endTime)])
  let steps = portStep(null, range)
  const check = () => {
    const axis = log.axes.find((a) => a.spec.key === key)!
    comparePlots(up, axis, fft.get(key) ?? null, { ...scales, range, spectrogramKey: spectrogramSelection(up) }, steps)
  }
  check()

  for (const step of typeof script === 'function' ? script(log) : script) {
    await tick()
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
