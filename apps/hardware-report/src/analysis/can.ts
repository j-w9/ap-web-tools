/**
 * DroneCAN node inventory from CAND records (upstream `load_can()`).
 */
import type { DataflashLog } from '@apwt/dataflash'

/** CAN driver key: the driver number, or `'all'` for logs without a `Driver` field. */
export type CanDriver = number | 'all'

/** One distinct DroneCAN node identity seen in the log. */
export interface CanNode {
  /** CAN driver the node is on. */
  readonly driver: CanDriver
  /** DroneCAN node id. */
  readonly nodeId: number
  /** Node name, e.g. `"org.ardupilot.f9p"`. */
  readonly name: string
  /** Firmware `"major.minor"`. */
  readonly version: string
  /** First 32 bits of the unique id. */
  readonly uid1: number
  /** Second 32 bits of the unique id. */
  readonly uid2: number
  /** Firmware git hash as 8 hex digits. */
  readonly hash: string
  /** Whether the node runs ArduPilot firmware (its hash can be checked against releases). */
  readonly isArduPilot: boolean
}

/** DroneCAN nodes found in a log. */
export interface CanInventory {
  /** Whether CAND logs the driver number (upstream groups the display by driver if so). */
  readonly haveDriverNum: boolean
  /** Distinct nodes ordered by driver (numbers ascending, then `'all'`), node id, then first seen. */
  readonly nodes: readonly CanNode[]
}

/** Empty inventory, used for `.param` files and logs without CAND. */
export const EMPTY_CAN: CanInventory = { haveDriverNum: false, nodes: [] }

function sameNode(a: CanNode, b: CanNode): boolean {
  return a.name === b.name && a.version === b.version && a.uid1 === b.uid1 && a.uid2 === b.uid2 && a.hash === b.hash
}

function driverOrder(d: CanDriver): number {
  return d === 'all' ? Number.POSITIVE_INFINITY : d
}

/** Read every distinct DroneCAN node identity from CAND (one CAND instance per node id). */
export function readCanNodes(log: DataflashLog): CanInventory {
  if (!log.has('CAND')) return EMPTY_CAN
  const haveDriverNum = log.has('CAND', 'Driver')
  const nodes: CanNode[] = []
  for (const nodeId of log.instances('CAND')) {
    const names = log.getStrings('CAND', 'Name', nodeId)
    const major = log.getNumbers('CAND', 'Major', nodeId)
    const minor = log.getNumbers('CAND', 'Minor', nodeId)
    const uid1 = log.getNumbers('CAND', 'UID1', nodeId)
    const uid2 = log.getNumbers('CAND', 'UID2', nodeId)
    const hash = log.getNumbers('CAND', 'Version', nodeId)
    const driver = haveDriverNum ? log.getNumbers('CAND', 'Driver', nodeId) : undefined
    if (!names || !major || !minor || !uid1 || !uid2 || !hash) continue
    for (let i = 0; i < names.length; i++) {
      const name = names[i] as string
      const node: CanNode = {
        driver: driver === undefined ? 'all' : (driver[i] as number),
        nodeId,
        name,
        version: `${major[i] as number}.${minor[i] as number}`,
        uid1: uid1[i] as number,
        uid2: uid2[i] as number,
        hash: (hash[i] as number).toString(16).padStart(8, '0'),
        isArduPilot: name.startsWith('org.ardupilot')
      }
      const duplicate = nodes.some((n) => n.driver === node.driver && n.nodeId === node.nodeId && sameNode(n, node))
      if (!duplicate) nodes.push(node)
    }
  }
  // Stable sort keeps first-seen order within one driver/node id, like upstream's arrays.
  nodes.sort((a, b) => driverOrder(a.driver) - driverOrder(b.driver) || a.nodeId - b.nodeId)
  return { haveDriverNum, nodes }
}

/** Nodes on `driver` with `nodeId`, in first-seen order. */
export function canNodesAt(can: CanInventory, driver: CanDriver, nodeId: number): readonly CanNode[] {
  return can.nodes.filter((n) => n.driver === driver && n.nodeId === nodeId)
}

/**
 * Name of the DroneCAN node a sensor device id points at: the node on driver `bus` if
 * logged, else the driver-less (`'all'`) entry (upstream `print_device`).
 */
export function canNameForDevice(can: CanInventory, bus: number, nodeId: number): string | undefined {
  return (canNodesAt(can, bus, nodeId)[0] ?? canNodesAt(can, 'all', nodeId)[0])?.name
}

/**
 * Name of the node with `nodeId` when it is found on exactly one driver; GPS parameters do
 * not say which bus the receiver is on (upstream `print_gps`).
 */
export function canNameForNodeId(can: CanInventory, nodeId: number): string | undefined {
  const drivers = new Set<CanDriver>()
  let name: string | undefined
  for (const n of can.nodes) {
    if (n.nodeId !== nodeId || drivers.has(n.driver)) continue
    drivers.add(n.driver)
    name = n.name
  }
  return drivers.size === 1 ? name : undefined
}
