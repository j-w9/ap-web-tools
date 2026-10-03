// Command payloads and names from upstream SimpleGCS/app.js.
import { describe, expect, it } from 'vitest'
import {
  armCommand,
  forceArmCommand,
  jspackInt32,
  mavCmdName,
  mavResultName,
  repositionCommand,
  setModeCommand
} from './commands.js'

describe('commands', () => {
  it('builds the upstream COMMAND_INT parameters', () => {
    expect(armCommand()).toEqual({ command: 400, params: [1, 0, 0, 0, 0, 0, 0], sentText: 'ARM sent' })
    expect(forceArmCommand().params).toEqual([1, 21196, 0, 0, 0, 0, 0])
    expect(setModeCommand('LOITER')).toEqual({ command: 176, params: [1, 5, 0, 0, 0, 0, 0], sentText: 'LOITER sent' })
    expect(repositionCommand(-35, 149).params).toEqual([0, 1, 0, 0, -350000000, 1490000000, 0])
    expect(mavCmdName(192)).toBe('DO_REPOSITION')
    expect(mavCmdName(31000)).toBe('MAV_CMD 31000')
  })

  it('reports result 6 as RESULT 6 (upstream dialect lacks MAV_RESULT_CANCELLED)', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 9].map(mavResultName)).toEqual([
      'ACCEPTED',
      'TEMPORARILY_REJECTED',
      'DENIED',
      'UNSUPPORTED',
      'FAILED',
      'IN_PROGRESS',
      'RESULT 6',
      'RESULT 9'
    ])
  })

  it('packs x/y as jspack int32: clamped, truncated, NaN as 0', () => {
    expect([1.9, -1.9, 3e9, -3e9, NaN].map(jspackInt32)).toEqual([1, -1, 2147483647, -2147483648, 0])
  })
})
