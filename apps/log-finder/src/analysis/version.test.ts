import { describe, expect, it } from 'vitest'
import { versionFromRecords } from './version.js'

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
