// Command payloads and names from upstream SimpleGCS/app.js.
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { COMMAND_INT, MavFrame, MavlinkEncoder } from '@apwt/mavlink'
import { describe, expect, it } from 'vitest'
import { UPSTREAM } from '../test-utils/upstream.js'
import {
  armCommand,
  disarmCommand,
  fenceEnableCommand,
  forceArmCommand,
  forceDisarmCommand,
  jspackInt32,
  mavCmdName,
  mavResultName,
  rebootCommand,
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

describe('COMMAND_INT frames oracle (upstream mavlink.js pack, as app.js sendCommandInt builds it)', () => {
  interface UpstreamMessage {
    pack(mav: unknown): number[]
  }
  interface UpstreamMavlink {
    ready: Promise<void>
    messages: { command_int: new (...args: number[]) => UpstreamMessage }
  }

  it('produces byte-identical frames, including fractional, out-of-range and NaN coordinates', async () => {
    const require = createRequire(import.meta.url)
    const mod = require(resolve(UPSTREAM, 'modules/MAVLink/mavlink.js')) as {
      mavlink20: UpstreamMavlink
      MAVLink20Processor: new (logger: null, system: number, component: number) => { seq: number }
    }
    await mod.mavlink20.ready
    const mav = new mod.MAVLink20Processor(null, 255, 190)
    const encoder = new MavlinkEncoder({ systemId: 255, componentId: 190 })
    const requests = [
      armCommand(),
      disarmCommand(),
      forceArmCommand(),
      forceDisarmCommand(),
      rebootCommand(),
      fenceEnableCommand(true),
      fenceEnableCommand(false),
      setModeCommand('RTL'),
      setModeCommand('LOITER'),
      ...[
        [-35.0010000007, 149.0020000003],
        [89.99999999, 179.99999999],
        [-300, 300],
        [Number.NaN, 1e-8],
        [0.12345678912, -0.98765432198]
      ].map(([lat, lng]) => repositionCommand(lat!, lng!))
    ]
    for (const request of requests) {
      const p = request.params
      mav.seq = encoder.sequence
      const upstream = new mod.mavlink20.messages.command_int(42, 1, 6, request.command, 0, 0, ...p).pack(mav)
      const port = encoder.encode(COMMAND_INT, {
        targetSystem: 42,
        targetComponent: 1,
        frame: MavFrame.MAV_FRAME_GLOBAL_RELATIVE_ALT_INT,
        command: request.command,
        current: 0,
        autocontinue: 0,
        param1: p[0],
        param2: p[1],
        param3: p[2],
        param4: p[3],
        x: jspackInt32(p[4]),
        y: jspackInt32(p[5]),
        z: p[6]
      })
      expect(Array.from(port)).toEqual(Array.from(upstream))
    }
  })
})
