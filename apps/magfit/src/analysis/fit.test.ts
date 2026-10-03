import { describe, expect, it } from 'vitest'
import { SYNTHETIC_COMPASSES, buildSyntheticMagLog } from '../test-utils/synthetic-mag-log.js'
import { applyParams, removeCalibration, rotateField, scaleValid } from './calibration.js'
import { defaultFitKind, fitCompass, paramsValid, weightedRms, type FitSet } from './fit.js'
import { loadMagFitLog } from './load.js'
import { runMagFit } from './magfit.js'
import type { CalParams } from './params.js'
import { vec3Distance, vec3Series } from './vector.js'

describe('fits', () => {
  const data = loadMagFitLog(buildSyntheticMagLog())
  const result = runMagFit(data, {
    timeStart: data.startTime,
    timeEnd: data.endTime,
    attitudeSource: data.defaultAttitudeSource!,
    orientation: ['fix90']
  })

  it('recovers the true iron, scale, offsets and current compensation', () => {
    const truth = SYNTHETIC_COMPASSES[1]!
    const motorFit = result.compasses[1]!.groups[1]!
    expect(motorFit.name).toBe('Battery 1 current')
    const iron = motorFit.fits.iron
    expect(iron.valid).toBe(true)
    if (!iron.valid) return
    iron.params.offsets.forEach((v, i) => expect(v).toBeCloseTo(truth.trueOffsets[i]!, 0))
    iron.params.motor.forEach((v, i) => expect(v).toBeCloseTo(truth.trueMotor[i]!, 1))
    expect(iron.params.scale).toBeCloseTo(truth.trueScale, 2)
    expect(iron.params.fitType).toBe(2)
    // Residual is the injected noise plus int16 quantisation, a few mGauss.
    expect(iron.meanError).toBeLessThan(5)
    const noMotor = result.compasses[1]!.groups[0]!.fits.iron
    expect(noMotor.valid && iron.meanError < noMotor.meanError / 5).toBe(true)
    // Motor fits are never ticked by default.
    expect(motorFit.defaultKind).toBeUndefined()
  })

  it('recovers offsets after fixing the orientation', () => {
    const truth = SYNTHETIC_COMPASSES[0]!
    const c = result.compasses[0]!
    expect(c.orientation).toBe(4)
    const offsets = c.groups[0]!.fits.offsets
    expect(offsets.valid).toBe(true)
    offsets.params.offsets.forEach((v, i) => expect(v).toBeCloseTo(truth.trueOffsets[i]!, 0))
    expect(offsets.params.orientation).toBe(4)
    expect(c.groups[0]!.defaultKind).toBe('offsets')
  })

  it('reproduces the logged field when re-applying the existing calibration', () => {
    // Compasses 1 and 2 of the synthetic log have no logged motor compensation.
    for (const c of [data.compasses[0]!, data.compasses[1]!]) {
      const field = c.rotated ? rotateField(c.raw, c.params.orientation) : c.raw
      const reapplied = applyParams(field, c.params)
      const diff = vec3Distance(reapplied, c.logged)
      expect(Math.max(...diff)).toBeLessThan(1e-9)
    }
    // Round trip on a hand-made sample: apply then remove gives the raw value back.
    const params = {
      offsets: [10, -5, 3] as const,
      scale: 1.1,
      diagonals: [1.02, 0.98, 1] as const,
      offDiagonals: [0.01, 0.02, -0.01] as const
    }
    const raw = { x: Float64Array.of(100, -50), y: Float64Array.of(20, 300), z: Float64Array.of(-400, 10) }
    const logged = applyParams(raw, { ...params, motor: [0, 0, 0] })
    const ofs = { x: Float64Array.of(10, 10), y: Float64Array.of(-5, -5), z: Float64Array.of(3, 3) }
    const back = removeCalibration(logged, { offsets: ofs, motor: vec3Series(2) }, { ...params, external: 0, orientation: 0 })
    expect(back.rotated).toBe(false)
    for (const a of ['x', 'y', 'z'] as const) back.raw[a].forEach((v, i) => expect(v).toBeCloseTo(raw[a][i]!, 9))
  })

  it('validates parameter and scale ranges like upstream', () => {
    const p: CalParams = {
      offsets: [0, 0, 0],
      diagonals: [1, 1, 1],
      offDiagonals: [0, 0, 0],
      scale: 1,
      motor: [0, 0, 0],
      orientation: 0,
      fitType: 0
    }
    expect(paramsValid(p)).toBe(true)
    expect(paramsValid({ ...p, offsets: [1500, 0, 0] })).toBe(false)
    expect(paramsValid({ ...p, scale: 1.2 })).toBe(false)
    expect(paramsValid({ ...p, offDiagonals: [0, NaN, 0] })).toBe(false)
    expect(scaleValid(1.5)).toBe(true)
    expect(scaleValid(0.6)).toBe(false)
    expect(scaleValid(NaN)).toBe(false)
  })

  it('weights the RMS error over the window only', () => {
    expect(weightedRms([100, 3, 4, 100], [1, 1], { start: 1, end: 3 })).toBeCloseTo(Math.sqrt(12.5), 12)
  })

  it('picks the first valid fit as default only without motor compensation', () => {
    const fits = result.compasses[1]!.groups[0]!.fits
    const invalidOffsets: FitSet = { ...fits, offsets: { valid: false, params: fits.offsets.params } }
    expect(defaultFitKind(fits, 0)).toBe('offsets')
    expect(defaultFitKind(invalidOffsets, 0)).toBe('scale')
    expect(defaultFitKind(fits, 2)).toBeUndefined()
  })

  it('fits directly from inputs', () => {
    const c = result.compasses[2]!
    const set = fitCompass({
      field: c.field,
      expected: c.prepared.expected,
      weights: new Float64Array(c.range.end - c.range.start).fill(1),
      range: c.range,
      orientation: c.orientation,
      attitude: c.prepared.attitude,
      declination: data.earthField.declination
    })
    expect(set.scale.valid).toBe(true)
    expect(set.scale.params.scale).toBeCloseTo(SYNTHETIC_COMPASSES[2]!.trueScale, 2)
  })
})
