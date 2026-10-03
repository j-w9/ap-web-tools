/**
 * Missions, polygon fences and rally points recovered from CMD, FNCE and RALY records, with
 * QGC WPL 110 export (upstream `load_waypoints()`).
 */
import type { DataflashLog } from '@apwt/dataflash'

/** One mission item in MAVLink terms. */
export interface MissionItem {
  /** Total items in the set it was logged with. */
  readonly commandTotal: number
  /** Sequence number (index). */
  readonly sequence: number
  /** MAV_CMD. */
  readonly command: number
  /** Param 1. */
  readonly param1: number
  /** Param 2. */
  readonly param2: number
  /** Param 3. */
  readonly param3: number
  /** Param 4. */
  readonly param4: number
  /** Latitude, degrees * 1e7. */
  readonly latitude: number
  /** Longitude, degrees * 1e7. */
  readonly longitude: number
  /** Altitude, metres. */
  readonly altitude: number
  /** MAV_FRAME. */
  readonly frame: number
}

/** One distinct set of items (a mission, fence or rally upload). */
export interface MissionSet {
  /** Item count the set claims to have. */
  readonly commandTotal: number
  /** Items by sequence number; `undefined` where not logged. */
  readonly items: readonly (MissionItem | undefined)[]
}

/** Every mission, fence and rally set in the log. */
export interface MissionData {
  /** Missions (`waypoints_<i>.txt`). */
  readonly missions: readonly MissionSet[]
  /** Polygon/circle fences (`fence_<i>.txt`). */
  readonly fences: readonly MissionSet[]
  /** Rally point sets (`rally_<i>.txt`). */
  readonly rally: readonly MissionSet[]
}

const ITEM_KEYS = [
  'commandTotal',
  'sequence',
  'command',
  'param1',
  'param2',
  'param3',
  'param4',
  'latitude',
  'longitude',
  'altitude',
  'frame'
] as const

/** Item equality; an absent item matches anything, as upstream `item_compare`. */
function itemMatches(a: MissionItem | undefined, b: MissionItem | undefined): boolean {
  if (a === undefined || b === undefined) return true
  return ITEM_KEYS.every((k) => a[k] === b[k])
}

/** Group items into sets: a new set starts when the total changes or a slot is overwritten differently. */
function groupItems(items: Iterable<MissionItem>): MissionSet[] {
  const sets: { commandTotal: number; items: (MissionItem | undefined)[] }[] = []
  for (const item of items) {
    let current = sets[sets.length - 1]
    if (
      current !== undefined &&
      (item.commandTotal !== current.commandTotal || !itemMatches(item, current.items[item.sequence]))
    ) {
      current = undefined
    }
    if (current === undefined) {
      current = { commandTotal: item.commandTotal, items: [] }
      sets.push(current)
    }
    while (current.items.length < item.sequence) current.items.push(undefined)
    current.items[item.sequence] = item
  }
  return sets
}

type Columns = Record<string, ArrayLike<number> | undefined>

function columns(log: DataflashLog, message: string, fields: readonly string[]): Columns | undefined {
  if (!log.has(message)) return undefined
  const out: Columns = {}
  for (const f of fields) out[f] = log.getNumbers(message, f)
  return out
}

const num = (c: Columns, field: string, i: number): number => c[field]?.[i] ?? NaN

function* cmdItems(c: Columns, n: number): Generator<MissionItem> {
  for (let i = 0; i < n; i++) {
    yield {
      commandTotal: num(c, 'CTot', i),
      sequence: num(c, 'CNum', i),
      command: num(c, 'CId', i),
      param1: num(c, 'Prm1', i),
      param2: num(c, 'Prm2', i),
      param3: num(c, 'Prm3', i),
      param4: num(c, 'Prm4', i),
      latitude: num(c, 'Lat', i),
      longitude: num(c, 'Lng', i),
      altitude: num(c, 'Alt', i),
      frame: num(c, 'Frame', i)
    }
  }
}

function* fenceItems(c: Columns, n: number): Generator<MissionItem> {
  for (let i = 0; i < n; i++) {
    let command: number
    let p1: number
    switch (num(c, 'Type', i)) {
      case 98: // inclusion polygon vertex
        command = 5001
        p1 = num(c, 'Count', i)
        break
      case 97: // exclusion polygon vertex
        command = 5002
        p1 = num(c, 'Count', i)
        break
      case 95: // return point
        command = 5000
        p1 = 0
        break
      case 93: // exclusion circle
        command = 5004
        p1 = num(c, 'Radius', i)
        break
      case 92: // inclusion circle
        command = 5003
        p1 = num(c, 'Radius', i)
        break
      default:
        continue
    }
    yield {
      commandTotal: num(c, 'Tot', i),
      sequence: num(c, 'Seq', i) + 1, // offset by 1 since home is not included
      command,
      param1: p1,
      param2: 0,
      param3: 0,
      param4: 0,
      latitude: num(c, 'Lat', i),
      longitude: num(c, 'Lng', i),
      altitude: 0,
      frame: 0
    }
  }
}

function* rallyItems(c: Columns, n: number): Generator<MissionItem> {
  for (let i = 0; i < n; i++) {
    let frame = 3 // MAV_FRAME_GLOBAL_RELATIVE_ALT
    const flagsCol = c['Flags']
    if (flagsCol !== undefined) {
      const flags = flagsCol[i] as number
      if ((flags & 0b0000100) !== 0) {
        const apFrame = (flags & 0b00011000) >> 3
        if (apFrame === 0)
          frame = 0 // ABSOLUTE -> MAV_FRAME_GLOBAL
        else if (apFrame === 1)
          frame = 3 // ABOVE_HOME -> MAV_FRAME_GLOBAL_RELATIVE_ALT
        else if (apFrame === 2)
          continue // ABOVE_ORIGIN: invalid
        else frame = 10 // ABOVE_TERRAIN -> MAV_FRAME_GLOBAL_TERRAIN_ALT
      }
    }
    yield {
      commandTotal: num(c, 'Tot', i),
      sequence: num(c, 'Seq', i) + 1,
      command: 5100, // MAV_CMD_NAV_RALLY_POINT
      param1: 0,
      param2: 0,
      param3: 0,
      param4: 0,
      latitude: num(c, 'Lat', i),
      longitude: num(c, 'Lng', i),
      altitude: num(c, 'Alt', i),
      frame
    }
  }
}

/** Recover every mission, fence and rally set written to the log. */
export function readMissions(log: DataflashLog): MissionData {
  const cmd = columns(log, 'CMD', ['CTot', 'CNum', 'CId', 'Prm1', 'Prm2', 'Prm3', 'Prm4', 'Lat', 'Lng', 'Alt', 'Frame'])
  const fnce = columns(log, 'FNCE', ['Tot', 'Seq', 'Type', 'Count', 'Radius', 'Lat', 'Lng'])
  const raly = columns(log, 'RALY', ['Tot', 'Seq', 'Flags', 'Lat', 'Lng', 'Alt'])
  return {
    missions: cmd ? groupItems(cmdItems(cmd, cmd['CTot']?.length ?? 0)) : [],
    fences: fnce ? groupItems(fenceItems(fnce, fnce['Tot']?.length ?? 0)) : [],
    rally: raly ? groupItems(rallyItems(raly, raly['Tot']?.length ?? 0)) : []
  }
}

/** QGC WPL text for a set and whether all items were present. */
export interface WaypointFile {
  /** File contents. */
  readonly text: string
  /** False when fewer items were logged than the set's total (upstream alerts "Mission incomplete"). */
  readonly complete: boolean
}

/** Write a set as a QGC WPL 110 file. */
export function waypointFileText(set: MissionSet): WaypointFile {
  let text = 'QGC WPL 110\n'
  let count = 0
  for (const item of set.items) {
    if (item === undefined) continue
    count++
    text +=
      [
        item.sequence,
        0,
        item.frame,
        item.command,
        item.param1.toFixed(8),
        item.param2.toFixed(8),
        item.param3.toFixed(8),
        item.param4.toFixed(8),
        (item.latitude / 10 ** 7).toFixed(8),
        (item.longitude / 10 ** 7).toFixed(8),
        item.altitude.toFixed(6),
        1
      ].join('\t') + '\n'
  }
  return { text, complete: set.commandTotal === count }
}
