// PID Review `find_start_index` / `find_end_index` and the spectrum mean over the selected windows.
import { describe, expect, it } from 'vitest'
import { loadPidReview } from './_harness'

/** Window centre times 10, 11, ..., 19 s. */
const centres = Array.from({ length: 10 }, (_, i) => 10 + i)

function indices(start: string, end: string): [number, number] {
  const page = loadPidReview()
  page.element('TimeStart').value = start
  page.element('TimeEnd').value = end
  page.set('__t', centres)
  return page.run('[find_start_index(__t), find_end_index(__t) + 1]') as [number, number]
}

describe('analysis time window indices', () => {
  it('includes the window before the start and the first window after the end', () => {
    // 12.5..15.5 s: windows 12 (before start) to 16 (first after end) inclusive.
    expect(indices('12.5', '15.5')).toEqual([2, 7])
  })

  it('averages the first window for a range wholly before the data', () => {
    expect(indices('0', '5')).toEqual([0, 1])
  })

  it('gives a negative mean length (-6) for a reversed range', () => {
    const [start, end] = indices('18.5', '10.5')
    expect([start, end]).toEqual([8, 2])
    expect(end - start).toBe(-6)
  })

  it('turns the empty sum into -0, and -Infinity in dB', () => {
    // redraw: corrected = array_scale(mean, window_correction / mean_length); y = amplitude_scale.scale(corrected)
    const page = loadPidReview()
    const linear = page.run('array_scale([0, 0], 1.5 / -6)') as number[]
    expect(linear.map((v) => Object.is(v, -0))).toEqual([true, true])
    expect(page.run('fft_amplitude_scale(true, false).scale(array_scale([0, 0], 1.5 / -6))')).toEqual([-Infinity, -Infinity])
    // The same empty sum with a zero length (no windows) is NaN, not plotted.
    expect(page.run('array_scale([0, 0], 1.5 / 0)')).toEqual([NaN, NaN])
  })
})
