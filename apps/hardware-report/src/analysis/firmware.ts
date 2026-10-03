/**
 * Firmware and flight controller section (upstream `load_log()` "VER" and "FC" output).
 */
import type { DataflashLog } from '@apwt/dataflash'
import { boardName, getVersionAndBoard, type VersionAndBoard } from '@apwt/ardupilot'

/** Firmware and board identification with the board id resolved to a name. */
export interface FirmwareInfo extends VersionAndBoard {
  /** Short board name for {@link VersionAndBoard.boardId} from `board_types.txt`. */
  readonly boardName: string | undefined
  /** Whether the firmware hash can be checked against ArduPilot releases (UI does the lookup). */
  readonly canCheckRelease: boolean
}

/**
 * Firmware, OS and board details of a log. Upstream also checks the hash against GitHub
 * tags (`check_release`); that network lookup belongs to the UI layer and is not ported here.
 */
export function readFirmwareInfo(log: DataflashLog): FirmwareInfo {
  const version = getVersionAndBoard(log)
  return {
    ...version,
    boardName: version.boardId === undefined ? undefined : boardName(version.boardId),
    canCheckRelease: version.fwHash !== undefined
  }
}
