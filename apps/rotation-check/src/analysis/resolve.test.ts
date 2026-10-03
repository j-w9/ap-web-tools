import { describe, expect, it } from 'vitest'
import { matrixFromRotation } from './matrix3.js'
import {
  ROTATED_AXIS_LENGTH,
  findStandardRotations,
  parseEulerDeg,
  recoveredEulerDeg,
  resolveRotation,
  rotatedAxis
} from './resolve.js'
import { STANDARD_ROTATIONS } from './rotations.js'
import { loadUpstream } from './test-utils/upstream.js'

const up = loadUpstream()

describe('resolveRotation', () => {
  it('uses the enum matrix and angles for a standard rotation', () => {
    const r = resolveRotation({ kind: 'standard', value: 18 })
    expect(r.matrix).toEqual(matrixFromRotation('ROLL_90_YAW_90'))
    expect(r.eulerDeg).toEqual({ roll: 90, pitch: 0, yaw: 90 })
  })

  it('builds a custom rotation from degrees like upstream', () => {
    const eulerDeg = { roll: 12.5, pitch: -30, yaw: 200 }
    const m = up.newMatrix3()
    const d = Math.PI / 180.0
    m.from_euler(eulerDeg.roll * d, eulerDeg.pitch * d, eulerDeg.yaw * d)
    expect(resolveRotation({ kind: 'custom', value: 101, eulerDeg }).matrix).toEqual({
      a: { ...m.a },
      b: { ...m.b },
      c: { ...m.c }
    })
  })
})

describe('rotatedAxis', () => {
  it.each(STANDARD_ROTATIONS.map((r) => [r.value, r.id] as const))('matches upstream plot vectors for %i %s', (value, id) => {
    const m = up.newMatrix3()
    m.from_rotation(value)
    const mat = matrixFromRotation(id)
    const len = ROTATED_AXIS_LENGTH
    expect(rotatedAxis(mat, 'x', len)).toEqual(toVec(m.rotate([len, 0, 0])))
    expect(rotatedAxis(mat, 'y', len)).toEqual(toVec(m.rotate([0, len, 0])))
    expect(rotatedAxis(mat, 'z', len)).toEqual(toVec(m.rotate([0, 0, len])))
  })
})

function toVec([x, y, z]: [number, number, number]) {
  return { x, y, z }
}

describe('findStandardRotations', () => {
  it('finds every standard rotation from its own Euler angles', () => {
    for (const r of STANDARD_ROTATIONS) {
      const custom = resolveRotation({ kind: 'custom', value: 101, eulerDeg: r.eulerDeg })
      expect(findStandardRotations(custom.matrix).map((s) => s.value)).toContain(r.value)
    }
  })

  it('maps equivalent angle sets to the same enum value', () => {
    const m = resolveRotation({ kind: 'custom', value: 102, eulerDeg: { roll: 180, pitch: 180, yaw: 0 } }).matrix
    expect(findStandardRotations(m).map((s) => s.value)).toEqual([4])
  })

  it('finds nothing for an arbitrary orientation', () => {
    const m = resolveRotation({ kind: 'custom', value: 101, eulerDeg: { roll: 10, pitch: 20, yaw: 30 } }).matrix
    expect(findStandardRotations(m)).toEqual([])
  })

  it('recovers the angles of a custom rotation', () => {
    const e = recoveredEulerDeg(
      resolveRotation({ kind: 'custom', value: 101, eulerDeg: { roll: 10, pitch: 20, yaw: 30 } }).matrix
    )
    expect(e.roll).toBeCloseTo(10, 10)
    expect(e.pitch).toBeCloseTo(20, 10)
    expect(e.yaw).toBeCloseTo(30, 10)
  })
})

describe('parseEulerDeg', () => {
  it('parses numbers and reports the boxes that are not', () => {
    expect(parseEulerDeg({ roll: '90', pitch: ' -12.5 ', yaw: '1e1' })).toEqual({
      ok: true,
      eulerDeg: { roll: 90, pitch: -12.5, yaw: 10 }
    })
    expect(parseEulerDeg({ roll: '', pitch: 'abc', yaw: '3' })).toEqual({ ok: false, invalid: ['roll', 'pitch'] })
  })
})
