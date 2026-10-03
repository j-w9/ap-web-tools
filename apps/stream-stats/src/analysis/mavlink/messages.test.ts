import { describe, expect, it } from 'vitest'
import { MAVLINK_MESSAGES, MAV_COMPONENTS, mavComponentName, mavlinkMessage } from './messages.js'
import { loadUpstreamTables } from '../test-support/upstream.js'

describe('MAVLink tables', () => {
  const upstream = loadUpstreamTables()

  it('match upstream mavlink_msgs entry for entry', () => {
    const expected = upstream.messages.flatMap((m, id) => (m ? [{ id, name: m.name, crcExtra: m.CRC }] : []))
    expect(MAVLINK_MESSAGES.map((m) => ({ ...m }))).toEqual(expected)
  })

  it('match upstream MAV_COMPONENT entry for entry', () => {
    const expected = upstream.components.flatMap((name, id) => (name === undefined ? [] : [{ id, name }]))
    expect(MAV_COMPONENTS.map((c) => ({ ...c }))).toEqual(expected)
  })

  it('look up by id', () => {
    expect(mavlinkMessage(0)?.name).toBe('HEARTBEAT')
    expect(mavlinkMessage(0)?.crcExtra).toBe(50)
    expect(mavlinkMessage(99999)).toBeUndefined()
    expect(mavComponentName(1)).toBe('MAV_COMP_ID_AUTOPILOT1')
    expect(mavComponentName(2)).toBeUndefined()
  })
})
