/**
 * The commands SimpleGCS sends, all as COMMAND_INT in MAV_FRAME_GLOBAL_RELATIVE_ALT_INT
 * (upstream `SimpleGCS/app.js`: `sendCommandInt`, `sendSetMode`, button and menu handlers).
 */
import { MavCmd, MavDoRepositionFlags, MavModeFlag } from '@apwt/mavlink'
import { ROVER_MODES } from '../vehicle/vehicle.js'

/** Seven COMMAND_INT parameters: param1-4, x, y, z. */
export type CommandParams = readonly [number, number, number, number, number, number, number]

/** One command to send, with the toast shown once it is sent. */
export interface CommandRequest {
  readonly command: MavCmd
  readonly params: CommandParams
  readonly sentText: string
}

/** Human-readable names for the commands SimpleGCS sends (upstream `mavCmdName`). */
export function mavCmdName(id: number): string {
  switch (id) {
    case MavCmd.MAV_CMD_COMPONENT_ARM_DISARM:
      return 'COMPONENT_ARM_DISARM'
    case MavCmd.MAV_CMD_DO_SET_MODE:
      return 'DO_SET_MODE'
    case MavCmd.MAV_CMD_DO_REPOSITION:
      return 'DO_REPOSITION'
    case MavCmd.MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN:
      return 'PREFLIGHT_REBOOT_SHUTDOWN'
    case MavCmd.MAV_CMD_DO_FENCE_ENABLE:
      return 'DO_FENCE_ENABLE'
    default:
      return `MAV_CMD ${id}`
  }
}

/**
 * MAV_RESULT names SimpleGCS reports (upstream `mavResultName`), or `RESULT n`. Upstream also has a
 * `MAV_RESULT_CANCELLED` case, but its bundled dialect lacks that constant (the case compares with
 * `undefined`), so result 6 reports as "RESULT 6". Reproduced: see `docs/upstream-bugs.md`.
 */
const RESULT_NAMES: readonly string[] = ['ACCEPTED', 'TEMPORARILY_REJECTED', 'DENIED', 'UNSUPPORTED', 'FAILED', 'IN_PROGRESS']

export function mavResultName(code: number): string {
  return RESULT_NAMES[code] ?? `RESULT ${code}`
}

/** Builds a request; missing or falsy parameters become 0 (upstream `params[i] || 0`). */
export function command(cmd: MavCmd, params: readonly number[] = [], sentText = `${mavCmdName(cmd)} sent`): CommandRequest {
  const p = (i: number): number => params[i] || 0
  return { command: cmd, params: [p(0), p(1), p(2), p(3), p(4), p(5), p(6)], sentText }
}

export const armCommand = (): CommandRequest => command(MavCmd.MAV_CMD_COMPONENT_ARM_DISARM, [1], 'ARM sent')
export const disarmCommand = (): CommandRequest => command(MavCmd.MAV_CMD_COMPONENT_ARM_DISARM, [0], 'DISARM sent')
export const forceArmCommand = (): CommandRequest => command(MavCmd.MAV_CMD_COMPONENT_ARM_DISARM, [1, 21196])
export const forceDisarmCommand = (): CommandRequest => command(MavCmd.MAV_CMD_COMPONENT_ARM_DISARM, [0, 21196])
export const rebootCommand = (): CommandRequest => command(MavCmd.MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN, [1])
export const fenceEnableCommand = (enable: boolean): CommandRequest => command(MavCmd.MAV_CMD_DO_FENCE_ENABLE, [enable ? 1 : 0])

/** The Rover mode buttons. */
export type ModeButton = 'RTL' | 'LOITER'

export const setModeCommand = (mode: ModeButton): CommandRequest =>
  command(MavCmd.MAV_CMD_DO_SET_MODE, [MavModeFlag.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED, ROVER_MODES[mode]], `${mode} sent`)

/** Long-press target: guided reposition, changing mode. */
export const repositionCommand = (lat: number, lng: number): CommandRequest =>
  command(MavCmd.MAV_CMD_DO_REPOSITION, [
    0,
    MavDoRepositionFlags.MAV_DO_REPOSITION_FLAGS_CHANGE_MODE,
    0,
    0,
    lat * 1e7,
    lng * 1e7,
    0
  ])

/** Confirmation text for the guarded menu commands (upstream `confirm()` prompts). */
export const CONFIRMATIONS = {
  reboot: 'Reboot the connected vehicle?',
  forceDisarm: 'Force disarm immediately? This bypasses normal disarm checks.',
  forceArm: 'Force arm? This bypasses pre-arm checks and may start the motors.'
} as const
export type GuardedCommand = keyof typeof CONFIRMATIONS

export const guardedCommand = (which: GuardedCommand): CommandRequest => {
  switch (which) {
    case 'reboot':
      return rebootCommand()
    case 'forceDisarm':
      return forceDisarmCommand()
    case 'forceArm':
      return forceArmCommand()
  }
}

/**
 * COMMAND_INT x/y as upstream's jspack packs an int32: clamped to the range, then truncated by
 * its bitwise byte extraction (`val & 255`, `val >> 8`), so NaN packs as 0.
 */
export function jspackInt32(value: number): number {
  const clamped = Math.min(2147483647, Math.max(-2147483648, value))
  return Number.isNaN(clamped) ? 0 : Math.trunc(clamped)
}
