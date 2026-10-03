import { ATTITUDE, encodeFrame, MavlinkSigning, signingKeyFromPassphrase, signingTimestamp } from '@apwt/mavlink'
import { beforeAll, describe, expect, it } from 'vitest'
import { loadUpstreamMavlink, type UpstreamMavlink } from '../test-support/upstream-mavlink.js'
import type { LegacyMessage } from '../mavlink/legacy-message.js'
import {
  ConnectionController,
  MISSION_PLANNER_URL,
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

function setup(initial: Partial<ConnectionSettings> = {}) {
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
  const controller = new ConnectionController({
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
  return { controller, sockets, intervals, views, opened, messages, failures, state, tick }
}

let upstream: UpstreamMavlink
beforeAll(async () => {
  upstream = await loadUpstreamMavlink()
})

describe('connection controller', () => {
  it('auto-connects to Mission Planner and stays black when that fails', () => {
    const t = setup()
    t.controller.autoConnect(null, null)
    expect(t.sockets[0]!.url).toBe(MISSION_PLANNER_URL)
    expect(t.controller.view).toEqual({ color: 'orange', inputsLocked: true })
    t.sockets[0]!.closed()
    expect(t.controller.view).toEqual({ color: 'black', inputsLocked: false })
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
    expect(t.controller.view).toEqual({ color: 'green', inputsLocked: true })
    expect(t.opened).toEqual(['ws://127.0.0.1:5863'])
    t.sockets[0]!.closed()
    expect(t.controller.view).toEqual({ color: 'red', inputsLocked: false })
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
    expect(t.controller.view).toEqual({ color: 'black', inputsLocked: false })
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
    expect(t.controller.view).toEqual({ color: 'black', inputsLocked: false })
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

  it('keeps verifying with the last key after reconnecting without a passphrase (upstream keeps it)', () => {
    const t = setup({ passphrase: 'secret' })
    t.controller.connectClicked(() => true)
    t.sockets[0]!.open()
    t.controller.disconnectClicked()
    t.sockets[0]!.closed()
    t.state.settings = { ...t.state.settings, passphrase: '' }
    t.controller.connectClicked(() => true)
    t.sockets[1]!.open()
    const fields = { timeBootMs: 1, roll: 0, pitch: 0, yaw: 0, rollspeed: 0, pitchspeed: 0, yawspeed: 0 }
    t.sockets[1]!.receive(encodeFrame(ATTITUDE, fields, { systemId: 1, componentId: 1, sequence: 0 }))
    expect(t.messages).toHaveLength(0)
    const signing = new MavlinkSigning({
      secretKey: signingKeyFromPassphrase('secret'),
      timestamp: signingTimestamp(t.state.now) + 10
    })
    t.sockets[1]!.receive(encodeFrame(ATTITUDE, fields, { systemId: 1, componentId: 1, sequence: 1 }, { signing }))
    expect(t.messages).toHaveLength(1)
    expect(t.messages[0]!._signed).toBe(true)
  })
})
