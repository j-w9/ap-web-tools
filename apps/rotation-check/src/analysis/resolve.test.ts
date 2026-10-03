import { describe, expect, it } from 'vitest'
import { matrixFromRotation } from './matrix3.js'
import { ROTATED_AXIS_LENGTH, eulerDegToRad, parseEulerDeg, resolveRotation, rotatedAxis } from './resolve.js'
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

describe('parseEulerDeg', () => {
  it('reads boxes with parseFloat, as upstream update() does', () => {
    expect(parseEulerDeg({ roll: '90', pitch: '-12.5', yaw: '1e1' })).toEqual({ roll: 90, pitch: -12.5, yaw: 10 })
    // An empty number input (also what a browser reports for unparseable text) is NaN.
    expect(parseEulerDeg({ roll: '', pitch: '5', yaw: '3' })).toEqual({ roll: Number.NaN, pitch: 5, yaw: 3 })
  })

  it('carries an empty box into NaN plot vectors exactly like upstream', () => {
    const text = { roll: '', pitch: '20', yaw: '30' }
    const eulerDeg = parseEulerDeg(text)
    const port = resolveRotation({ kind: 'custom', value: 102, eulerDeg }).matrix
    const m = up.newMatrix3()
    const d = Math.PI / 180.0
    m.from_euler(Number.parseFloat(text.roll) * d, Number.parseFloat(text.pitch) * d, Number.parseFloat(text.yaw) * d)
    expect(port).toEqual({ a: { ...m.a }, b: { ...m.b }, c: { ...m.c } })
    const len = ROTATED_AXIS_LENGTH
    expect(rotatedAxis(port, 'x', len)).toEqual(toVec(m.rotate([len, 0, 0])))
    expect(rotatedAxis(port, 'y', len)).toEqual(toVec(m.rotate([0, len, 0])))
    expect(rotatedAxis(port, 'z', len)).toEqual(toVec(m.rotate([0, 0, len])))
  })

  it('matches upstream custom-rotation plot vectors for typed angles', () => {
    for (const text of [
      { roll: '10', pitch: '20', yaw: '30' },
      { roll: '-45.5', pitch: '89.9', yaw: '360' },
      { roll: '0', pitch: '90', yaw: '0' }
    ]) {
      const port = resolveRotation({ kind: 'custom', value: 101, eulerDeg: parseEulerDeg(text) }).matrix
      const m = up.newMatrix3()
      const r = eulerDegToRad(parseEulerDeg(text))
      m.from_euler(r.roll, r.pitch, r.yaw)
      const len = ROTATED_AXIS_LENGTH
      expect(rotatedAxis(port, 'x', len)).toEqual(toVec(m.rotate([len, 0, 0])))
      expect(rotatedAxis(port, 'z', len)).toEqual(toVec(m.rotate([0, 0, len])))
    }
  })
})
