import { fromCartesian, toCartesian } from './cartesian.js'
import { openRing, type LatLon, type PolygonRings } from './geo.js'
import { simplifyRings, segmentsIntersect, type SegmentTest } from './simplify.js'

/** The outer boundary of a water body is an inclusion fence; its islands are exclusions. */
export type FenceRole = 'inclusion' | 'exclusion'

/** One fence item, as ArduPilot stores it. */
export type FenceItem =
  | { readonly kind: 'polygon'; readonly role: FenceRole; readonly vertices: readonly LatLon[] }
  | { readonly kind: 'circle'; readonly role: FenceRole; readonly center: LatLon; readonly radiusM: number }

/** A generated fence: one item per input ring, in ring order. */
export type Fence = readonly FenceItem[]

/** MAVLink `MAV_CMD_NAV_FENCE_*` command ids, by item kind and role. */
export const FENCE_COMMANDS = {
  polygon: { inclusion: 5001, exclusion: 5002 },
  circle: { inclusion: 5003, exclusion: 5004 }
} as const satisfies Record<FenceItem['kind'], Record<FenceRole, number>>

/**
 * Turn a polygon (outer ring, then holes) into a simplified fence, as upstream `generate_fence`
 * does before writing the file: convert to metres about the first outer vertex, simplify all
 * rings together, convert back.
 *
 * Deviations from upstream: the input is not mutated (upstream pops the closing point and rotates
 * each ring by 228 places in place, a debugging leftover that changes the start vertex on every
 * download), and the segment test really detects crossings (see `segmentsIntersect`).
 */
export function generateFence(polygon: PolygonRings, segmentTest: SegmentTest = segmentsIntersect): Fence {
  const origin = polygon[0]?.[0]
  if (origin === undefined) return []
  const rings = polygon.map((ring) => toCartesian(openRing(ring), origin))
  const shapes = simplifyRings(rings, segmentTest)
  return shapes.map((shape, i): FenceItem => {
    // The first ring is always the inclusion boundary, all others are exclusions.
    const role: FenceRole = i === 0 ? 'inclusion' : 'exclusion'
    switch (shape.kind) {
      case 'polygon':
        return { kind: 'polygon', role, vertices: fromCartesian(shape.x, shape.y, origin) }
      case 'circle': {
        const center = fromCartesian([shape.x], [shape.y], origin)[0] ?? { lat: origin[1], lon: origin[0] }
        return { kind: 'circle', role, center, radiusM: shape.radiusM }
      }
    }
  })
}

/** Number of lines (points) the fence takes in the file and in the autopilot's fence storage. */
export function fencePointCount(fence: Fence): number {
  let count = 0
  for (const item of fence) count += item.kind === 'polygon' ? item.vertices.length : 1
  return count
}

/**
 * The fence as a QGC WPL 110 waypoint file, which Mission Planner and MAVProxy load as a fence.
 * Each line is `seq current frame command p1 p2 p3 p4 lat lon alt autocontinue`; polygon vertices
 * carry the vertex count in `p1` and the vertex index in the altitude column, circles their radius.
 */
export function formatWaypoints(fence: Fence): string {
  let text = 'QGC WPL 110\n'
  let seq = 1
  for (const item of fence) {
    switch (item.kind) {
      case 'polygon': {
        const command = FENCE_COMMANDS.polygon[item.role]
        const count = item.vertices.length
        item.vertices.forEach((v, j) => {
          text += `${seq} 0 3 ${command} ${count} 0 0 0 ${v.lat.toFixed(6)} ${v.lon.toFixed(6)} ${j} 1\n`
          seq += 1
        })
        break
      }
      case 'circle': {
        const command = FENCE_COMMANDS.circle[item.role]
        text += `${seq} 0 3 ${command} ${item.radiusM} 0 0 0 ${item.center.lat.toFixed(6)} ${item.center.lon.toFixed(6)} 0 1\n`
        seq += 1
        break
      }
    }
  }
  return text
}

/**
 * File name for a fence. Upstream replaces only the first `/` and `\` (`String.replace` with a
 * string pattern); every occurrence is replaced here so the name is always a single path segment.
 */
export function fenceFileName(name: string): string {
  return `${name.replaceAll('/', '_').replaceAll('\\', '_')}.waypoints`
}
