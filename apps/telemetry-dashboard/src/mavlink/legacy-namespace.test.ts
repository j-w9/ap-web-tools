// The rebuilt `mavlink20` global against upstream's: constants, map and message classes.
import { beforeAll, describe, expect, it } from 'vitest'
import { loadUpstreamMavlink, plain, type UpstreamMavlink } from '../test-support/upstream-mavlink.js'
import { createLegacyMavlink20, type LegacyMavlink20, xmlEnumName } from './legacy-namespace.js'

let upstream: UpstreamMavlink
let ours: LegacyMavlink20
beforeAll(async () => {
  upstream = await loadUpstreamMavlink()
  ours = createLegacyMavlink20()
})

describe('legacy mavlink20 namespace', () => {
  it('maps export names back to XML enum names', () => {
    expect(xmlEnumName('MavType')).toBe('MAV_TYPE')
    expect(xmlEnumName('UavionixAdsbOutCfgGpsOffsetLat')).toBe('UAVIONIX_ADSB_OUT_CFG_GPS_OFFSET_LAT')
  })

  it('defines upstream numeric constants with the same values', () => {
    const numeric = Object.entries(upstream.mavlink20).filter(([, v]) => typeof v === 'number')
    const missing: string[] = []
    const changed: string[] = []
    let compared = 0
    for (const [key, value] of numeric) {
      if (!(key in ours)) {
        missing.push(key)
        continue
      }
      if (ours[key] !== value) changed.push(key)
      compared++
    }
    expect(compared).toBeGreaterThan(2000)
    // The package is generated from the definitions upstream's mavlink.js was generated from.
    expect(missing, missing.join(', ')).toEqual([])
    expect(changed, changed.join(', ')).toEqual([])
    const extra = Object.entries(ours).filter(([k, v]) => typeof v === 'number' && !(k in upstream.mavlink20))
    expect(extra.map(([k]) => k)).toEqual([])
  })

  it('defines exactly upstream message ids', () => {
    expect(Object.keys(ours.map)).toEqual(Object.keys(upstream.mavlink20.map))
  })

  it('names components for the MAVLink Inspector exactly as upstream (its lookup keeps the last key per value)', () => {
    const lookup = (namespace: Record<string, unknown>) => {
      const out: Record<string, string> = {}
      for (const [key, value] of Object.entries(namespace)) if (key.startsWith('MAV_COMP_ID')) out[String(value)] = key
      return out
    }
    expect(lookup(ours)).toEqual(lookup(upstream.mavlink20))
  })

  it('has every MAV_COMP_ID constant the MAVLink Inspector widget looks up', () => {
    for (const [key, value] of Object.entries(upstream.mavlink20)) {
      if (key.startsWith('MAV_COMP_ID')) expect(ours[key], key).toBe(value)
    }
    expect(ours.MAV_COMP_ID_AUTOPILOT1).toBe(1)
  })

  it('builds map entries and message classes like upstream', () => {
    let compared = 0
    for (const [id, entry] of Object.entries(upstream.mavlink20.map)) {
      const mine = ours.map[Number(id)]
      expect(mine, id).toBeDefined()
      if (mine === undefined) continue
      expect(mine.crc_extra, id).toBe(entry.crc_extra)
      const theirs = plain(new entry.type()) as Record<string, unknown>
      const fresh = plain(new mine.type()) as Record<string, unknown>
      expect(fresh, id).toStrictEqual(theirs)
      compared++
    }
    expect(compared).toBe(Object.keys(upstream.mavlink20.map).length)
  })

  it('assigns constructor arguments to fields in XML order', () => {
    const msg = new ours.messages.heartbeat!(6, 8, 0, 0, 4)
    expect([msg.type, msg.autopilot, msg.mavlink_version, msg._name, msg._id]).toEqual([6, 8, 3, 'HEARTBEAT', 0])
  })

  it('computes the X.25 checksum as upstream', () => {
    const bytes = [1, 2, 3, 250, 99]
    expect(ours.x25Crc(bytes)).toBe((upstream.mavlink20.x25Crc as (b: number[]) => number)(bytes))
    expect(ours.x25Crc(bytes, 1234)).toBe((upstream.mavlink20.x25Crc as (b: number[], c: number) => number)(bytes, 1234))
  })
})
