// Differential test: upstream `SimpleGCS/fence.js` and `SimpleGCS/mission.js` (run in node:vm with
// the real upstream MAVLink constants and `MissionParser`, stub Leaflet layers and a recording FTP
// manager) against the port's `FileFetcher` configured as `session.ts` configures it. Seeded
// sequences of connects, disconnects, manual and automatic fetches, FTP replies (good, malformed,
// failed, stale), setting changes and time must give the same toasts, FTP requests, queue
// cancellations and drawn overlay.
import { runInNewContext } from 'node:vm'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { systemClock } from '../clock.js'
import type { FtpCallback } from '../ftp/client.js'
import type { GetFileOptions } from '../ftp/manager.js'
import { presentFence, presentMission } from '../session.js'
import { UPSTREAM, upstreamMissionParser, upstreamSource } from '../test-utils/upstream.js'
import { FileFetcher } from './file-fetcher.js'
import { parseFence, parseMissionItems, type FenceItem, type MissionItem, type MissionPoint } from './mission-file.js'

const require = createRequire(import.meta.url)

interface Item {
  readonly command: number
  readonly param1?: number
  readonly x?: number
  readonly y?: number
  readonly frame?: number
}

function file(items: readonly Item[], type: number): Uint8Array {
  const bytes = new Uint8Array(10 + 38 * items.length)
  const v = new DataView(bytes.buffer)
  v.setUint16(0, 0x763d, true)
  v.setUint16(2, type, true)
  v.setUint16(8, items.length, true)
  items.forEach((item, i) => {
    const o = 10 + i * 38
    v.setFloat32(o, item.param1 ?? 0, true)
    v.setInt32(o + 16, item.x ?? -350000000, true)
    v.setInt32(o + 20, item.y ?? 1490000000 + i * 1000, true)
    v.setUint16(o + 28, i, true)
    v.setUint16(o + 30, item.command, true)
    bytes[o + 34] = item.frame ?? 0
    bytes[o + 37] = type
  })
  return bytes
}

const FENCE_FILES: readonly (Uint8Array | null)[] = [
  null,
  file(
    [
      { command: 5003, param1: 30 },
      { command: 5002, param1: 3 },
      { command: 5002, param1: 3 },
      { command: 5002, param1: 3 }
    ],
    1
  ),
  file([{ command: 5004, param1: 10 }, { command: 16 }], 1),
  file([], 1),
  file([{ command: 5001, param1: 4 }], 1),
  new Uint8Array(5)
]
const MISSION_FILES: readonly (Uint8Array | null)[] = [
  null,
  file(
    [
      { command: 16, frame: 3 },
      { command: 22, frame: 0 },
      { command: 42702, frame: 0 },
      { command: 16, frame: 1 }
    ],
    0
  ),
  file([{ command: 178 }, { command: 16, x: 0, y: 0 }], 0),
  file([], 0),
  new Uint8Array(12)
]

interface Driver {
  readonly log: unknown[]
  connect(): void
  disconnect(): void
  fetch(silent: boolean): void
  clear(): void
  reply(index: number, data: Uint8Array | null): void
  readonly calls: number
  setAuto(on: boolean): void
  overlay(): number
}

interface UpstreamFetchApi {
  init(o: { map: object; MAVLink: object; toast: (m: string) => void; sendCommandInt?: unknown }): void
  onConnected(ws: object): void
  onDisconnected(): void
  fetch(silent?: boolean): void
  clear(): void
}

function upstreamDriver(kind: 'fence' | 'mission', autoDefault: boolean): Driver {
  const mav = require(resolve(UPSTREAM, 'modules/MAVLink/mavlink.js')) as { mavlink20: unknown }
  const parser = upstreamMissionParser()
  const log: unknown[] = []
  const calls: ((d: Uint8Array | null) => void)[] = []
  const layers = new Set<object>()
  const layer = (): object => ({
    addTo(this: object) {
      layers.add(this)
      return this
    },
    bindPopup() {},
    bindTooltip() {},
    setStyle() {}
  })
  const settingKey = kind === 'fence' ? 'autoFetchFence' : 'autoFetchMission'
  const window: { AppSettings: Record<string, boolean>; Fence?: UpstreamFetchApi; Mission?: UpstreamFetchApi } = {
    AppSettings: { [settingKey]: autoDefault }
  }
  runInNewContext(upstreamSource(`SimpleGCS/${kind}.js`), {
    window,
    setTimeout,
    clearTimeout,
    console: { log() {}, warn() {}, error() {} },
    mavlink20: mav.mavlink20,
    FTPManager: {
      getFile(path: string, cb: (d: Uint8Array | null) => void, opts: object) {
        log.push(['getFile', path, { ...opts }])
        calls.push(cb)
      },
      cancelQueuedByTag(tag: string) {
        log.push(['cancelQueuedByTag', tag])
      }
    },
    MissionParser: function MissionParser() {
      return parser
    },
    L: { circle: layer, polygon: layer, polyline: layer, circleMarker: layer }
  })
  const api = kind === 'fence' ? window.Fence! : window.Mission!
  api.init({ map: { removeLayer: (l: object) => layers.delete(l) }, MAVLink: {}, toast: (m) => log.push(['toast', m]) })
  return {
    log,
    connect: () => api.onConnected({}),
    disconnect: () => api.onDisconnected(),
    fetch: (silent) => api.fetch(silent),
    clear: () => api.clear(),
    reply: (index, data) => calls[index]?.(data),
    get calls() {
      return calls.length
    },
    setAuto: (on) => (window.AppSettings[settingKey] = on),
    // Mission draws a polyline plus one marker per point; fence one layer per fence.
    overlay: () => (kind === 'mission' && layers.size > 0 ? layers.size - 1 : layers.size)
  }
}

function portDriver(kind: 'fence' | 'mission', autoDefault: boolean): Driver {
  const log: unknown[] = []
  const calls: FtpCallback<Uint8Array>[] = []
  let auto = autoDefault
  const toast = (m: string): void => {
    log.push(['toast', m])
  }
  const ftp = {
    getFile(path: string, cb: FtpCallback<Uint8Array>, opts?: GetFileOptions) {
      log.push(['getFile', path, { ...opts }])
      calls.push(cb)
    },
    cancelQueuedByTag(tag: string) {
      log.push(['cancelQueuedByTag', tag])
    }
  }
  // As configured in session.ts.
  const fetcher =
    kind === 'fence'
      ? new FileFetcher<FenceItem[], readonly FenceItem[]>({
          path: '@MISSION/fence.dat',
          tag: 'fence',
          ftp,
          clock: systemClock,
          toast,
          autoFetch: () => auto,
          parse: parseFence,
          present: presentFence(toast),
          empty: [],
          messages: {
            fetching: 'Fetching fence…',
            failed: 'Failed to fetch fence',
            parseFailed: 'Failed to parse fence',
            parseError: 'Fence parse error'
          }
        })
      : new FileFetcher<MissionItem[], readonly MissionPoint[]>({
          path: '@MISSION/mission.dat',
          tag: 'mission',
          ftp,
          clock: systemClock,
          toast,
          autoFetch: () => auto,
          parse: parseMissionItems,
          present: presentMission(toast),
          empty: [],
          messages: {
            fetching: 'Fetching mission…',
            failed: 'Failed to fetch mission',
            parseFailed: 'Failed to parse mission',
            parseError: 'Mission parse error'
          }
        })
  return {
    log,
    connect: () => fetcher.onConnected(),
    disconnect: () => fetcher.onDisconnected(),
    fetch: (silent) => fetcher.fetch(silent),
    clear: () => fetcher.clear(),
    reply: (index, data) => calls[index]?.(data === null ? { kind: 'failed' } : { kind: 'done', value: data }),
    get calls() {
      return calls.length
    },
    setAuto: (on) => (auto = on),
    overlay: () => fetcher.overlay.length
  }
}

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function run(d: Driver, kind: 'fence' | 'mission', seed: number): unknown[] {
  const random = rng(seed)
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!
  const files = kind === 'fence' ? FENCE_FILES : MISSION_FILES
  for (let step = 0; step < 120; step++) {
    const r = random()
    if (r < 0.08) d.connect()
    else if (r < 0.13) d.disconnect()
    else if (r < 0.25) d.fetch(random() < 0.5)
    else if (r < 0.27) d.clear()
    else if (r < 0.55 && d.calls > 0) {
      // Mostly the newest request; sometimes an older (stale or already answered) one.
      const index = random() < 0.8 ? d.calls - 1 : Math.floor(random() * d.calls)
      d.reply(index, pick(files))
    } else if (r < 0.6) d.setAuto(random() < 0.6)
    else vi.advanceTimersByTime(pick([1000, 4999, 5000, 10000]))
    d.log.push(['state', d.calls, d.overlay()])
  }
  return d.log
}

describe('FileFetcher vs upstream fence.js / mission.js (seeded)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })
  for (const kind of ['fence', 'mission'] as const) {
    for (let seed = 1; seed <= 60; seed++) {
      it(`${kind} seed ${seed}: identical toasts, requests and overlay`, () => {
        const autoDefault = kind === 'fence' ? seed % 4 !== 0 : seed % 2 === 0
        vi.useFakeTimers({ now: 1000 })
        const theirs = run(upstreamDriver(kind, autoDefault), kind, seed)
        vi.useRealTimers()
        vi.useFakeTimers({ now: 1000 })
        const ours = run(portDriver(kind, autoDefault), kind, seed)
        expect(ours).toEqual(theirs)
      })
    }
  }
})
