// Port of the mission and fence cases of upstream tests/simplegcs-interactions.test.cjs. Upstream
// counts Leaflet layers (a polyline plus one marker per point); here the overlay is the point list.
import { describe, expect, it } from 'vitest'
import type { FtpCallback } from '../ftp/client.js'
import { presentMission } from '../session.js'
import { FakeClock } from '../test-utils/fake-clock.js'
import { FileFetcher, type FileFetchPort } from './file-fetcher.js'
import type { FenceItem, MissionItem, MissionPoint } from './mission-file.js'

const ok = (value: Uint8Array): Parameters<FtpCallback<Uint8Array>>[0] => ({ kind: 'done', value })
const failed: Parameters<FtpCallback<Uint8Array>>[0] = { kind: 'failed' }
const point = (patch: Partial<MissionItem>): MissionItem => ({
  targetSystem: 42,
  targetComponent: 1,
  seq: 4,
  frame: 0,
  command: 16,
  current: 0,
  autocontinue: 0,
  param1: 0,
  param2: 0,
  param3: 0,
  param4: 0,
  x: -350000000,
  y: 1490000000,
  z: 0,
  missionType: 0,
  ...patch
})

/** Byte 0 of the "file" selects a parse result, standing in for upstream's stubbed parser. */
const BAD = Uint8Array.of(0)
const POINTS = Uint8Array.of(1)
const EMPTY = Uint8Array.of(2)

function missionFetcher(auto = true) {
  const clock = new FakeClock()
  const calls: { path: string; cb: FtpCallback<Uint8Array> }[] = []
  const settings = { autoFetchMission: auto }
  const ftp: FileFetchPort = { getFile: (path, cb) => calls.push({ path, cb }), cancelQueuedByTag() {} }
  const fetcher = new FileFetcher<MissionItem[], readonly MissionPoint[]>({
    path: '@MISSION/mission.dat',
    tag: 'mission',
    ftp,
    clock,
    toast() {},
    autoFetch: () => settings.autoFetchMission,
    parse: (data) => {
      if (data[0] === 0) throw Error('malformed')
      return data[0] === 1 ? [point({})] : []
    },
    present: presentMission(() => {}),
    empty: [],
    messages: { fetching: '', failed: '', parseFailed: '', parseError: '' }
  })
  fetcher.onConnected()
  return { fetcher, calls, clock, settings }
}

describe('mission fetch', () => {
  it('automatic mission download retries failures without overlapping pending transfers', () => {
    const { fetcher, calls, clock } = missionFetcher()
    expect(calls.length).toBe(1)
    clock.tick(15000)
    fetcher.fetch()
    expect(calls.length).toBe(1)
    calls[0]!.cb(failed)
    clock.tick(4999)
    expect(calls.length).toBe(1)
    clock.tick(1)
    expect(calls.length).toBe(2)
    calls[1]!.cb(ok(POINTS))
    expect(fetcher.overlay.length).toBe(1)
    clock.tick(20000)
    expect(calls.length).toBe(2)
  })

  it('mission auto-fetch setting is respected, including disabling a scheduled retry', () => {
    const { fetcher, calls, clock, settings } = missionFetcher(false)
    clock.tick(10000)
    expect(calls.length).toBe(0)
    fetcher.fetch()
    calls[0]!.cb(failed)
    clock.tick(10000)
    expect(calls.length).toBe(1)
    settings.autoFetchMission = true
    fetcher.onConnected()
    calls[1]!.cb(failed)
    settings.autoFetchMission = false
    clock.tick(10000)
    expect(calls.length).toBe(2)
  })

  it('disconnect clears mission layers and ignores replies from a previous vehicle', () => {
    const { fetcher, calls, clock } = missionFetcher()
    calls[0]!.cb(ok(POINTS))
    fetcher.fetch()
    const stale = calls[1]!.cb
    fetcher.onDisconnected()
    expect(fetcher.overlay.length).toBe(0)
    fetcher.onConnected()
    stale(ok(POINTS))
    expect(fetcher.overlay.length).toBe(0)
    calls[2]!.cb(failed)
    fetcher.onDisconnected()
    clock.tick(10000)
    expect(calls.length).toBe(3)
  })

  it('malformed missions retry; an empty mission completes and clears the overlay', () => {
    const { fetcher, calls, clock } = missionFetcher()
    calls[0]!.cb(ok(BAD))
    clock.tick(5000)
    expect(calls.length).toBe(2)
    calls[1]!.cb(ok(POINTS))
    expect(fetcher.overlay.length).toBe(1)
    fetcher.fetch()
    calls[2]!.cb(ok(EMPTY))
    expect(fetcher.overlay.length).toBe(0)
    clock.tick(10000)
    expect(calls.length).toBe(3)
  })
})

describe('fence fetch', () => {
  it('fence disconnect clears overlays and invalidates in-flight downloads', () => {
    const clock = new FakeClock()
    const calls: FtpCallback<Uint8Array>[] = []
    const circle: FenceItem = { kind: 'circle', type: 5003, lat: -35, lng: 149, radius: 10 }
    const fetcher = new FileFetcher<FenceItem[], readonly FenceItem[]>({
      path: '@MISSION/fence.dat',
      tag: 'fence',
      ftp: { getFile: (_path, cb) => calls.push(cb), cancelQueuedByTag() {} },
      clock,
      toast() {},
      autoFetch: () => true,
      parse: () => [circle],
      present: (fences) => fences,
      empty: [],
      messages: { fetching: '', failed: '', parseFailed: '', parseError: '' }
    })
    fetcher.onConnected()
    calls[0]!(ok(POINTS))
    expect(fetcher.overlay.length).toBe(1)
    fetcher.fetch()
    fetcher.onDisconnected()
    expect(fetcher.overlay.length).toBe(0)
    fetcher.onConnected()
    calls[1]!(ok(POINTS))
    expect(fetcher.overlay.length).toBe(0)
    calls[2]!(failed)
    fetcher.onDisconnected()
    clock.tick(10000)
    expect(calls.length).toBe(3)
  })
})
