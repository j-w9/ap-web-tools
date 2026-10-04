import { ATTITUDE, encodeFrame, MavlinkSigning, signingKeyFromPassphrase, signingTimestamp } from '@apwt/mavlink'
import { beforeAll, describe, expect, it } from 'vitest'
import { loadUpstreamMavlink, type UpstreamMavlink, type UpstreamProcessor } from '../test-support/upstream-mavlink.js'
import type { LegacyMessage } from '../mavlink/legacy-message.js'
import {
  browserSocketFactory,
  ConnectionController,
  createMavlinkProcessor,
  MISSION_PLANNER_URL,
  type MavlinkProcessor,
  type ConnectionSettings,
  type ConnectionView,
  type SocketHandlers,
  type SocketLike,
  type SocketState
} from './connection.js'

class FakeSocket implements SocketLike {
  state: SocketState = 'connecting'
  readonly sent: Uint8Array[] = []
  closeCalls = 0
  constructor(
    readonly url: string,
    readonly handlers: SocketHandlers
  ) {}
  send(data: Uint8Array): void {
    this.sent.push(data)
  }
  close(): void {
    this.closeCalls++
    this.state = 'closing'
  }
  /** Server side: accept the connection. */
  open(): void {
    this.state = 'open'
    this.handlers.onOpen()
  }
  /** The close event arriving (after `close()` or from the network). */
  closed(): void {
    this.state = 'closed'
    this.handlers.onClose()
  }
  receive(bytes: Uint8Array): void {
    this.handlers.onMessage(bytes.slice().buffer)
  }
}

function setup(initial: Partial<ConnectionSettings> = {}, shared?: MavlinkProcessor) {
  const sockets: FakeSocket[] = []
  const intervals = new Map<number, () => void>()
  let nextTimer = 1
  const views: ConnectionView[] = []
  const opened: string[] = []
  const messages: LegacyMessage[] = []
  const failures: unknown[] = []
  const settings: ConnectionSettings = {
    url: 'ws://127.0.0.1:5863',
    heartbeat: false,
    systemId: '254',
    componentId: '190',
    passphrase: '',
    ...initial
  }
  const state = { settings, now: Date.UTC(2026, 0, 1), refuse: false }
  const processor = shared ?? createMavlinkProcessor(state.now)
  const controller = new ConnectionController({
    processor,
    createSocket: (url, handlers) => {
      if (state.refuse) throw new SyntaxError(`The URL '${url}' is invalid.`)
      const socket = new FakeSocket(url, handlers)
      sockets.push(socket)
      return socket
    },
    timers: {
      setInterval: (callback) => {
        intervals.set(nextTimer, callback)
        return nextTimer++
      },
      clearInterval: (id) => {
        if (id !== undefined) intervals.delete(id)
      }
    },
    now: () => state.now,
    settings: () => state.settings,
    events: {
      view: (v) => views.push(v),
      opened: (url) => opened.push(url),
      message: (m) => messages.push(m),
      failed: (e) => failures.push(e)
    }
  })
  const tick = () => {
    for (const callback of [...intervals.values()]) callback()
  }
  return { controller, processor, sockets, intervals, views, opened, messages, failures, state, tick }
}

let upstream: UpstreamMavlink
beforeAll(async () => {
  upstream = await loadUpstreamMavlink()
})

/** Upstream's processor after `connect(target, 'secret')` then `connect(target, '')` (TelemetryDashboard.js:163-169). */
function upstreamAfterReconnectWithoutPassphrase(): UpstreamProcessor {
  const processor = new upstream.MAVLink20Processor(null, 255, 0)
  processor.signing.secret_key = new Uint8Array(upstream.mavlink20.sha256(new TextEncoder().encode('secret')))
  processor.signing.sign_outgoing = true
  // Second connect: only outgoing signing is switched off.
  processor.signing.sign_outgoing = false
  return processor
}

/** Names of the messages upstream's processor decodes from `frame`, errors swallowed as `ws.onmessage` did. */
function upstreamNames(processor: UpstreamProcessor, frame: Uint8Array): string[] {
  const names: string[] = []
  for (const c of frame) {
    try {
      const m = processor.parseChar(c)
      if (m !== null && m._id !== -1) names.push(m._name)
    } catch {
      // Upstream's parseChar throws for a refused frame.
    }
  }
  return names
}

describe('connection controller', () => {
  it('auto-connects to Mission Planner and stays black when that fails', () => {
    const t = setup()
    t.controller.autoConnect(null, null)
    expect(t.sockets[0]!.url).toBe(MISSION_PLANNER_URL)
    expect(t.controller.view).toEqual({ color: 'orange', inputsLocked: true, disconnectEnabled: true })
    t.sockets[0]!.closed()
    expect(t.controller.view).toEqual({ color: 'black', inputsLocked: false, disconnectEnabled: false })
  })

  it('auto-connects to the address from the page link', () => {
    const t = setup()
    t.controller.autoConnect('ws://10.0.0.2:5760', null)
    expect(t.sockets[0]!.url).toBe('ws://10.0.0.2:5760')
  })

  it('turns green on open and red when the link drops', () => {
    const t = setup()
    expect(t.controller.connectClicked(() => true)).toBe('connecting')
    t.sockets[0]!.open()
    expect(t.controller.view).toEqual({ color: 'green', inputsLocked: true, disconnectEnabled: true })
    expect(t.opened).toEqual(['ws://127.0.0.1:5863'])
    t.sockets[0]!.closed()
    expect(t.controller.view).toEqual({ color: 'red', inputsLocked: false, disconnectEnabled: false })
  })

  it('shows a dropped auto connection as red once it had been connected', () => {
    const t = setup()
    t.controller.autoConnect(null, null)
    t.sockets[0]!.open()
    t.sockets[0]!.closed()
    expect(t.controller.view.color).toBe('red')
  })

  it('stays black after a manual disconnect', () => {
    const t = setup()
    t.controller.connectClicked(() => true)
    t.sockets[0]!.open()
    t.controller.disconnectClicked()
    expect(t.sockets[0]!.closeCalls).toBe(1)
    expect(t.controller.view).toEqual({ color: 'black', inputsLocked: false, disconnectEnabled: false })
    t.sockets[0]!.closed()
    expect(t.controller.view.color).toBe('black')
  })

  it('ignores connect while a socket is connecting or closing, and disconnect while closing', () => {
    const t = setup()
    t.controller.connectClicked(() => true)
    expect(t.controller.connectClicked(() => true)).toBe('busy')
    expect(t.sockets).toHaveLength(1)
    t.controller.disconnectClicked()
    expect(t.controller.connectClicked(() => true)).toBe('busy')
    t.controller.disconnectClicked()
    expect(t.sockets[0]!.closeCalls).toBe(1)
  })

  it('does not connect to an invalid address', () => {
    const t = setup()
    expect(t.controller.connectClicked(() => false)).toBe('invalid')
    expect(t.sockets).toHaveLength(0)
  })

  it('closes the newest socket on a socket error', () => {
    const t = setup()
    t.controller.connectClicked(() => true)
    t.sockets[0]!.handlers.onError(new Event('error'))
    expect(t.sockets[0]!.closeCalls).toBe(1)
  })

  it('reports a socket the browser refuses to create', () => {
    const t = setup()
    t.state.refuse = true
    t.controller.autoConnect('not a url', null)
    expect(t.failures).toHaveLength(1)
    expect(t.controller.view).toEqual({ color: 'black', inputsLocked: false, disconnectEnabled: false })
  })

  it('publishes every decoded message in upstream shape with its receive time', () => {
    const t = setup()
    t.controller.connectClicked(() => true)
    t.sockets[0]!.open()
    const frame = encodeFrame(
      ATTITUDE,
      { timeBootMs: 1, roll: 0.5, pitch: 0, yaw: 0, rollspeed: 0, pitchspeed: 0, yawspeed: 0 },
      { systemId: 1, componentId: 1, sequence: 0 }
    )
    // Split across two chunks and preceded by noise, as a socket may deliver it.
    t.sockets[0]!.receive(Uint8Array.from([0, 1, ...frame.subarray(0, 5)]))
    expect(t.messages).toHaveLength(0)
    t.state.now = 42
    t.sockets[0]!.receive(frame.subarray(5))
    expect(t.messages).toHaveLength(1)
    expect(t.messages[0]!._name).toBe('ATTITUDE')
    expect(t.messages[0]!.roll).toBe(0.5)
    expect(t.messages[0]!._timeStamp).toBe(42)
  })

  it('sends the same 1 Hz heartbeat as upstream when enabled, numbering frames across connections', () => {
    const t = setup({ heartbeat: true })
    t.controller.connectClicked(() => true)
    t.sockets[0]!.open()
    expect(t.intervals.size).toBe(1)
    t.tick()
    t.tick()

    const processor = new upstream.MAVLink20Processor(null, 254, 190)
    const expected: number[][] = []
    for (let i = 0; i < 3; i++) {
      const m = upstream.mavlink20
      const msg = new m.messages.heartbeat!(m.MAV_TYPE_GCS, m.MAV_AUTOPILOT_INVALID, 0, 0, m.MAV_STATE_ACTIVE)
      expected.push(msg.pack(processor))
      processor.seq = (processor.seq + 1) % 256
    }
    expect(t.sockets[0]!.sent.map((f) => Array.from(f))).toEqual(expected.slice(0, 2))

    t.sockets[0]!.closed()
    expect(t.intervals.size).toBe(0)
    t.controller.connectClicked(() => true)
    t.sockets[1]!.open()
    t.tick()
    expect(Array.from(t.sockets[1]!.sent[0]!)).toEqual(expected[2])
  })

  it('does not send heartbeats when disabled', () => {
    const t = setup()
    t.controller.connectClicked(() => true)
    t.sockets[0]!.open()
    expect(t.intervals.size).toBe(0)
  })

  it('signs heartbeats with the passphrase key exactly as upstream', () => {
    const t = setup({ heartbeat: true, passphrase: '  secret ' })
    t.controller.connectClicked(() => true)
    t.sockets[0]!.open()
    t.tick()
    const processor = new upstream.MAVLink20Processor(null, 254, 190)
    processor.signing.secret_key = Uint8Array.from(upstream.mavlink20.sha256(new TextEncoder().encode('secret')))
    processor.signing.sign_outgoing = true
    processor.signing.timestamp = signingTimestamp(t.state.now)
    const m = upstream.mavlink20
    const msg = new m.messages.heartbeat!(m.MAV_TYPE_GCS, m.MAV_AUTOPILOT_INVALID, 0, 0, m.MAV_STATE_ACTIVE)
    expect(Array.from(t.sockets[0]!.sent[0]!)).toEqual(msg.pack(processor))
  })

  it('proven bug #69: reconnecting without a passphrase clears the key, so unsigned frames are accepted again', () => {
    const t = setup({ passphrase: 'secret' })
    t.controller.connectClicked(() => true)
    t.sockets[0]!.open()
    expect(t.processor.keySet).toBe(true)
    t.controller.disconnectClicked()
    t.sockets[0]!.closed()
    t.state.settings = { ...t.state.settings, passphrase: '' }
    t.controller.connectClicked(() => true)
    t.sockets[1]!.open()
    const fields = { timeBootMs: 1, roll: 0, pitch: 0, yaw: 0, rollspeed: 0, pitchspeed: 0, yawspeed: 0 }
    const unsigned = encodeFrame(ATTITUDE, fields, { systemId: 1, componentId: 1, sequence: 0 })

    // Upstream (the same steps on its one processor): the key stays set and the frame is refused.
    expect(upstreamNames(upstreamAfterReconnectWithoutPassphrase(), unsigned)).toEqual([])

    // Port: the key is cleared, as on a fresh page, which accepts the frame.
    expect(t.processor.keySet).toBe(false)
    expect(Array.from(t.processor.signing.secretKey)).toEqual(new Array<number>(32).fill(0))
    expect(t.processor.signOutgoing).toBe(false)
    t.sockets[1]!.receive(unsigned)
    expect(t.messages.map((m) => m._name)).toEqual(['ATTITUDE'])
    expect(upstreamNames(new upstream.MAVLink20Processor(null, 255, 0), unsigned)).toEqual(['ATTITUDE'])
  })

  it('re-enables only the disconnect button when a socket opens after an earlier one closed late (as upstream)', () => {
    const t = setup()
    t.controller.connectClicked(() => true)
    t.sockets[0]!.open()
    // A second connect closes the first socket and opens another; the first close arrives late.
    t.controller.connectClicked(() => true)
    t.sockets[0]!.closed()
    expect(t.controller.view).toEqual({ color: 'red', inputsLocked: false, disconnectEnabled: false })
    t.sockets[1]!.open()
    expect(t.controller.view).toEqual({ color: 'green', inputsLocked: false, disconnectEnabled: true })
  })
})

describe('the page-wide MAVLink processor (upstream global MAVLink)', () => {
  it('is shared by every connection: sequence numbers and the signing key carry over to a new menu', () => {
    const first = setup({ heartbeat: true, passphrase: 'secret' })
    first.controller.connectClicked(() => true)
    first.sockets[0]!.open()
    first.tick()
    const second = setup({ heartbeat: true }, first.processor)
    second.controller.connectClicked(() => true)
    second.sockets[0]!.open()
    second.tick()
    expect(first.processor.sequence).toBe(2)
    expect(second.sockets[0]!.sent[0]![4]).toBe(1)
    // Proven bug #69: upstream kept the first menu's key and refused unsigned frames on the new
    // menu's connection made without a passphrase; the port clears the key and accepts them.
    const fields = { timeBootMs: 1, roll: 0, pitch: 0, yaw: 0, rollspeed: 0, pitchspeed: 0, yawspeed: 0 }
    const unsigned = encodeFrame(ATTITUDE, fields, { systemId: 1, componentId: 1, sequence: 0 })
    expect(upstreamNames(upstreamAfterReconnectWithoutPassphrase(), unsigned)).toEqual([])
    second.sockets[0]!.receive(unsigned)
    expect(second.messages.map((m) => m._name)).toEqual(['ATTITUDE'])
  })

  it('accepts signed frames unchecked until a key is set, as upstream', () => {
    const t = setup()
    t.controller.connectClicked(() => true)
    t.sockets[0]!.open()
    const fields = { timeBootMs: 1, roll: 0, pitch: 0, yaw: 0, rollspeed: 0, pitchspeed: 0, yawspeed: 0 }
    const signing = new MavlinkSigning({ secretKey: signingKeyFromPassphrase('other'), timestamp: 5 })
    const frame = encodeFrame(ATTITUDE, fields, { systemId: 1, componentId: 1, sequence: 0 }, { signing })
    t.sockets[0]!.receive(frame)
    const theirs = new upstream.MAVLink20Processor(null, 255, 0)
    const decoded = Array.from(frame, (c) => theirs.parseChar(c)).filter((m) => m !== null && m._id !== -1)
    expect(t.messages.map((m) => [m._name, m._signed])).toEqual(decoded.map((m) => [m!._name, m!['_signed']]))
  })

  it('proven bugs #68/#158: a removed menu closes its connection, so the new menu Disconnect stops all data', () => {
    // Upstream's destroy left the old socket open (proofs/telemetry-dashboard "#68 …"); the port's
    // menu destroy calls dispose.
    const old = setup({ heartbeat: true })
    old.controller.autoConnect(null, null)
    old.sockets[0]!.open()
    expect(old.intervals.size).toBe(1)
    old.controller.dispose()
    expect(old.sockets[0]!.closeCalls).toBe(1)
    expect(old.intervals.size).toBe(0)
    old.sockets[0]!.closed()
    expect(old.controller.view.color).toBe('black')

    const recreated = setup({}, old.processor)
    recreated.controller.autoConnect(null, null)
    recreated.sockets[0]!.open()
    recreated.controller.disconnectClicked()
    expect(recreated.sockets[0]!.closeCalls).toBe(1)
    expect([old.sockets[0]!.state, recreated.sockets[0]!.state]).toEqual(['closed', 'closing'])
  })

  it('feeds bytes from two open connections into one parser, so interleaved frames corrupt (port resyncs, #150)', () => {
    const a = setup()
    const b = setup({}, a.processor)
    a.controller.connectClicked(() => true)
    a.sockets[0]!.open()
    b.controller.connectClicked(() => true)
    b.sockets[0]!.open()
    const fields = { timeBootMs: 1, roll: 0.25, pitch: 0, yaw: 0, rollspeed: 0, pitchspeed: 0, yawspeed: 0 }
    const f1 = encodeFrame(ATTITUDE, fields, { systemId: 1, componentId: 1, sequence: 0 })
    const f2 = encodeFrame(ATTITUDE, fields, { systemId: 2, componentId: 1, sequence: 0 })
    const chunks: [FakeSocket, Uint8Array][] = [
      [a.sockets[0]!, f1.subarray(0, 12)],
      [b.sockets[0]!, f2],
      [a.sockets[0]!, f1.subarray(12)],
      [b.sockets[0]!, f2]
    ]
    const theirs = new upstream.MAVLink20Processor(null, 255, 0)
    const expected: string[] = []
    for (const [socket, chunk] of chunks) {
      socket.receive(chunk)
      for (const c of chunk) {
        let m: ReturnType<typeof theirs.parseChar> = null
        try {
          m = theirs.parseChar(c)
        } catch {
          m = null
        }
        if (m !== null && m._id !== -1) expected.push(`${m._name}:${String((m['_header'] as { srcSystem: number }).srcSystem)}`)
      }
    }
    const ours = [...a.messages, ...b.messages].map((m) => `${m._name}:${m._header.srcSystem}`)
    // Three complete frames were sent; the interleaving loses some of them. Upstream drops the whole
    // length the broken frame claims, losing the second f2 inside it; the port drops only the start
    // marker after the checksum fails and finds that f2 (proven bug #150, docs/bug-proofs/mavlink.md).
    expect(expected).toEqual(['ATTITUDE:2'])
    expect(ours).toEqual(['ATTITUDE:2', 'ATTITUDE:2'])
  })
})

describe('browser socket', () => {
  it('feeds a text frame to the parser as upstream did: new Uint8Array(text)', () => {
    const received: number[] = []
    class FakeWebSocket {
      static instance: FakeWebSocket | undefined
      binaryType = ''
      readyState = 0
      onopen: (() => void) | null = null
      onclose: (() => void) | null = null
      onerror: ((e: unknown) => void) | null = null
      onmessage: ((e: { data: unknown }) => void) | null = null
      constructor() {
        FakeWebSocket.instance = this
      }
      send(): void {}
      close(): void {}
    }
    const original = Reflect.get(globalThis, 'WebSocket')
    Reflect.set(globalThis, 'WebSocket', FakeWebSocket)
    try {
      browserSocketFactory('ws://x', {
        onOpen: () => undefined,
        onClose: () => undefined,
        onError: () => undefined,
        onMessage: (data) => received.push(data.byteLength)
      })
      const ws = FakeWebSocket.instance!
      ws.onmessage!({ data: '3' })
      ws.onmessage!({ data: 'text' })
      ws.onmessage!({ data: new Uint8Array(2).buffer })
      expect(received).toEqual([3, 0, 2])
      expect(() => ws.onmessage!({ data: '-1' })).toThrow(RangeError)
    } finally {
      Reflect.set(globalThis, 'WebSocket', original)
    }
  })
})
