// Differential test: upstream `SimpleGCS/ftp_manager.js` (run in node:vm with a recording fake
// MAVFTP, as upstream's own test does) and the port's `FtpManager` (with the same fake behind its
// client port) receive identical seeded sequences of requests, replies, completions, link changes,
// de-duplication and watchdog expiries. Every callback, the busy flag, the queue length and the
// requests reaching each client instance must match.
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { systemClock } from '../clock.js'
import { upstreamSource } from '../test-utils/upstream.js'
import type { DownloadOptions, FtpCallback, FtpInbound } from './client.js'
import { FtpManager, type FtpClientPort, type GetFileOptions } from './manager.js'

type Value = Uint8Array | number | null

interface Recorded {
  readonly path: string
  readonly upload: boolean
  readonly options?: unknown
}

/** One client instance, recording the requests it receives. */
interface FakeClient {
  readonly calls: Recorded[]
  targetSystem: number
  targetComponent: number
  /** Completes the active request with success (upstream `complete(data)`). */
  succeed(): void
  /** Completes the active request with failure (upstream `complete(null)`). */
  fail(): void
  /** Invokes a stale callback from an earlier request. */
  stale(index: number): void
}

interface UpstreamManager {
  setLink(mavlink: object | null, ws: object | null, sysId: number, compId: number): void
  clearLink(): void
  handleMessage(m: { valid: boolean }): void
  getFile(path: string, cb: (d: unknown) => void, opts?: object): void
  putFile(path: string, data: Uint8Array, cb: (d: unknown) => void, opts?: object): void
  cancelQueuedByTag(tag: string): void
  cancelQueuedByPath(path: string): void
  isBusy(): boolean
  queuedCount(): number
}

interface Driver {
  readonly instances: FakeClient[]
  setLink(connection: object, sysId: number, compId: number): void
  clearLink(): void
  handleMessage(valid: boolean): void
  getFile(path: string, cb: (d: unknown) => void, opts: GetFileOptions): void
  putFile(path: string, data: Uint8Array, cb: (d: unknown) => void, timeoutMs: number | undefined): void
  cancelQueuedByTag(tag: string): void
  cancelQueuedByPath(path: string): void
  isBusy(): boolean
  queuedCount(): number
}

const successValue = (upload: boolean, path: string): Value => (upload ? path.length : new TextEncoder().encode(path))
const norm = (d: unknown): unknown => (d instanceof Uint8Array ? Array.from(d) : d)

function upstreamDriver(): Driver {
  const instances: FakeClient[] = []
  class FakeFTP implements FakeClient {
    targetSystem = 0
    targetComponent = 0
    readonly calls: Recorded[] = []
    private readonly cbs: ((d: Value) => void)[] = []
    private cb: ((d: Value) => void) | null = null
    constructor() {
      instances.push(this)
    }
    succeed(): void {
      const last = this.calls.at(-1)
      const cb = this.cb
      this.cb = null
      if (last !== undefined) cb?.(successValue(last.upload, last.path))
    }
    fail(): void {
      this.cancel()
    }
    stale(index: number): void {
      this.cbs[index % Math.max(1, this.cbs.length)]?.(null)
    }
    getFile(path: string, cb: (d: Value) => void, options: unknown): void {
      this.calls.push({ path, upload: false, options })
      this.cb = cb
      this.cbs.push(cb)
    }
    putFile(path: string, _data: Uint8Array, cb: (d: Value) => void): void {
      this.calls.push({ path, upload: true })
      this.cb = cb
      this.cbs.push(cb)
    }
    cancel(): void {
      const cb = this.cb
      this.cb = null
      cb?.(null)
    }
    handleMessage(m: { valid: boolean }): boolean {
      return m.valid
    }
  }
  const window: { FTPManager?: UpstreamManager } = {}
  runInNewContext(upstreamSource('SimpleGCS/ftp_manager.js'), { window, MAVFTP: FakeFTP, setTimeout, clearTimeout })
  const m = window.FTPManager!
  const mavlink = {}
  return {
    instances,
    setLink: (connection, sysId, compId) => m.setLink(mavlink, connection, sysId, compId),
    clearLink: () => m.clearLink(),
    handleMessage: (valid) => m.handleMessage({ valid }),
    getFile: (path, cb, opts) => m.getFile(path, (d) => cb(norm(d)), opts),
    putFile: (path, data, cb, timeoutMs) =>
      m.putFile(path, data, (d) => cb(norm(d)), timeoutMs === undefined ? {} : { timeoutMs }),
    cancelQueuedByTag: (tag) => m.cancelQueuedByTag(tag),
    cancelQueuedByPath: (path) => m.cancelQueuedByPath(path),
    isBusy: () => m.isBusy(),
    queuedCount: () => m.queuedCount()
  }
}

function portDriver(): Driver {
  const instances: FakeClient[] = []
  const create = (): FtpClientPort => {
    const calls: Recorded[] = []
    const cbs: ((ok: boolean) => void)[] = []
    let cb: ((ok: boolean) => void) | null = null
    const client: FtpClientPort & { calls: Recorded[] } = {
      targetSystem: 0,
      targetComponent: 0,
      calls,
      getFile(path: string, callback: FtpCallback<Uint8Array>, options?: DownloadOptions) {
        calls.push({ path, upload: false, options })
        const value = successValue(false, path)
        cb = (ok) => callback(ok && value instanceof Uint8Array ? { kind: 'done', value } : { kind: 'failed' })
        cbs.push(cb)
      },
      putFile(path: string, _data: Uint8Array, callback: FtpCallback<number>) {
        calls.push({ path, upload: true })
        const value = successValue(true, path)
        cb = (ok) => callback(ok && typeof value === 'number' ? { kind: 'done', value } : { kind: 'failed' })
        cbs.push(cb)
      },
      cancel() {
        const c = cb
        cb = null
        c?.(false)
      },
      handleMessage: (m: FtpInbound) => m.name === 'valid'
    }
    instances.push({
      calls,
      get targetSystem() {
        return client.targetSystem
      },
      get targetComponent() {
        return client.targetComponent
      },
      succeed: () => {
        const c = cb
        cb = null
        c?.(true)
      },
      fail: () => client.cancel(),
      stale: (index) => cbs[index % Math.max(1, cbs.length)]?.(false)
    })
    return client
  }
  const m = new FtpManager(create, systemClock)
  const msg = (valid: boolean): FtpInbound => ({
    name: valid ? 'valid' : 'invalid',
    header: { systemId: 0, componentId: 0 },
    fields: { targetSystem: 0, targetComponent: 0, payload: new Uint8Array() }
  })
  const out =
    (cb: (d: unknown) => void) =>
    (o: { kind: 'done'; value: unknown } | { kind: 'failed' }): void =>
      cb(o.kind === 'failed' ? null : norm(o.value))
  return {
    instances,
    setLink: (connection, systemId, componentId) => m.setLink({ connection, systemId, componentId }),
    clearLink: () => m.clearLink(),
    handleMessage: (valid) => m.handleMessage(msg(valid)),
    getFile: (path, cb, opts) => m.getFile(path, out(cb), opts),
    putFile: (path, data, cb, timeoutMs) => m.putFile(path, data, out(cb), timeoutMs === undefined ? {} : { timeoutMs }),
    cancelQueuedByTag: (tag) => m.cancelQueuedByTag(tag),
    cancelQueuedByPath: (path) => m.cancelQueuedByPath(path),
    isBusy: () => m.isBusy(),
    queuedCount: () => m.queuedCount()
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

function run(d: Driver, seed: number): unknown[] {
  const random = rng(seed)
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!
  const log: unknown[] = []
  const connections = [{}, {}]
  d.setLink(connections[0]!, 42, 1)
  let n = 0
  for (let step = 0; step < 200; step++) {
    const r = random()
    const current = d.instances.at(-1)
    if (r < 0.3) {
      const id = n++
      const path = pick(['@MISSION/fence.dat', '@MISSION/mission.dat', '@PARAM/param.pck', `f${id}`])
      const tag = pick([undefined, 'fence', 'mission', ''])
      const opts: GetFileOptions = {
        ...(tag === undefined ? {} : { tag }),
        ...(random() < 0.5 ? { dropQueuedTag: true } : {}),
        ...(random() < 0.4 ? { dropQueuedPath: true } : {}),
        ...(random() < 0.5 ? { timeoutMs: pick([1000, 5000, 20000]) } : {}),
        ...(random() < 0.3 ? { sizeIsEstimate: true, fixedReadSize: true } : {})
      }
      d.getFile(path, (v) => log.push(['cb', id, v]), opts)
    } else if (r < 0.38) {
      const id = n++
      d.putFile(`u${id}`, new Uint8Array(3), (v) => log.push(['cb', id, v]), random() < 0.5 ? 2000 : undefined)
    } else if (r < 0.55) current?.succeed()
    else if (r < 0.6) current?.fail()
    else if (r < 0.63) current?.stale(Math.floor(random() * 10))
    else if (r < 0.72) d.handleMessage(random() < 0.5)
    else if (r < 0.75) d.cancelQueuedByTag(pick(['fence', 'mission', '']))
    else if (r < 0.77) d.cancelQueuedByPath(pick(['@MISSION/fence.dat', '@PARAM/param.pck']))
    else if (r < 0.8) d.setLink(pick(connections), pick([42, 42, 43, -1, 0, 256]), pick([1, 1, 0, 255, 256, 1.5]))
    else if (r < 0.81) d.clearLink()
    else vi.advanceTimersByTime(pick([250, 1000, 2000, 5000]))
    log.push([
      'state',
      d.isBusy(),
      d.queuedCount(),
      d.instances.length,
      d.instances.map((i) => [i.targetSystem, i.targetComponent, i.calls.map((c) => [c.path, c.upload, c.options ?? null])])
    ])
  }
  return log
}

describe('FtpManager vs upstream ftp_manager.js (seeded)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })
  for (let seed = 1; seed <= 100; seed++) {
    it(`seed ${seed}: identical callbacks, queue and client requests`, () => {
      vi.useFakeTimers({ now: 1000 })
      const theirs = run(upstreamDriver(), seed)
      vi.useRealTimers()
      vi.useFakeTimers({ now: 1000 })
      const ours = run(portDriver(), seed)
      expect(ours).toEqual(theirs)
    })
  }
})
