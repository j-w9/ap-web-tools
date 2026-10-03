import { beforeAll, describe, expect, it } from 'vitest'
import { expectSameArray } from '../test-utils/compare.js'
import { rng } from '../test-utils/synthetic-mag-log.js'
import { createUpstreamMagfit, type UpstreamMagfit } from '../test-utils/upstream.js'
import { quatFromEuler, quatInverse, quatPitch, quatRoll, quatRotate, quatYaw, slerp, type Quat } from './quaternion.js'
import { Rotation, isRightAngleRotation, rotationName, rotationQuat } from './rotations.js'
import { arrayWrapPi, wrap2Pi, wrapPi } from './angles.js'

const quatArray = (q: Quat): number[] => [q.q1, q.q2, q.q3, q.q4]

describe('rotations and quaternions', () => {
  let up: UpstreamMagfit
  beforeAll(async () => {
    up = await createUpstreamMagfit()
  })

  it('matches upstream from_rotation, right_angle_rotation and get_rotation_name', () => {
    for (let rot = -1; rot <= 103; rot++) {
      const theirs = up.evaluate<{ ok: boolean; q: number[]; right: boolean; name: string | undefined }>(
        `(() => { const q = new Quaternion(); const ok = q.from_rotation(${rot}); return { ok, q: [q.q1, q.q2, q.q3, q.q4], right: right_angle_rotation(${rot}), name: get_rotation_name(${rot}) } })()`
      )
      const mine = rotationQuat(rot)
      expect(mine !== undefined, `rotation ${rot} supported`).toBe(theirs.ok)
      if (mine !== undefined) expectSameArray(quatArray(mine), theirs.q, `rotation ${rot}`)
      expect(isRightAngleRotation(rot), `right angle ${rot}`).toBe(theirs.right)
      expect(rotationName(rot), `name ${rot}`).toBe(theirs.name)
    }
    expect(Rotation.yaw180).toBe(4)
    expect(rotationQuat(Rotation.pitch180Yaw90)).toBeUndefined()
  })

  it('matches upstream rotate, from_euler, euler getters and slerp', () => {
    const next = rng(3)
    const r = (): number => (next() - 0.5) * 7
    for (let i = 0; i < 200; i++) {
      const [roll, pitch, yaw, x, y, z, t] = [r(), r() / 2.5, r(), r() * 100, r() * 100, r() * 100, next()]
      const theirs = up.evaluate<{ q: number[]; v: number[]; e: number[]; s: number[]; inv: number[] }>(`(() => {
        const q = new Quaternion(); q.from_euler(${roll}, ${pitch}, ${yaw})
        const c = new Quaternion(); c.from_euler(${pitch}, ${yaw}, ${roll})
        const v = q.rotate([${x}, ${y}, ${z}])
        const e = [q.get_euler_roll(), q.get_euler_pitch(), q.get_euler_yaw()]
        const s = slerp(q, c, ${t})
        q.invert()
        return { q: [c.q1, c.q2, c.q3, c.q4], v, e, s: [s.q1, s.q2, s.q3, s.q4], inv: q.rotate([${x}, ${y}, ${z}]) }
      })()`)
      const q = quatFromEuler(roll, pitch, yaw)
      const c = quatFromEuler(pitch, yaw, roll)
      expectSameArray(quatArray(c), theirs.q, 'from_euler')
      expectSameArray(quatRotate(q, [x, y, z]), theirs.v, 'rotate')
      expectSameArray([quatRoll(q), quatPitch(q), quatYaw(q)], theirs.e, 'euler')
      expectSameArray(quatArray(slerp(q, c, t)), theirs.s, 'slerp')
      expectSameArray(quatRotate(quatInverse(q), [x, y, z]), theirs.inv, 'inverse rotate')
    }
    // Identical quaternions short-circuit
    const q = quatFromEuler(0.1, 0.2, 0.3)
    expect(slerp(q, q, 0.5)).toEqual(q)
  })

  it('matches upstream angle wrapping', () => {
    const values = [-6, -3.5, -Math.PI, -1, 0, 1, Math.PI, 3.5, 6, 9, 20]
    const theirs = up.evaluate<{ a: number[]; b: number[] }>(
      `({ a: ${JSON.stringify(values)}.map(wrap_2PI), b: array_wrap_PI(${JSON.stringify(values)}) })`
    )
    expectSameArray(values.map(wrap2Pi), theirs.a, 'wrap_2PI')
    expectSameArray(arrayWrapPi(values), theirs.b, 'wrap_PI')
    expect(wrapPi(Math.PI)).toBe(Math.PI)
  })
})
