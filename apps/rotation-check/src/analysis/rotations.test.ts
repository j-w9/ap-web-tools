import { describe, expect, it } from 'vitest'
import { matrixDistance, matrixFromEuler, matrixFromRotation } from './matrix3.js'
import { eulerDegToRad } from './resolve.js'
import {
  ALL_ROTATIONS,
  CUSTOM_ROTATIONS,
  STANDARD_ROTATIONS,
  isCustomRotation,
  matchesRotationSearch,
  rotationInfo,
  rotationLabel
} from './rotations.js'
import { loadUpstream } from './test-utils/upstream.js'

const up = loadUpstream()

describe('rotation table', () => {
  it('lists the same values and labels as upstream, in the same order', () => {
    expect(ALL_ROTATIONS.map((r) => [String(r.value), r.name])).toEqual(Object.entries(up.rotations))
  })

  it.each(STANDARD_ROTATIONS.map((r) => [r.value, r.name, r] as const))(
    '%i %s has the Euler angles upstream derives',
    (value, _n, r) => {
      const e = up.euler[value]
      expect(e).toBeDefined()
      expect([r.eulerDeg.roll, r.eulerDeg.pitch, r.eulerDeg.yaw]).toEqual(e)
    }
  )

  it.each(STANDARD_ROTATIONS.map((r) => [r.value, r.id, r] as const))(
    '%i %s: Euler angles reproduce the enum matrix within upstream tolerance',
    (_v, id, r) => {
      const diff = matrixDistance(matrixFromRotation(id), matrixFromEuler(eulerDegToRad(r.eulerDeg)))
      expect(diff).toBeLessThanOrEqual(Number.EPSILON * 9)
    }
  )

  it('values are unique', () => {
    expect(new Set(ALL_ROTATIONS.map((r) => r.value)).size).toBe(ALL_ROTATIONS.length)
  })

  it('looks up and classifies values', () => {
    expect(rotationInfo(2)?.name).toBe('Yaw90')
    expect(rotationInfo(44)).toBeNull()
    expect(CUSTOM_ROTATIONS.every(isCustomRotation)).toBe(true)
    expect(STANDARD_ROTATIONS.some(isCustomRotation)).toBe(false)
    expect(rotationLabel(STANDARD_ROTATIONS[2])).toBe('2:Yaw90')
  })

  it('searches by value, label and enum name', () => {
    const find = (q: string) => ALL_ROTATIONS.filter((r) => matchesRotationSearch(r, q)).map((r) => r.value)
    expect(find('')).toHaveLength(ALL_ROTATIONS.length)
    expect(find('yaw90roll90')).toEqual([18])
    expect(find('ROTATION_ROLL_90_YAW_90')).toEqual([18])
    expect(find('pitch315')).toEqual([39, 40])
    expect(find('custom')).toEqual([101, 102])
    expect(find('roll270 yaw')).toEqual([21, 22, 23])
  })
})
