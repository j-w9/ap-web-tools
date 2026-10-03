/**
 * Mission, fence and rally files read over MAVFTP from `@MISSION/*.dat` (upstream
 * `modules/MAVLink/mavftp.js`, class `MissionParser`): a 10-byte header followed by 38-byte
 * MISSION_ITEM_INT records.
 */
import { MavCmd } from '@apwt/mavlink'

/** One stored mission item, as upstream builds a `mission_item_int` message from it. */
export interface MissionItem {
  readonly targetSystem: number
  readonly targetComponent: number
  readonly seq: number
  readonly frame: number
  readonly command: number
  readonly current: number
  readonly autocontinue: number
  readonly param1: number
  readonly param2: number
  readonly param3: number
  readonly param4: number
  /** Latitude in 1e-7 degrees for location commands. */
  readonly x: number
  /** Longitude in 1e-7 degrees for location commands. */
  readonly y: number
  readonly z: number
  readonly missionType: number
}

export interface LatLng {
  readonly lat: number
  readonly lng: number
}

export type CircleFenceType = typeof MavCmd.MAV_CMD_NAV_FENCE_CIRCLE_INCLUSION | typeof MavCmd.MAV_CMD_NAV_FENCE_CIRCLE_EXCLUSION
export type PolygonFenceType =
  typeof MavCmd.MAV_CMD_NAV_FENCE_POLYGON_VERTEX_INCLUSION | typeof MavCmd.MAV_CMD_NAV_FENCE_POLYGON_VERTEX_EXCLUSION

/** One fence: a circle, or a polygon built from consecutive vertex items. */
export type FenceItem =
  | {
      readonly kind: 'circle'
      readonly type: CircleFenceType
      readonly radius: number
      readonly lat: number
      readonly lng: number
    }
  | {
      readonly kind: 'polygon'
      readonly type: PolygonFenceType
      readonly vertexCount: number
      readonly vertices: readonly LatLng[]
    }

const MAGIC = 0x763d
const RECORD = 38

/** Items of a mission file, or null for a malformed header or length. */
export function parseMissionItems(data: Uint8Array): MissionItem[] | null {
  if (data.length < 10) return null
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const magic = view.getUint16(0, true)
  const type = view.getUint16(2, true)
  const options = view.getUint16(4, true)
  const start = view.getUint16(6, true)
  const count = view.getUint16(8, true)
  if (magic !== MAGIC || type > 2 || options !== 0 || start !== 0 || data.length !== 10 + count * RECORD) return null
  const items: MissionItem[] = []
  for (let i = 0; i < count; i++) {
    const o = 10 + i * RECORD
    items.push({
      param1: view.getFloat32(o, true),
      param2: view.getFloat32(o + 4, true),
      param3: view.getFloat32(o + 8, true),
      param4: view.getFloat32(o + 12, true),
      x: view.getInt32(o + 16, true),
      y: view.getInt32(o + 20, true),
      z: view.getFloat32(o + 24, true),
      seq: view.getUint16(o + 28, true),
      command: view.getUint16(o + 30, true),
      targetSystem: view.getUint8(o + 32),
      targetComponent: view.getUint8(o + 33),
      frame: view.getUint8(o + 34),
      current: view.getUint8(o + 35),
      autocontinue: view.getUint8(o + 36),
      missionType: view.getUint8(o + 37)
    })
  }
  return items
}

const isCircle = (command: number): command is CircleFenceType =>
  command === MavCmd.MAV_CMD_NAV_FENCE_CIRCLE_INCLUSION || command === MavCmd.MAV_CMD_NAV_FENCE_CIRCLE_EXCLUSION
const isPolygon = (command: number): command is PolygonFenceType =>
  command === MavCmd.MAV_CMD_NAV_FENCE_POLYGON_VERTEX_EXCLUSION || command === MavCmd.MAV_CMD_NAV_FENCE_POLYGON_VERTEX_INCLUSION
const validPoint = (p: LatLng): boolean =>
  Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180

/** Fences of a fence file; null if the file or any fence is malformed. Other commands are skipped. */
export function parseFence(data: Uint8Array): FenceItem[] | null {
  const items = parseMissionItems(data)
  if (items === null) return null
  const fences: FenceItem[] = []
  let idx = 0
  while (idx < items.length) {
    const item = items[idx]!
    const command = item.command
    let fence: FenceItem
    if (isCircle(command)) {
      fence = { kind: 'circle', type: command, radius: item.param1, lat: item.x / 1.0e7, lng: item.y / 1.0e7 }
      idx++
    } else if (isPolygon(command)) {
      const count = item.param1
      if (!Number.isInteger(count) || count < 3 || idx + count > items.length) return null
      const vertices: LatLng[] = []
      for (let i = 0; i < count; i++) {
        const vertex = items[idx + i]!
        if (vertex.command !== command || vertex.param1 !== count) return null
        vertices.push({ lat: vertex.x / 1.0e7, lng: vertex.y / 1.0e7 })
      }
      fence = { kind: 'polygon', type: command, vertexCount: count, vertices }
      idx += count
    } else {
      idx++
      continue
    }
    const points = fence.kind === 'polygon' ? fence.vertices : [fence]
    if (points.some((p) => !validPoint(p))) return null
    if (fence.kind === 'circle' && (!Number.isFinite(fence.radius) || fence.radius <= 0)) return null
    fences.push(fence)
  }
  return fences
}

/** Whether a fence keeps the vehicle inside (green) rather than out (red). */
export function isInclusion(type: CircleFenceType | PolygonFenceType): boolean {
  return type === MavCmd.MAV_CMD_NAV_FENCE_CIRCLE_INCLUSION || type === MavCmd.MAV_CMD_NAV_FENCE_POLYGON_VERTEX_INCLUSION
}

// Match AP_Mission::stored_in_location (upstream `SimpleGCS/mission.js`). Other commands (for
// example NAV_SCRIPT_TIME) store arguments in x/y, not geographic coordinates. Upstream adds
// NAV_ARC_WAYPOINT (36) by number because its bundled dialect lacks the constant.
const LOCATION_COMMANDS: ReadonlySet<number> = new Set([
  MavCmd.MAV_CMD_NAV_WAYPOINT,
  MavCmd.MAV_CMD_NAV_LOITER_UNLIM,
  MavCmd.MAV_CMD_NAV_LOITER_TURNS,
  MavCmd.MAV_CMD_NAV_LOITER_TIME,
  MavCmd.MAV_CMD_NAV_LAND,
  MavCmd.MAV_CMD_NAV_TAKEOFF,
  MavCmd.MAV_CMD_NAV_CONTINUE_AND_CHANGE_ALT,
  MavCmd.MAV_CMD_NAV_LOITER_TO_ALT,
  MavCmd.MAV_CMD_NAV_SPLINE_WAYPOINT,
  MavCmd.MAV_CMD_NAV_GUIDED_ENABLE,
  MavCmd.MAV_CMD_DO_SET_HOME,
  MavCmd.MAV_CMD_DO_RETURN_PATH_START,
  MavCmd.MAV_CMD_DO_LAND_START,
  MavCmd.MAV_CMD_DO_GO_AROUND,
  MavCmd.MAV_CMD_DO_SET_ROI_LOCATION,
  MavCmd.MAV_CMD_DO_SET_ROI,
  MavCmd.MAV_CMD_NAV_VTOL_TAKEOFF,
  MavCmd.MAV_CMD_NAV_VTOL_LAND,
  MavCmd.MAV_CMD_NAV_PAYLOAD_PLACE,
  36
])
const GLOBAL_FRAMES: ReadonlySet<number> = new Set([0, 3, 5, 6, 10, 11])

/** A mission point to draw, labelled with its stored sequence number. */
export interface MissionPoint extends LatLng {
  readonly seq: number
}

/** Location items in global frames with plausible, non-zero coordinates, in file order. */
export function missionPoints(items: readonly Pick<MissionItem, 'command' | 'frame' | 'seq' | 'x' | 'y'>[]): MissionPoint[] {
  return items
    .filter((item) => LOCATION_COMMANDS.has(item.command) && GLOBAL_FRAMES.has(item.frame))
    .map((item) => ({ seq: item.seq, lat: item.x * 1e-7, lng: item.y * 1e-7 }))
    .filter((p) => validPoint(p) && (p.lat !== 0 || p.lng !== 0))
}
