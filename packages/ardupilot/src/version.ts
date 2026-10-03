/**
 * Firmware version and board detection.
 *
 * Port of upstream `Libraries/LogHelpers.js` `get_version_and_board`. `get_base_log_message_types`
 * is not needed: `DataflashLog.messageTypes()` already lists base names only.
 */
import type { DataflashLog } from '@apwt/dataflash'

/** Vehicle build type numbers used in the VER `BU` field (upstream `build_types`). */
export const BUILD_TYPES = {
  ArduRover: 1,
  ArduCopter: 2,
  ArduPlane: 3,
  AntennaTracker: 4,
  ArduSub: 7,
  Blimp: 12
} as const satisfies Record<string, number>

/** Firmware family name as printed in the boot banner. */
export type BuildName = keyof typeof BUILD_TYPES

const BUILD_NAMES: ReadonlyMap<number, BuildName> = new Map(
  Object.entries(BUILD_TYPES).map(([name, id]) => [id, name as BuildName])
)
const BUILD_IDS: ReadonlyMap<string, number> = new Map(Object.entries(BUILD_TYPES))

/** First values of the VER fields used for version detection. */
export interface VerRecord {
  /** Firmware string (`FWS`). */
  readonly fws: string
  /** Git hash (`GH`), if logged. */
  readonly gh?: number
  /** APJ board id (`APJ`), if logged. */
  readonly apj?: number
  /** Build type (`BU`), if logged. */
  readonly bu?: number
  /** Filter version (`FV`), if logged. */
  readonly fv?: number
  /** Major version (`Maj`), if logged. */
  readonly maj?: number
  /** Minor version (`Min`), if logged. */
  readonly min?: number
  /** Patch version (`Pat`), if logged. */
  readonly pat?: number
}

/** Firmware and board identification (upstream return value of `get_version_and_board`). */
export interface VersionAndBoard {
  /** Board line printed at boot, e.g. `"CubeOrange 0033003A ..."` (upstream `flight_controller`). */
  readonly flightController: string | undefined
  /** APJ board id, when non-zero. */
  readonly boardId: number | undefined
  /** Firmware string, e.g. `"ArduCopter V4.6.3 (92b0cd78)"`. */
  readonly fwString: string | undefined
  /** Firmware git hash: 8 hex digits from VER, else the bracketed text of the boot banner. */
  readonly fwHash: string | undefined
  /** OS line printed at boot, e.g. `"ChibiOS: 88b84600"`. */
  readonly osString: string | undefined
  /** Build type number (see {@link BUILD_TYPES}). */
  readonly buildType: number | undefined
  /** Filter version from VER. */
  readonly filterVersion: number | undefined
}

const BANNER = new RegExp(
  `(${Object.keys(BUILD_TYPES)
    .map((t) => `(?:${t})`)
    .join('|')}).+\\((.+)\\)`
)

/** Pure core of upstream `get_version_and_board`: the first VER record plus the MSG text. */
export function versionFromRecords(ver: VerRecord | undefined, messages: readonly string[]): VersionAndBoard {
  let flightController: string | undefined
  let boardId: number | undefined
  let fwString: string | undefined
  let fwHash: string | undefined
  let osString: string | undefined
  let buildType: number | undefined
  let filterVersion: number | undefined

  if (ver !== undefined) {
    fwString = ver.fws
    if (ver.gh !== undefined) fwHash = ver.gh.toString(16).padStart(8, '0')
    if (ver.apj !== undefined && ver.apj !== 0) boardId = ver.apj
    if (ver.bu !== undefined) buildType = ver.bu
    if (ver.fv !== undefined) filterVersion = ver.fv

    const buildName = buildType === undefined ? undefined : BUILD_NAMES.get(buildType)
    if (buildName !== undefined && !fwString.startsWith(buildName)) {
      // OEM firmware with AP_CUSTOM_FIRMWARE_STRING: append the base firmware info so the
      // string matches the boot MSG and the board/OS lines can still be found.
      const v = (x: number | undefined): string => (x === undefined ? '?' : String(x))
      fwString += ` [${buildName} V${v(ver.maj)}.${v(ver.min)}.${v(ver.pat)}]`
    }
  }

  // The firmware string marks the start of the boot messages; the next two give OS and board.
  for (let i = 0; i < messages.length - 3; i++) {
    const msg = messages[i]!
    if (fwString !== undefined && fwString !== msg) continue
    if (!messages[i + 3]!.startsWith('Param space used:')) continue
    const found = BANNER.exec(msg)
    if (found === null) continue
    fwString ??= found[0]
    buildType ??= found[1] === undefined ? undefined : BUILD_IDS.get(found[1])
    fwHash ??= found[2]
    osString = messages[i + 1]
    flightController = messages[i + 2]
    break
  }

  return { flightController, boardId, fwString, fwHash, osString, buildType, filterVersion }
}

/** Read the first VER record of a log, or `undefined` when it has none. */
export function readVerRecord(log: DataflashLog): VerRecord | undefined {
  const fws = log.getStrings('VER', 'FWS')?.[0]
  if (fws === undefined) return undefined
  const ver: { -readonly [K in keyof VerRecord]: VerRecord[K] } = { fws }
  const fields = [
    ['GH', 'gh'],
    ['APJ', 'apj'],
    ['BU', 'bu'],
    ['FV', 'fv'],
    ['Maj', 'maj'],
    ['Min', 'min'],
    ['Pat', 'pat']
  ] as const
  for (const [field, key] of fields) {
    const value = log.getNumbers('VER', field)?.[0]
    if (value !== undefined) ver[key] = value
  }
  return ver
}

/** Firmware and board details of a log (upstream `get_version_and_board(log)`). */
export function getVersionAndBoard(log: DataflashLog): VersionAndBoard {
  return versionFromRecords(readVerRecord(log), log.textMessages())
}
