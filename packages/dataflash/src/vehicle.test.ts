import { describe, expect, it } from 'vitest'
import { DataflashLog } from './log.js'
import { LogWriter } from './test-support/synthetic-log.js'

function logWith(ver: { bu: number; fwt: number; fws: string } | null, messages: readonly string[]): DataflashLog {
  const w = new LogWriter()
  w.defineFormat(0x80, 'FMT', 'BBnNZ', 'Type,Length,Name,Format,Columns')
  if (ver) {
    w.defineFormat(10, 'VER', 'QBBZ', 'TimeUS,BU,FWT,FWS')
    w.write('VER', [1000, ver.bu, ver.fwt, ver.fws])
  }
  w.defineFormat(11, 'MSG', 'QZ', 'TimeUS,Message')
  for (const m of messages) w.write('MSG', [2000, m])
  return DataflashLog.parse(w.toBytes())
}

describe('vehicleType', () => {
  it('uses VER.BU even when a custom firmware string hides the vehicle name', () => {
    // Regression: SmallFastDrone logs have FWS "SmallFastDrone V4.7.0 (...)" and FWT=128 (beta).
    const log = logWith({ bu: 2, fwt: 128, fws: 'SmallFastDrone V4.7.0 (af47743e)' }, ['SmallFastDrone V4.7.0 (af47743e)'])
    expect(log.vehicleType()).toBe('copter')
  })

  it('does not treat VER.FWT (release type) as a vehicle', () => {
    expect(logWith({ bu: 0, fwt: 2, fws: 'Custom V1 (deadbeef)' }, []).vehicleType()).toBeUndefined()
  })

  it.each([
    [1, 'rover'],
    [3, 'plane'],
    [4, 'tracker'],
    [7, 'sub'],
    [12, 'blimp']
  ] as const)('maps build type %i to %s', (bu, vehicle) => {
    expect(logWith({ bu, fwt: 255, fws: 'x' }, []).vehicleType()).toBe(vehicle)
  })

  it('falls back to the MSG banner, as upstream get_version_and_board does', () => {
    expect(logWith(null, ['ArduPlane V4.5.7 (2a3dc4b7)']).vehicleType()).toBe('plane')
    expect(logWith(null, ['Mentions rover without a banner']).vehicleType()).toBeUndefined()
  })
})
