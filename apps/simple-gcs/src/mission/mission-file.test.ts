// Port of the mission/fence cases of upstream tests/mavftp.test.cjs, plus oracle comparisons with
// upstream `MissionParser` and SimpleGCS's mission point filter.
import { describe, expect, it } from 'vitest'
import { upstreamMissionParser } from '../test-utils/upstream.js'
import { missionPoints, parseFence, parseMissionItems } from './mission-file.js'

interface Item {
  readonly command: number
  readonly param1?: number
  readonly x?: number
  readonly y?: number
  readonly frame?: number
}

function mission(items: readonly Item[], type = 1): Uint8Array {
  const bytes = new Uint8Array(10 + 38 * items.length)
  const v = new DataView(bytes.buffer)
  v.setUint16(0, 0x763d, true)
  v.setUint16(2, type, true)
  v.setUint16(8, items.length, true)
  items.forEach((item, i) => {
    const o = 10 + i * 38
    v.setFloat32(o, item.param1 ?? 0, true)
    v.setInt32(o + 16, item.x ?? -350000000, true)
    v.setInt32(o + 20, item.y ?? 1490000000, true)
    v.setUint16(o + 28, i, true)
    v.setUint16(o + 30, item.command, true)
    bytes[o + 32] = 42
    bytes[o + 33] = 1
    bytes[o + 34] = item.frame ?? 0
    bytes[o + 37] = type
  })
  return bytes
}

describe('MissionParser (upstream tests)', () => {
  it('mission and polygon/circle fence files preserve coordinates and command fields', () => {
    const bytes = mission([
      { command: 5001, param1: 3 },
      { command: 5001, param1: 3, x: -350000100 },
      { command: 5001, param1: 3, y: 1490000100 },
      { command: 5004, param1: 12.5 }
    ])
    const fences = parseFence(bytes)!
    expect(fences.length).toBe(2)
    expect(fences[0]!.kind === 'polygon' && fences[0]!.vertices.length).toBe(3)
    const circle = fences[1]!
    expect(circle.kind === 'circle' && circle.radius).toBe(12.5)
    expect(circle.kind === 'circle' && circle.lat).toBe(-35)
    const items = parseMissionItems(mission([{ command: 16 }], 0))!
    expect(items[0]!.targetSystem).toBe(42)
    expect(items[0]!.x).toBe(-350000000)
  })

  it('malformed mission headers and incomplete or zero-vertex polygons are rejected', () => {
    expect(parseMissionItems(new Uint8Array(0))).toBeNull()
    const bytes = mission([{ command: 5001, param1: 3 }])
    expect(parseFence(bytes)).toBeNull()
    expect(parseFence(mission([{ command: 5001, param1: 0 }]))).toBeNull()
    expect(parseFence(mission([{ command: 5003, param1: -1 }]))).toBeNull()
    expect(parseMissionItems(bytes.subarray(0, -1))).toBeNull()
    bytes[0] = 0
    expect(parseMissionItems(bytes)).toBeNull()
    expect(parseFence(mission([]))).toEqual([])
  })
})

describe('MissionParser (oracle against upstream mavftp.js)', () => {
  const upstream = upstreamMissionParser()
  const cases: readonly (readonly Item[])[] = [
    [],
    [{ command: 5003, param1: 25 }],
    [{ command: 5004, param1: 0 }],
    [{ command: 5003, param1: NaN }],
    [{ command: 5003, param1: 10, x: 910000000 }],
    [
      { command: 5002, param1: 3 },
      { command: 5002, param1: 3 },
      { command: 5002, param1: 3 },
      { command: 16 },
      { command: 5003, param1: 4 }
    ],
    [
      { command: 5001, param1: 3 },
      { command: 5002, param1: 3 },
      { command: 5001, param1: 3 }
    ],
    [
      { command: 5001, param1: 3.5 },
      { command: 5001, param1: 3.5 },
      { command: 5001, param1: 3.5 },
      { command: 5001, param1: 3.5 }
    ],
    [
      { command: 5001, param1: 3, y: 1810000000 },
      { command: 5001, param1: 3 },
      { command: 5001, param1: 3 }
    ],
    [{ command: 22 }, { command: 5003, param1: 1e-3 }]
  ]
  const normalise = (f: Record<string, unknown>): Record<string, unknown> =>
    f.vertices !== undefined
      ? { type: f.type, vertexCount: f.vertex_count, vertices: f.vertices }
      : { type: f.type, radius: f.radius, lat: f.lat, lng: f.lng }
  for (const [i, items] of cases.entries()) {
    it(`fence case ${i} matches`, () => {
      const bytes = mission(items, 1)
      const ours = parseFence(bytes)
      const theirs = upstream.parseFence(bytes)
      expect(ours?.map(({ kind: _kind, ...rest }) => rest) ?? null).toEqual(theirs?.map(normalise) ?? null)
    })
  }

  it('mission items match field by field', () => {
    const bytes = mission(
      [
        { command: 16, frame: 3, param1: 2.5 },
        { command: 42702, frame: 0 },
        { command: 36, frame: 6 }
      ],
      0
    )
    const ours = parseMissionItems(bytes)!
    const theirs = upstream.parseMission(bytes)!
    expect(ours.length).toBe(theirs.length)
    for (const [i, item] of ours.entries()) {
      const t = theirs[i]!
      expect([item.seq, item.command, item.frame, item.x, item.y, item.param1, item.missionType, item.targetSystem]).toEqual([
        t.seq,
        t.command,
        t.frame,
        t.x,
        t.y,
        t.param1,
        t.mission_type,
        t.target_system
      ])
    }
  })
})

describe('mission points', () => {
  it('skip script arguments and local coordinates, preserving actual sequence labels', () => {
    const points = missionPoints([
      { command: 42702, frame: 0, seq: 0, x: -350000000, y: 1490000000 },
      { command: 16, frame: 1, seq: 1, x: -350000000, y: 1490000000 },
      { command: 16, frame: 0, seq: 4, x: -350000000, y: 1490000000 }
    ])
    expect(points.map((p) => p.seq)).toEqual([4])
  })

  it('arc waypoint endpoints render even when the bundled dialect lacks their constant', () => {
    expect(missionPoints([{ command: 36, frame: 6, seq: 7, x: -350000000, y: 1490000000 }]).map((p) => p.seq)).toEqual([7])
  })

  it('zero and out-of-range coordinates are dropped', () => {
    expect(
      missionPoints([
        { command: 16, frame: 0, seq: 0, x: 0, y: 0 },
        { command: 16, frame: 0, seq: 1, x: 910000000, y: 0 },
        { command: 16, frame: 0, seq: 2, x: 0, y: 10 }
      ]).map((p) => p.seq)
    ).toEqual([2])
  })
})
