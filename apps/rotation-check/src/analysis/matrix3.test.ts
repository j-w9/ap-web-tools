import { describe, expect, it } from 'vitest'
import {
  matrixDistance,
  matrixFromEuler,
  matrixFromEuler312,
  matrixFromRotation,
  matrixFromRotationValue,
  matrixToEuler,
  matrixToEuler312,
  mulVector,
  rotateVector,
  safeAsin,
  type Matrix3
} from './matrix3.js'
import { CUSTOM_ROTATIONS, STANDARD_ROTATIONS } from './rotations.js'
import { loadUpstream, type UpstreamMatrix3 } from './test-utils/upstream.js'

const up = loadUpstream()

function plain(m: UpstreamMatrix3): Matrix3 {
  return { a: { ...m.a }, b: { ...m.b }, c: { ...m.c } }
}

/** Deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const next = rng(1234)
const angles = Array.from({ length: 200 }, () => ({
  roll: (next() - 0.5) * 4 * Math.PI,
  pitch: (next() - 0.5) * 4 * Math.PI,
  yaw: (next() - 0.5) * 4 * Math.PI
}))

describe('matrixFromRotation', () => {
  it.each(STANDARD_ROTATIONS.map((r) => [r.value, r.id] as const))('matches upstream from_rotation for %i %s', (value, id) => {
    const m = up.newMatrix3()
    expect(m.from_rotation(value)).toBe(true)
    expect(matrixFromRotation(id)).toEqual(plain(m))
    expect(matrixFromRotationValue(value)).toEqual(plain(m))
  })

  it('upstream rejects the values the types rule out', () => {
    for (const value of [...CUSTOM_ROTATIONS.map((r) => r.value), 44, 100, 103]) {
      expect(up.newMatrix3().from_rotation(value)).toBe(false)
    }
  })

  it('rotates arbitrary vectors like the upstream matrix', () => {
    for (const r of STANDARD_ROTATIONS) {
      const m = up.newMatrix3()
      m.from_rotation(r.value)
      for (let i = 0; i < 5; i++) {
        const v = { x: next() * 2 - 1, y: next() * 2 - 1, z: next() * 2 - 1 }
        const ours = rotateVector(r.id, v)
        const theirs = m.rotate([v.x, v.y, v.z])
        expect(ours.x).toBeCloseTo(theirs[0], 14)
        expect(ours.y).toBeCloseTo(theirs[1], 14)
        expect(ours.z).toBeCloseTo(theirs[2], 14)
      }
    }
  })

  it('produces proper rotation matrices (orthonormal, determinant 1)', () => {
    for (const r of STANDARD_ROTATIONS) {
      const m = matrixFromRotation(r.id)
      const det =
        m.a.x * (m.b.y * m.c.z - m.b.z * m.c.y) -
        m.a.y * (m.b.x * m.c.z - m.b.z * m.c.x) +
        m.a.z * (m.b.x * m.c.y - m.b.y * m.c.x)
      expect(det).toBeCloseTo(1, 12)
    }
  })
})

describe('Euler conversions', () => {
  it('matrixFromEuler matches upstream from_euler bit for bit', () => {
    for (const e of angles) {
      const m = up.newMatrix3()
      m.from_euler(e.roll, e.pitch, e.yaw)
      expect(matrixFromEuler(e)).toEqual(plain(m))
    }
  })

  it('matrixToEuler matches upstream to_euler', () => {
    for (const e of angles) {
      const m = up.newMatrix3()
      m.from_euler(e.roll, e.pitch, e.yaw)
      const t = m.to_euler()
      expect(matrixToEuler(plain(m))).toEqual({ roll: t.x, pitch: t.y, yaw: t.z })
    }
  })

  it('matrixFromEuler312 and matrixToEuler312 match upstream', () => {
    for (const e of angles) {
      const m = up.newMatrix3()
      m.from_euler312(e.roll, e.pitch, e.yaw)
      expect(matrixFromEuler312(e)).toEqual(plain(m))
      const t = m.to_euler312()
      expect(matrixToEuler312(plain(m))).toEqual({ roll: t.x, pitch: t.y, yaw: t.z })
    }
  })

  it('mulVector matches upstream rotate', () => {
    for (const e of angles.slice(0, 20)) {
      const m = up.newMatrix3()
      m.from_euler(e.roll, e.pitch, e.yaw)
      const v = { x: next(), y: next(), z: next() }
      const [x, y, z] = m.rotate([v.x, v.y, v.z])
      expect(mulVector(plain(m), v)).toEqual({ x, y, z })
    }
  })

  it('safeAsin clamps outside [-1, 1]', () => {
    expect(safeAsin(1.5)).toBe(Math.PI / 2)
    expect(safeAsin(-2)).toBe(-Math.PI / 2)
    expect(safeAsin(0.5)).toBe(Math.asin(0.5))
  })

  it('matrixDistance is zero only for equal matrices', () => {
    const m = matrixFromRotation('YAW_90')
    expect(matrixDistance(m, m)).toBe(0)
    expect(matrixDistance(m, matrixFromRotation('NONE'))).toBeCloseTo(4, 12)
  })
})
