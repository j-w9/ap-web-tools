// Proofs for the Telemetry Dashboard connection rows: a re-created menu's second connection (#68),
// the passphrase that stays active (#69), two connections feeding one parser (#158) and text
// WebSocket frames (#162). The original Menu.js / TelemetryDashboard.js run in node:vm with the
// original mavlink.js; sockets are fakes.
import { beforeAll, describe, expect, it } from 'vitest'
import {
  arrayBuffer,
  fire,
  FakeWebSocket,
  get,
  heartbeatFrame,
  loadDashboard,
  loadUpstreamMavlink,
  queriedChildren,
  type DashboardPage,
  type UpstreamMavlink,
  type UpstreamProcessor
} from './_harness.js'

let mav: UpstreamMavlink
beforeAll(async () => {
  mav = await loadUpstreamMavlink()
})

const MENU_FILES = ['Widgets/Base_Class.js', 'Widgets/Menu.js', 'TelemetryDashboard.js']

function socket(page: DashboardPage, i: number): FakeWebSocket {
  const ws = page.sockets[i]
  if (ws === undefined) throw new Error(`no socket ${String(i)}`)
  return ws
}

function processor(page: DashboardPage): UpstreamProcessor {
  return page.run('MAVLink') as UpstreamProcessor
}

describe('#68 a re-created menu widget opens a second connection and never closes the first', () => {
  it('destroying a menu leaves its socket open; the new menu Disconnect cannot close it', () => {
    const page = loadDashboard(MENU_FILES, {}, mav)
    // What clear_grid (TelemetryDashboard.js:401-403) and load_widgets do when a layout is reloaded.
    page.run('var m1 = new WidgetMenu({}); m1.init(); m1.destroy(); var m2 = new WidgetMenu({}); m2.init()')

    // Each init auto-connects (TelemetryDashboard.js:318); the server accepts both.
    expect(page.sockets.map((ws) => ws.url)).toEqual(['ws://127.0.0.1:56781', 'ws://127.0.0.1:56781'])
    socket(page, 0).accept()
    socket(page, 1).accept()
    expect(socket(page, 0).closeCalls).toBe(0) // destroy() did not close it

    // The user clicks Disconnect in the only menu left on the page.
    const disconnectButtons = queriedChildren(page.elements, 'input[id="disconnection_button"]')
    expect(disconnectButtons).toHaveLength(2)
    fire(disconnectButtons[1], 'onclick')
    expect(socket(page, 1).readyState).toBe(FakeWebSocket.CLOSED)
    expect(socket(page, 0).readyState).toBe(FakeWebSocket.OPEN)

    // Data still reaches every widget after the visible Disconnect.
    socket(page, 0).receive(arrayBuffer(heartbeatFrame(mav, 0)))
    expect(page.broadcasts.map((m) => m._name)).toEqual(['HEARTBEAT'])
  })

  it('with both sockets connected every message reaches the widgets twice', () => {
    const page = loadDashboard(MENU_FILES, {}, mav)
    page.run('var m1 = new WidgetMenu({}); m1.init(); m1.destroy(); var m2 = new WidgetMenu({}); m2.init()')
    socket(page, 0).accept()
    socket(page, 1).accept()
    // The server forwards the same vehicle stream to both clients.
    socket(page, 0).receive(arrayBuffer(heartbeatFrame(mav, 7)))
    socket(page, 1).receive(arrayBuffer(heartbeatFrame(mav, 7)))
    expect(page.broadcasts.map((m) => m._name)).toEqual(['HEARTBEAT', 'HEARTBEAT'])
  })
})

describe('#158 two open connections feed one MAVLink parser', () => {
  it('a frame split across two messages of one socket is lost when the other socket delivers in between', () => {
    const page = loadDashboard(MENU_FILES, {}, mav)
    page.run('var m1 = new WidgetMenu({}); m1.init(); m1.destroy(); var m2 = new WidgetMenu({}); m2.init()')
    socket(page, 0).accept()
    socket(page, 1).accept()
    const a = heartbeatFrame(mav, 1)
    const b = heartbeatFrame(mav, 2)
    socket(page, 0).receive(arrayBuffer(a.subarray(0, 10)))
    socket(page, 1).receive(arrayBuffer(b))
    socket(page, 0).receive(arrayBuffer(a.subarray(10)))
    const good = page.broadcasts.length
    expect(good).toBe(0)
    expect(get(processor(page), 'total_receive_errors')).toBeGreaterThan(0)
  })

  it('control: the same bytes in stream order on one socket give both frames', () => {
    const page = loadDashboard(MENU_FILES, {}, mav)
    page.run('var m = new WidgetMenu({}); m.init()')
    socket(page, 0).accept()
    const a = heartbeatFrame(mav, 1)
    const b = heartbeatFrame(mav, 2)
    socket(page, 0).receive(arrayBuffer(a.subarray(0, 10)))
    socket(page, 0).receive(arrayBuffer(a.subarray(10)))
    socket(page, 0).receive(arrayBuffer(b))
    expect(page.broadcasts.map((m) => m._name)).toEqual(['HEARTBEAT', 'HEARTBEAT'])
  })
})

function connectWith(page: DashboardPage, passphrase: string): FakeWebSocket {
  const [url] = queriedChildren(page.elements, 'input[id="target_url"]')
  const [key] = queriedChildren(page.elements, 'input[id="signing_key"]')
  const [connect] = queriedChildren(page.elements, 'input[id="connection_button"]')
  Reflect.set(url ?? {}, 'value', 'ws://vehicle:5760')
  Reflect.set(key ?? {}, 'value', passphrase)
  const before = page.sockets.length
  fire(connect, 'onclick')
  const ws = socket(page, before)
  ws.accept()
  return ws
}

describe('#69 a signing passphrase stays active for later connections', () => {
  it('after connecting with a passphrase, a connection with the field empty rejects unsigned frames', () => {
    const page = loadDashboard(['TelemetryDashboard.js'], {}, mav)
    page.run('setup_connect(document.createElement("svg"), () => {})')
    socket(page, 0).close() // the auto-connect attempt fails

    connectWith(page, 'secret')
    fire(queriedChildren(page.elements, 'input[id="disconnection_button"]')[0], 'onclick')

    const ws = connectWith(page, '')
    expect(processor(page).signing.sign_outgoing).toBe(false)
    expect(processor(page).signing.secret_key.length).toBe(32)
    ws.receive(arrayBuffer(heartbeatFrame(mav, 0)))
    expect(page.broadcasts).toEqual([])
  })

  it('control: the same empty-field connection on a fresh page accepts the frame', () => {
    const page = loadDashboard(['TelemetryDashboard.js'], {}, mav)
    page.run('setup_connect(document.createElement("svg"), () => {})')
    socket(page, 0).close()
    const ws = connectWith(page, '')
    ws.receive(arrayBuffer(heartbeatFrame(mav, 0)))
    expect(page.broadcasts.map((m) => m._name)).toEqual(['HEARTBEAT'])
  })
})

describe('#162 text WebSocket frames are fed to the parser as zero bytes', () => {
  it('a text frame "5" inside a partial frame corrupts it; "-1" throws', () => {
    const page = loadDashboard(['TelemetryDashboard.js'], {}, mav)
    page.run('setup_connect(document.createElement("svg"), () => {})')
    const ws = socket(page, 0)
    ws.accept()
    const a = heartbeatFrame(mav, 1)
    ws.receive(arrayBuffer(a.subarray(0, 10)))
    ws.receive('5')
    ws.receive(arrayBuffer(a.subarray(10)))
    expect(page.broadcasts).toEqual([])
    // What the handler's `new Uint8Array(msg.data)` (TelemetryDashboard.js:231) makes of the text.
    expect(page.run('Array.from(new Uint8Array("5"))')).toEqual([0, 0, 0, 0, 0])
    expect(() => {
      ws.receive('-1')
    }).toThrow('Invalid typed array length: -1')
  })
})
