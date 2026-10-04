// Real-log oracle: runs only when APWT_REAL_LOGS names a directory of DataFlash logs. For every .bin
// in it, the upstream PID Review page (with the port's proven fixes, as the other oracle tests) and
// the port load the same log and every output is compared exactly: loaded batches and parameter
// sets, FFTs and every plotted trace of every controller the log has, under several scales,
// spectrogram signals, FFT windows and time ranges. A log the tool cannot use must fail with
// upstream's alert. Nothing about the logs is recorded here.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { arr, axisOf, runScenario, upPids, type ScenarioStep } from '../test-utils/oracle.js'
import { createUpstreamPidReview } from '../test-utils/upstream.js'
import { WINDOW_NOT_POWER_OF_TWO, parseWindowSize } from './batch-fft.js'
import type { LoadedLog } from './data.js'
import { FFT_KEYS } from './keys.js'
import { LoadError, loadLog } from './load.js'

const dir = process.env['APWT_REAL_LOGS']
const logs =
  dir === undefined
    ? []
    : readdirSync(dir)
        .filter((f) => f.toLowerCase().endsWith('.bin'))
        .sort()
const TIMEOUT = 60 * 60_000

/** What a user would click through on a loaded log. */
function script(log: LoadedLog): ScenarioStep[] {
  const steps: ScenarioStep[] = []
  const first = log.axes[0]!.spec.key
  // Every controller the log has, then back to the first
  for (const axis of log.axes) steps.push({ axis: axis.spec.key, action: 'setup_axis' })
  steps.push({ axis: first, action: 'setup_axis' })
  // Scales and frequency units
  steps.push({ scale: ['linear', false, false], action: 'redraw' })
  steps.push({ scale: ['PSD', true, true], action: 'redraw' })
  steps.push({ scale: ['dB', false, false], action: 'redraw' })
  // Every spectrogram signal (setup_axis moves one the controller lacks back to Output)
  for (const spec of FFT_KEYS) {
    steps.push({ spec, action: 'redraw' })
  }
  // Other FFT windows and a narrower time range
  const start = Math.floor(log.startTime)
  const end = Math.ceil(log.endTime)
  const mid = Math.round((start + end) / 2)
  steps.push({ window: '1024', action: 're_calc' })
  steps.push({ window: '256', range: [String(Math.max(start, mid - 10)), String(Math.min(end, mid + 10))], action: 're_calc' })
  steps.push({ window: '512', range: [String(start), String(end)], action: 're_calc' })
  // Every controller again at the default window
  for (const axis of log.axes) steps.push({ axis: axis.spec.key, action: 'setup_axis' })
  return steps
}

/**
 * The original page (without the port's proven fixes) on the same log. Every real batch reaches
 * rows 1 and 2 of docs/bug-proofs/pid-review.md: the original drops the last sample before each
 * split (`slice(batch_start, j - 1)`) and its rate divides the batch's span by a sample count
 * (`1 / (span / count)`), where the port keeps the sample and divides intervals by span. The batch
 * boundaries, parameter sets and every other sample are the same.
 */
async function expectOriginalDiffersOnlyByRows1And2(buffer: ArrayBuffer, log: LoadedLog): Promise<void> {
  const original = await createUpstreamPidReview()
  expect(await original.load(buffer)).toBeUndefined()
  const pids = upPids(original).filter((p) => p.have_data)
  expect(pids.map((p) => p.id.join('_'))).toEqual(log.axes.map((a) => a.spec.key))
  for (const pid of pids) {
    const axis = axisOf(log, pid.id)!
    const upSets = Array.from(pid.sets!, (set) => set ?? null)
    expect(upSets.length).toBeLessThanOrEqual(axis.sets.length)
    axis.sets.forEach((set, i) => {
      const upSet = upSets[i] ?? null
      expect(set === null).toBe(upSet === null)
      if (set === null || upSet === null) return
      expect(upSet.length).toBe(set.length)
      set.forEach((batch, b) => {
        const ub = upSet[b]!
        const n = batch.time.length
        expect(arr(ub.time)).toEqual(arr(batch.time).slice(0, n - 1))
        for (const key of FFT_KEYS) {
          const v = ub[key]
          if (v == null) expect(batch.signals[key]).toBeUndefined()
          else expect(arr(v)).toEqual(arr(batch.signals[key]).slice(0, n - 1))
        }
        // Port: (n - 1) intervals over the span; original: the span divided by a whole sample count
        const span = batch.time[n - 1]! - batch.time[0]!
        expect(batch.sampleRate).toBe((n - 1) / span)
        const count = Math.round(ub.sample_rate * span)
        expect(count).toBeGreaterThanOrEqual(1)
        expect(count).toBeLessThanOrEqual(n)
        expect(ub.sample_rate).toBe(1 / (span / count))
      })
    })
  }
}

describe.skipIf(dir === undefined)('PID Review matches upstream on real logs', () => {
  it.each(logs.length > 0 ? logs : ['(no logs)'])(
    '%s',
    async (name) => {
      expect(logs.length, `no .bin files in ${dir ?? ''}`).toBeGreaterThan(0)
      const file = readFileSync(join(dir!, name))
      const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
      let refused: unknown
      try {
        loadLog(buffer)
      } catch (e) {
        refused = e
      }
      if (refused !== undefined) {
        // The port refuses the log: upstream must alert the same and stop.
        expect(refused).toBeInstanceOf(LoadError)
        const up = await createUpstreamPidReview({ fixed: true })
        expect(await up.load(buffer)).toBeUndefined()
        expect(up.alerts).toEqual([(refused as LoadError).message])
        return
      }
      const { up, log } = await runScenario(buffer, script)
      await expectOriginalDiffersOnlyByRows1And2(buffer, log)
      expect(up.alerts).toEqual([])
      // A window that is not a power of two: upstream alerts and stops, the port rejects it
      up.element('FFTWindow_size').value = '300'
      up.call('clear_calculation')
      expect(up.call('re_calc')).toBeDefined()
      expect(up.alerts).toEqual([WINDOW_NOT_POWER_OF_TWO])
      expect(parseWindowSize('300')).toBeNull()
    },
    TIMEOUT
  )
})
