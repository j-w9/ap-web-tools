import { beforeAll, describe, expect, it } from 'vitest'
import { createUpstreamMagfit, type UpstreamMagfit } from '../test-utils/upstream.js'
import { decodeCompassDevId, describeCompassDevice } from './devid.js'

interface UpDevice {
  bus_type: string
  bus_type_index: number
  bus: number
  address: number
  name: string
  sensor_id?: number
  devtype?: number
}

describe('decodeCompassDevId', () => {
  let up: UpstreamMagfit
  beforeAll(async () => {
    up = await createUpstreamMagfit()
  })

  it('matches upstream decode_devid for compasses', () => {
    const ids = [0, 97539, 590114, 658945, 73225, 76291, 131874, 1, 0x190a0b, 0x0c0103, 0x0f0004, 0x7f00ff]
    for (const id of ids) {
      const theirs = up.evaluate<UpDevice>(`decode_devid(${id}, DEVICE_TYPE_COMPASS)`)
      const mine = decodeCompassDevId(id)
      expect(mine.name, String(id)).toBe(theirs.name)
      expect(mine.busType, String(id)).toBe(theirs.bus_type)
      expect(mine.busTypeIndex).toBe(theirs.bus_type_index)
      expect(mine.bus).toBe(theirs.bus)
      expect(mine.address).toBe(theirs.address)
      if (theirs.sensor_id !== undefined) expect(mine.devtype - 1).toBe(theirs.sensor_id)
      else expect(mine.devtype).toBe(theirs.devtype)
    }
  })

  it('describes devices like the upstream status line', () => {
    expect(describeCompassDevice(0x0f0004)).toBe('SITL via SITL')
    expect(describeCompassDevice(0x090a01)).toBe('AK09916 via I2C')
    expect(describeCompassDevice(0x0c0103)).toBe('DRONECAN bus: 0 node id: 1 sensor: 11')
  })
})
