import { fromCartesian, toCartesian } from './cartesian.js'
import { isClosed, type LatLon, type PolygonRings, type Position } from './geo.js'
import { simplifyRings } from './simplify.js'

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

/** Upstream rotates every ring left by this many places on each download (see `generateFence`). */
export const RING_ROTATION = 228

/**
 * Turn a polygon (outer ring, then holes) into a simplified fence, as upstream `generate_fence`
 * does before writing the file: convert to metres about the first outer vertex, simplify all
 * rings together, convert back.
 *
 * Like upstream, this edits `polygon` in place: each ring loses its closing duplicate (when the
 * first and last positions are equal) and is then rotated left by 228 places, a debugging
 * leftover upstream ships. The arrays are the feature's own, so every download starts from a
 * different vertex and repeated downloads give different files (docs/upstream-bugs.md). Use
 * `previewFence` to see the next download without changing anything.
 */
export function generateFence(polygon: PolygonRings): Fence {
  const outer = polygon[0]
  const first = outer?.[0]
  if (first === undefined) throw new Error('generateFence: the polygon has no outer ring')
  // Upstream keeps a reference to this position; its values never change, so a copy is the same.
  const origin: Position = [first[0], first[1]]
  const rings = polygon.map((points) => {
    if (isClosed(points)) points.pop()
    if (points.length > 0) points.push(...points.splice(0, RING_ROTATION % points.length))
    return toCartesian(points, origin)
  })
  const shapes = simplifyRings(rings)
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

/** The fence the next download of `polygon` would write, computed on a copy so nothing changes. */
export function previewFence(polygon: readonly (readonly Position[])[]): Fence {
  return generateFence(polygon.map((ring) => ring.map((p): Position => [p[0], p[1]])))
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
 * File name for a fence: every `/` and `\\` becomes `_`. Upstream's `String.replace` with a string
 * pattern replaces only the first of each, against its own "sanitize name for use in file" (a
 * proven bug, see docs/bug-proofs/geofence-generator.md).
 */
export function fenceFileName(name: string): string {
  return `${name.replaceAll('/', '_').replaceAll('\\', '_')}.waypoints`
}
