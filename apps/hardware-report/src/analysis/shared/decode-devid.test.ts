import { describe, expect, it } from 'vitest'
import { loadUpstream, rng, type UpstreamDevId } from '../../test-utils/upstream.js'
import { decodeDevId, DeviceType, type DecodedDevId } from './decode-devid.js'

function toUpstreamShape(d: DecodedDevId): UpstreamDevId {
  const base = { type: d.type, bus_type: d.busType, bus_type_index: d.busTypeIndex, bus: d.bus, address: d.address }
  return d.kind === 'dronecan' ? { ...base, sensor_id: d.sensorId, name: d.name } : { ...base, devtype: d.devtype, name: d.name }
}

const types = [DeviceType.compass, DeviceType.imu, DeviceType.baro, DeviceType.airspeed]

describe('decodeDevId (oracle: upstream DecodeDevID.js)', () => {
  const up = loadUpstream()

  const check = (id: number): void => {
    for (const t of types) {
      expect(toUpstreamShape(decodeDevId(id, t)), `id ${id} type ${t}`).toEqual({ ...up.decode_devid(id, t) })
    }
  }

  it('matches over a structured sweep of bus type, bus, address and devtype', () => {
    let n = 0
    for (let busType = 0; busType < 8; busType++) {
      for (const bus of [0, 1, 2, 5, 31]) {
        for (const address of [0, 0x1e, 0x68, 0xff]) {
          for (let devtype = 0; devtype <= 0x45; devtype++) {
            check(busType | (bus << 3) | (address << 8) | (devtype << 16))
            n++
          }
        }
      }
    }
    expect(n).toBeGreaterThan(10000)
  })

  it('matches on random, large, negative and fractional ids', () => {
    const next = rng(42)
    for (let i = 0; i < 3000; i++) check(Math.floor(next() * 2 ** 24))
    for (let i = 0; i < 500; i++) check(Math.floor(next() * 2 ** 32))
    for (const id of [0, -1, -65536, 2 ** 31, 2 ** 31 - 1, 2 ** 32 - 1, 1.5, 3408138.7, NaN]) check(id)
  })

  it('matches ids from the fixture logs', () => {
    for (const id of [
      3408138, 3408162, 816641, 97539, 131874, 263178, 97283, 97795, 98051, 2752772, 2752780, 2753028, 2753036, 65540, 65796
    ])
      check(id)
  })

  it('decodes known devices', () => {
    const imu = decodeDevId(3408138, DeviceType.imu)
    expect(imu).toMatchObject({ kind: 'local', busType: 'SPI', name: 'ICM42688' })
    const can = decodeDevId(3 | (1 << 3) | (125 << 8) | (1 << 16), DeviceType.compass)
    expect(can).toEqual({
      kind: 'dronecan',
      type: 'Compass',
      busType: 'DRONECAN',
      busTypeIndex: 3,
      bus: 1,
      address: 125,
      name: 'HMC5883_OLD',
      sensorId: 0
    })
  })
})
