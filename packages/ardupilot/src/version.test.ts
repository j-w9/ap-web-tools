import { DataflashLog } from '@apwt/dataflash'
import { describe, expect, it } from 'vitest'
import { loadUpstream, readFixture, upstreamLogView, type UpstreamLog, type UpstreamVersion } from './test-utils/upstream.js'
import { getVersionAndBoard, versionFromRecords, type VerRecord, type VersionAndBoard } from './version.js'

function toUpstreamShape(v: VersionAndBoard): UpstreamVersion {
  return {
    flight_controller: v.flightController,
    board_id: v.boardId,
    fw_string: v.fwString,
    fw_hash: v.fwHash,
    os_string: v.osString,
    build_type: v.buildType,
    filter_version: v.filterVersion
  }
}

/** Fake upstream log from a VER record and MSG text. */
function fakeLog(ver: VerRecord | undefined, messages: string[]): UpstreamLog {
  const types: Record<string, unknown> = {}
  if (ver !== undefined) types['VER'] = {}
  if (messages.length > 0) types['MSG'] = {}
  return {
    messageTypes: types,
    get(name: string) {
      if (name === 'MSG') return { Message: messages }
      const v = ver as VerRecord
      const out: Record<string, ArrayLike<number> | string[]> = { FWS: [v.fws] }
      const map = { GH: v.gh, APJ: v.apj, BU: v.bu, FV: v.fv, Maj: v.maj, Min: v.min, Pat: v.pat }
      for (const [k, val] of Object.entries(map)) if (val !== undefined) out[k] = [val]
      return out
    }
  }
}

const bootMessages = [
  'Radio Failsafe Cleared',
  'ArduCopter V4.6.3 (92b0cd78)',
  'ChibiOS: 88b84600',
  'CubeOrange 0033003A 3433510B 34303639',
  'Param space used: 146/5376',
  'RC Protocol: DSM'
]

describe('getVersionAndBoard (oracle: upstream LogHelpers.js)', () => {
  const up = loadUpstream()

  it.each(['copter-files.bin', 'copter-sitl.bin'])('matches on %s', (name) => {
    const log = DataflashLog.parse(readFixture(name))
    expect(toUpstreamShape(getVersionAndBoard(log))).toEqual({ ...up.get_version_and_board(upstreamLogView(log)) })
  })

  it('reads the real board on copter-files.bin', () => {
    const v = getVersionAndBoard(DataflashLog.parse(readFixture('copter-files.bin')))
    expect(v).toEqual({
      flightController: 'BROTHERHOBBYH743 0033003A 3433510B 34303639',
      boardId: 5810,
      fwString: 'ArduCopter V4.6.3 (92b0cd78)',
      fwHash: '92b0cd78',
      osString: 'ChibiOS: 88b84600',
      buildType: 2,
      filterVersion: 2
    })
  })

  const cases: [string, VerRecord | undefined, string[]][] = [
    ['VER and MSG', { fws: 'ArduCopter V4.6.3 (92b0cd78)', gh: 0x92b0cd78, apj: 140, bu: 2, fv: 2 }, bootMessages],
    ['MSG only', undefined, bootMessages],
    ['VER only', { fws: 'ArduPlane V4.5.0 (00ab12cd)', gh: 0xab12cd, apj: 0, bu: 3 }, []],
    [
      'custom firmware string',
      { fws: 'AcmeCopter 1.2', gh: 0x1234, bu: 2, maj: 4, min: 6, pat: 3 },
      ['AcmeCopter 1.2 [ArduCopter V4.6.3]', 'ChibiOS: x', 'Board', 'Param space used: 1/2']
    ],
    ['custom string without version fields', { fws: 'AcmeCopter', bu: 2 }, []],
    ['unknown build type', { fws: 'Whatever 1.0', bu: 99 }, []],
    ['non-bracketed boot messages', undefined, ['ArduRover V4.5.0 (abcdef01)', 'ChibiOS: 1', 'Board', 'Something else']],
    ['firmware string mismatch', { fws: 'ArduSub V4.1.0 (11111111)' }, bootMessages],
    ['message without hash', undefined, ['ArduCopter V4.6.3', 'ChibiOS: 1', 'Board', 'Param space used: 1/2']],
    ['too few messages', undefined, ['ArduCopter V4.6.3 (92b0cd78)', 'ChibiOS', 'Board']],
    ['blimp', undefined, ['Blimp V4.4.0 (deadbeef)', 'ChibiOS: 1', 'MatekH743', 'Param space used: 1/2']]
  ]
  it.each(cases)('matches synthetic case: %s', (_label, ver, messages) => {
    expect(toUpstreamShape(versionFromRecords(ver, messages))).toEqual({ ...up.get_version_and_board(fakeLog(ver, messages)) })
  })
})

const BOOT = ['ArduPlane V4.5.0 (abcdef12)', 'ChibiOS: 1234', 'MatekH743 0011 2233', 'Param space used: 10/20']

describe('versionFromRecords', () => {
  it('reads board and OS from the boot messages without VER', () => {
    expect(versionFromRecords(undefined, ['hello', ...BOOT])).toEqual({
      flightController: 'MatekH743 0011 2233',
      boardId: undefined,
      fwString: 'ArduPlane V4.5.0 (abcdef12)',
      fwHash: 'abcdef12',
      osString: 'ChibiOS: 1234',
      buildType: 3,
      filterVersion: undefined
    })
  })

  it('appends the base firmware to custom firmware strings', () => {
    const v = versionFromRecords({ fws: 'Acme Wing 1.0', bu: 3, maj: 4, min: 5, gh: 0xabc, apj: 0 }, BOOT)
    expect(v.fwString).toBe('Acme Wing 1.0 [ArduPlane V4.5.?]')
    expect(v.fwHash).toBe('00000abc')
    expect(v.boardId).toBeUndefined()
    // The custom string does not match the boot banner, so no board line is found.
    expect(v.flightController).toBeUndefined()
  })

  it('needs the "Param space used" line three messages later', () => {
    expect(versionFromRecords(undefined, BOOT.slice(0, 3)).flightController).toBeUndefined()
  })
})
