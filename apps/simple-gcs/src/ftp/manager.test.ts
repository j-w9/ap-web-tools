// Port of upstream tests/ftp_manager.test.cjs.
import { describe, expect, it } from 'vitest'
import { FakeClock } from '../test-utils/fake-clock.js'
import type { DownloadOptions, FtpCallback, FtpInbound, FtpOutcome } from './client.js'
import { FtpManager, type FtpClientPort, type FtpLinkIdentity } from './manager.js'

interface Call {
  readonly path: string
  readonly cb: FtpCallback<Uint8Array> | FtpCallback<number>
  readonly options?: DownloadOptions | undefined
  readonly data?: Uint8Array
}

class FakeFtp implements FtpClientPort {
  targetSystem = 0
  targetComponent = 0
  calls: Call[] = []
  private cb: ((o: FtpOutcome<never>) => void) | null = null
  private deliver: ((value: Uint8Array | number) => void) | null = null
  getFile(path: string, cb: FtpCallback<Uint8Array>, options?: DownloadOptions): void {
    this.calls.push({ path, cb, options })
    this.cb = cb
    this.deliver = (v) => {
      if (v instanceof Uint8Array) cb({ kind: 'done', value: v })
    }
  }
  putFile(path: string, data: Uint8Array, cb: FtpCallback<number>): void {
    this.calls.push({ path, data, cb })
    this.cb = cb
    this.deliver = (v) => {
      if (typeof v === 'number') cb({ kind: 'done', value: v })
    }
  }
  cancel(): void {
    const cb = this.cb
    this.cb = this.deliver = null
    cb?.({ kind: 'failed' })
  }
  handleMessage(m: FtpInbound): boolean {
    return m.name === 'valid'
  }
  complete(value: Uint8Array | number): void {
    const deliver = this.deliver
    this.cb = this.deliver = null
    deliver?.(value)
  }
}

const msg = (valid: boolean): FtpInbound => ({
  name: valid ? 'valid' : 'invalid',
  header: { systemId: 0, componentId: 0 },
  fields: { targetSystem: 0, targetComponent: 0, payload: new Uint8Array() }
})
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)
const v = (o: FtpOutcome<Uint8Array | number>): Uint8Array | number | null => (o.kind === 'done' ? o.value : null)

function setup() {
  const clock = new FakeClock(1000)
  const instances: FakeFtp[] = []
  const manager = new FtpManager(() => {
    const f = new FakeFtp()
    instances.push(f)
    return f
  }, clock)
  const connection = {}
  const link: FtpLinkIdentity = { connection, systemId: 42, componentId: 1 }
  manager.setLink(link)
  return { manager, instances, ftp: instances[0]!, link, clock }
}

describe('FTPManager', () => {
  it('queue serializes files and completion advances exactly once', () => {
    const { manager, ftp } = setup()
    const results: [string, unknown][] = []
    manager.getFile('first', (d) => results.push(['first', v(d)]))
    manager.getFile('second', (d) => results.push(['second', v(d)]))
    expect(ftp.calls.map((c) => c.path)).toEqual(['first'])
    expect(manager.queuedCount()).toBe(1)
    const old = ftp.calls[0]!.cb as FtpCallback<Uint8Array>
    ftp.complete(bytes('one'))
    expect(ftp.calls[1]!.path).toBe('second')
    old({ kind: 'done', value: bytes('stale') })
    expect(manager.isBusy()).toBe(true)
    ftp.complete(bytes('two'))
    expect(results).toEqual([
      ['first', bytes('one')],
      ['second', bytes('two')]
    ])
    expect(manager.isBusy()).toBe(false)
  })

  it('timeout cancels old transfer; late callback cannot finish the next job', () => {
    const { manager, ftp, clock } = setup()
    const results: unknown[] = []
    manager.getFile('slow', (d) => results.push(v(d)), { timeoutMs: 1000 })
    manager.getFile('next', (d) => results.push(v(d)))
    const stale = ftp.calls[0]!.cb as FtpCallback<Uint8Array>
    clock.tick(1000)
    expect(results).toEqual([null])
    expect(ftp.calls[1]!.path).toBe('next')
    stale({ kind: 'done', value: bytes('late') })
    expect(results).toEqual([null])
    ftp.complete(bytes('ok'))
    expect(results).toEqual([null, bytes('ok')])
  })

  it('only an accepted FTP response extends the watchdog', () => {
    const { manager, ftp, clock } = setup()
    const results: unknown[] = []
    manager.getFile('file', (d) => results.push(v(d)), { timeoutMs: 1000 })
    clock.tick(750)
    manager.handleMessage(msg(false))
    clock.tick(250)
    expect(results).toEqual([null])
    manager.getFile('file', (d) => results.push(v(d)), { timeoutMs: 1000 })
    clock.tick(750)
    manager.handleMessage(msg(true))
    clock.tick(750)
    expect(manager.isBusy()).toBe(true)
    ftp.complete(bytes('ok'))
  })

  it('disconnect completes active and queued jobs, and late replies are harmless', () => {
    const { manager, ftp, clock } = setup()
    const results: unknown[] = []
    manager.getFile('a', (d) => results.push(v(d)))
    manager.getFile('b', (d) => results.push(v(d)))
    const stale = ftp.calls[0]!.cb as FtpCallback<Uint8Array>
    manager.clearLink()
    expect(results).toEqual([null, null])
    stale({ kind: 'done', value: bytes('late') })
    expect(results.length).toBe(2)
    expect(manager.isBusy()).toBe(false)
    clock.tick(10000)
    expect(results.length).toBe(2)
  })

  it('repeated link discovery preserves an active transfer; a changed link cancels it', () => {
    const { manager, instances, link } = setup()
    let result: unknown
    manager.getFile('a', (d) => (result = v(d)))
    manager.setLink({ ...link })
    expect(instances.length).toBe(1)
    expect(manager.isBusy()).toBe(true)
    manager.setLink({ connection: {}, systemId: 43, componentId: 1 })
    expect(result).toBeNull()
    expect(instances.length).toBe(2)
    expect(instances[1]!.targetSystem).toBe(43)
  })

  it('deduplication notifies canceled queued jobs and preserves the active one', () => {
    const { manager, ftp } = setup()
    const results: unknown[] = []
    manager.getFile('a', () => {})
    manager.getFile('fence', (d) => results.push(v(d)), { tag: 'fence' })
    manager.getFile('new-fence', () => {}, { tag: 'fence', dropQueuedTag: true })
    expect(results).toEqual([null])
    expect(manager.queuedCount()).toBe(1)
    ftp.complete(bytes('a'))
    expect(ftp.calls[1]!.path).toBe('new-fence')
  })

  it('requests without a discovered vehicle complete with failure', () => {
    const { manager } = setup()
    manager.setLink({ connection: {}, systemId: -1, componentId: -1 })
    let result: unknown
    manager.getFile('a', (d) => (result = v(d)))
    expect(result).toBeNull()
    expect(manager.isBusy()).toBe(false)
  })

  it('uploads share the queue with virtual-file downloads and wait for completion', () => {
    const { manager, ftp } = setup()
    const data = new Uint8Array([1, 2])
    const results: unknown[] = []
    manager.putFile('upload', data, (d) => results.push(v(d)))
    manager.getFile('params', (d) => results.push(v(d)), { sizeIsEstimate: true, fixedReadSize: true })
    expect(ftp.calls[0]!.data).toBe(data)
    expect(ftp.calls.length).toBe(1)
    ftp.complete(2)
    expect(ftp.calls[1]!.options?.sizeIsEstimate).toBe(true)
    expect(ftp.calls[1]!.options?.fixedReadSize).toBe(true)
    ftp.complete(data)
    expect(results).toEqual([2, data])
  })

  it('new links start FTP immediately without resetting another client or delaying the watchdog', () => {
    // Upstream's fake throws from resetSessions; the port's client port has no reset at all.
    const { manager, ftp, instances, clock } = setup()
    const results: unknown[] = []
    manager.getFile('waiting', (d) => results.push(v(d)), { timeoutMs: 1000 })
    expect(ftp.calls[0]!.path).toBe('waiting')
    clock.tick(1000)
    expect(results).toEqual([null])
    manager.setLink({ connection: {}, systemId: 43, componentId: 1 })
    const next = instances.at(-1)!
    manager.getFile('new-link', () => {})
    expect(next.calls[0]!.path).toBe('new-link')
  })
})
