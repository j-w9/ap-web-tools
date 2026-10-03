import { describe, expect, it } from 'vitest'
import { complexAbs, complexConj, complexDiv, complexMul } from './complex.js'
import {
  RealFft,
  fromInterleaved,
  isPowerOfTwo,
  realLength,
  rfftFreq,
  runFft,
  stepWindowSize,
  toDoubleSided,
  toInterleaved
} from './fft.js'
import { hanning, windowCorrectionFactors } from './window.js'
import { fromPair, loadUpstream, randomArray, rng, toPair, upstreamFft } from './test-utils/upstream.js'

const up = loadUpstream()

describe('realLength / rfftFreq', () => {
  it('hand-computed', () => {
    expect(realLength(8)).toBe(5)
    expect(realLength(7)).toBe(4)
    // 8 points at 1 kHz: bins every 125 Hz up to Nyquist 500 Hz
    expect(Array.from(rfftFreq(8, 0.001))).toEqual([0, 125, 250, 375, 500])
  })

  it('match upstream bit-for-bit', () => {
    for (const [len, d] of [
      [8, 0.001],
      [1024, 1 / 400],
      [4096, 1 / 8000],
      [1000, 0.0125]
    ]) {
      expect(realLength(len!)).toBe(up.real_length(len!))
      expect(Array.from(rfftFreq(len!, d!))).toEqual(up.rfft_freq(len!, d!))
    }
  })
})

describe('power-of-two helpers', () => {
  it('isPowerOfTwo', () => {
    expect([1, 2, 64, 1024].every(isPowerOfTwo)).toBe(true)
    expect([0, 3, 6, 1000, -2, 2.5].some(isPowerOfTwo)).toBe(false)
  })

  it('stepWindowSize mirrors upstream fft_window_size_inc logic', () => {
    expect(stepWindowSize(1024, 'up')).toBe(2048)
    expect(stepWindowSize(1024, 'down')).toBe(512)
    expect(stepWindowSize(1000, 'up')).toBe(1024)
    expect(stepWindowSize(1000, 'down')).toBe(512)
  })
})

describe('RealFft', () => {
  it('rejects non power-of-two sizes', () => {
    expect(() => new RealFft(12)).toThrow()
  })

  it('forward real transform of a cosine puts energy in one bin', () => {
    const n = 64
    const fft = new RealFft(n)
    const x = Float64Array.from({ length: n }, (_, i) => Math.cos((2 * Math.PI * 4 * i) / n))
    const out = fft.createComplexArray()
    fft.realTransform(out, x)
    const spec = fromInterleaved(out, fft.realLength)
    const mag = complexAbs(spec)
    expect(mag[4]).toBeCloseTo(n / 2, 9)
    expect(mag[3]).toBeCloseTo(0, 9)
    expect(mag[0]).toBeCloseTo(0, 9)
  })

  it('inverse undoes forward (complex round trip)', () => {
    const n = 16
    const fft = new RealFft(n)
    const next = rng(5)
    const x = randomArray(next, n)
    const spec = fft.createComplexArray()
    fft.realTransform(spec, x)
    fft.completeSpectrum(spec)
    const back = fft.createComplexArray()
    fft.inverseTransform(back, spec)
    for (let i = 0; i < n; i++) {
      expect(back[2 * i]).toBeCloseTo(x[i]!, 10)
      expect(back[2 * i + 1]).toBeCloseTo(0, 10)
    }
  })
})

describe('runFft', () => {
  const next = rng(2024)
  const windowSize = 64
  const windowSpacing = 32
  const window = hanning(windowSize)

  it('recovers a known sinusoid amplitude after window correction', () => {
    const n = 640
    const amp = 3
    const bin = 8
    const x = Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * bin * i) / windowSize))
    const res = runFft({ x }, ['x'], { windowSize, windowSpacing, window, fft: new RealFft(windowSize) })
    const correction = windowCorrectionFactors(window)
    expect(res.center.length).toBe(Math.floor((n - windowSize) / windowSpacing) + 1)
    expect(res.center[0]).toBe(32)
    expect(res.center[1]).toBe(64)
    for (const spectrum of res.spectra.x) {
      const mag = complexAbs(spectrum)
      expect(mag.length).toBe(realLength(windowSize))
      // The symmetric (N-1) Hann window is not exactly periodic, so expect ~0.01% leakage.
      expect(mag[bin]! * correction.linear).toBeCloseTo(amp, 3)
      expect(mag[bin + 3]! * correction.linear).toBeLessThan(amp * 1e-2)
    }
    expect(res.max).toBeUndefined()
  })

  it('takeMax records the peak of the windowed data', () => {
    const x = randomArray(next, 200)
    const res = runFft({ x }, ['x'], { windowSize, windowSpacing, window, fft: new RealFft(windowSize), takeMax: true })
    expect(res.max.x.length).toBe(res.center.length)
    const firstWindow = x.slice(0, windowSize).map((v, i) => Math.abs(v * window[i]!))
    expect(res.max.x[0]).toBe(Math.max(...firstWindow))
  })

  it('returns zero windows when the data is shorter than one window', () => {
    const res = runFft({ x: [1, 2, 3] }, ['x'], { windowSize, windowSpacing, window, fft: new RealFft(windowSize) })
    expect(res.center.length).toBe(0)
    expect(res.spectra.x).toEqual([])
  })

  it('throws for missing keys and mismatched fft size', () => {
    const fft = new RealFft(windowSize)
    // A key missing from `data` is rejected at compile time; the runtime guard covers untyped callers.
    // @ts-expect-error -- 'y' is not a key of data
    expect(() => runFft({ x: [] }, ['y'], { windowSize, windowSpacing, window, fft })).toThrow(TypeError)
    expect(() => runFft({ x: [] }, ['x'], { windowSize, windowSpacing, window, fft: new RealFft(32) })).toThrow(RangeError)
  })

  for (const takeMax of [false, true]) {
    it(`matches upstream run_fft bit-for-bit (takeMax=${takeMax})`, () => {
      const n = 64 + Math.floor(next() * 1000)
      const data = { x: randomArray(next, n), y: randomArray(next, n, -100, 100), z: randomArray(next, n) }
      const keys = ['x', 'y', 'z'] as const
      const mine = runFft(data, keys, { windowSize, windowSpacing, window, fft: new RealFft(windowSize), takeMax })
      const theirs = up.run_fft(data, [...keys], windowSize, windowSpacing, Array.from(window), upstreamFft(windowSize), takeMax)

      expect(Array.from(mine.center)).toEqual(theirs.center)
      for (const key of keys) {
        const theirSpectra = theirs[key] as [number[], number[]][]
        expect(mine.spectra[key].length).toBe(theirSpectra.length)
        for (let i = 0; i < theirSpectra.length; i++) {
          expect(toPair(mine.spectra[key][i]!)).toEqual(theirSpectra[i])
        }
        if (takeMax) {
          expect(Array.from(mine.max![key])).toEqual(theirs[key + 'Max'])
        } else {
          expect(theirs[key + 'Max']).toBeUndefined()
        }
      }
    })
  }
})

describe('toDoubleSided / toInterleaved / fromInterleaved', () => {
  it('toDoubleSided hand-computed', () => {
    const x = { re: [1, 2, 3], im: [0, 4, 0] } // real length 3 -> full length 4
    const d = toDoubleSided(x)
    expect(Array.from(d.re)).toEqual([1, 1, 3, 1])
    expect(Array.from(d.im)).toEqual([0, 2, 0, -2])
  })

  it('interleaved round trip', () => {
    const buf = new Float64Array(6)
    toInterleaved(buf, { re: [1, 2, 3], im: [4, 5, 6] })
    expect(Array.from(buf)).toEqual([1, 4, 2, 5, 3, 6])
    const back = fromInterleaved(buf)
    expect(Array.from(back.re)).toEqual([1, 2, 3])
    expect(Array.from(back.im)).toEqual([4, 5, 6])
    expect(fromInterleaved(buf, 2).re.length).toBe(2)
  })

  it('match upstream on random spectra', () => {
    const next = rng(31)
    const X: [number[], number[]] = [randomArray(next, 33), randomArray(next, 33)]
    expect(toPair(toDoubleSided(fromPair(X)))).toEqual(up.to_double_sided(X))
    const mine = new Array<number>(66).fill(0)
    const theirs = new Array<number>(66).fill(0)
    toInterleaved(mine, fromPair(X))
    up.to_fft_format(theirs, X)
    expect(mine).toEqual(theirs)
  })

  it('reproduces the upstream PIDReview step-response pipeline', () => {
    // Same chain as PIDReview.js: runFft -> toDoubleSided -> conj/mul/div -> toInterleaved -> inverse.
    const windowSize = 128
    const window = hanning(windowSize)
    const next = rng(77)
    const n = 512
    const data = { Tar: randomArray(next, n), Act: randomArray(next, n) }
    const fft = new RealFft(windowSize)
    const res = runFft(data, ['Tar', 'Act'], { windowSize, windowSpacing: 8, window, fft, takeMax: true })
    const upRes = up.run_fft(data, ['Tar', 'Act'], windowSize, 8, Array.from(window), upstreamFft(windowSize), true)

    const X = toDoubleSided(res.spectra.Tar[0]!)
    const Y = toDoubleSided(res.spectra.Act[0]!)
    const Xcon = complexConj(X)
    const H = complexDiv(complexMul(Y, Xcon), complexMul(X, Xcon))
    const tf = fft.createComplexArray()
    toInterleaved(tf, H)
    const impulse = fft.createComplexArray()
    fft.inverseTransform(impulse, tf)

    const uX = up.to_double_sided((upRes['Tar'] as [number[], number[]][])[0]!)
    const uY = up.to_double_sided((upRes['Act'] as [number[], number[]][])[0]!)
    const uXcon = up.complex_conj(uX)
    const uH = up.complex_div(up.complex_mul(uY, uXcon), up.complex_mul(uX, uXcon))
    const ufft = upstreamFft(windowSize)
    const utf = ufft.createComplexArray()
    up.to_fft_format(utf, uH)
    const uImpulse = ufft.createComplexArray()
    ufft.inverseTransform(uImpulse, utf)

    expect(Array.from(impulse)).toEqual(uImpulse)
  })
})
