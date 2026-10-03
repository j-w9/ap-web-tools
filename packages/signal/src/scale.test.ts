import { describe, expect, it } from 'vitest'
import { fftAmplitudeScale, fftFrequencyScale } from './scale.js'
import { loadUpstream, randomArray, rng } from './test-utils/upstream.js'

const up = loadUpstream()
const correction = { linear: 2, energy: 1.633 }

describe('fftAmplitudeScale (hand-computed)', () => {
  it('linear is identity', () => {
    const s = fftAmplitudeScale()
    expect(s.kind).toBe('linear')
    expect(Array.from(s.transform([1, 2]))).toEqual([1, 2])
    expect(Array.from(s.scale([1, 2]))).toEqual([1, 2])
    expect(s.windowCorrection(correction, 0.5)).toBe(2)
    expect(s.quantizationCorrection(4)).toBe(0.25)
    expect(s.label).toBe('Amplitude')
  })

  it('dB is 20*log10', () => {
    const s = fftAmplitudeScale({ dB: true })
    expect(s.kind).toBe('dB')
    expect(Array.from(s.scale([10, 100]))).toEqual([20, 40])
    expect(s.hover('y')).toBe('%{y:.2f} dB')
  })

  it('PSD squares then 10*log10 and normalises by bin width', () => {
    const s = fftAmplitudeScale({ dB: true, psd: true })
    expect(s.kind).toBe('PSD')
    expect(Array.from(s.transform([3]))).toEqual([9])
    expect(Array.from(s.scale([100]))).toEqual([20])
    expect(s.windowCorrection({ linear: 1, energy: 2 }, 0.5)).toBe(4) // (2^2 * 0.5) / 0.5
    expect(s.quantizationCorrection(4)).toBe(0.5)
    expect(s.label).toBe('PSD (dB/Hz)')
  })
})

describe('fftFrequencyScale (hand-computed)', () => {
  it('Hz / RPM and axis type', () => {
    const hz = fftFrequencyScale()
    expect(Array.from(hz.transform([1, 2]))).toEqual([1, 2])
    expect(hz.type).toBe('linear')
    expect(hz.label).toBe('Frequency (Hz)')
    const rpm = fftFrequencyScale({ rpm: true, log: true })
    expect(Array.from(rpm.transform([1, 2]))).toEqual([60, 120])
    expect(rpm.type).toBe('log')
    expect(rpm.hover('x')).toBe('%{x:.2f} RPM')
  })
})

describe('scales match upstream', () => {
  const next = rng(7)
  const x = randomArray(next, 40, 0.001, 50)
  const resolution = 0.3

  for (const [dB, psd] of [[false, false], [true, false], [false, true], [true, true]] as const) {
    it(`amplitude dB=${dB} psd=${psd}`, () => {
      const mine = fftAmplitudeScale({ dB, psd })
      const theirs = up.fft_amplitude_scale(dB, psd)
      expect(Array.from(mine.transform(x))).toEqual(theirs.fun(x))
      expect(Array.from(mine.scale(x))).toEqual(theirs.scale(x))
      expect(mine.label).toBe(theirs.label)
      expect(mine.hover('y')).toBe(theirs.hover('y'))
      expect(mine.windowCorrection(correction, resolution)).toBe(theirs.window_correction(correction, resolution))
      const wc = theirs.window_correction(correction, resolution)
      expect(mine.quantizationCorrection(wc)).toBe(theirs.quantization_correction(wc))
    })
  }

  for (const [rpm, log] of [[false, false], [true, false], [false, true], [true, true]] as const) {
    it(`frequency rpm=${rpm} log=${log}`, () => {
      const mine = fftFrequencyScale({ rpm, log })
      const theirs = up.fft_frequency_scale(rpm, log)
      expect(Array.from(mine.transform(x))).toEqual(theirs.fun(x))
      expect(mine.label).toBe(theirs.label)
      expect(mine.hover('x')).toBe(theirs.hover('x'))
      expect(mine.type).toBe(theirs.type)
    })
  }
})
