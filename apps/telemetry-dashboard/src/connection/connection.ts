/**
 * WebSocket connection to a MAVLink forwarder (upstream `setup_connect` in TelemetryDashboard.js).
 *
 * The dashboard is read-only: it decodes every frame it receives and publishes each message to the
 * widgets, and optionally sends a 1 Hz GCS heartbeat (signed when a passphrase is given) to keep
 * the server forwarding. On start it tries Mission Planner's default address once; there is no
 * automatic reconnect.
 *
 * The controller keeps upstream's state variables (`ws`, `expecting_close`, `been_connected`,
 * `heartBeatTimer`) with their sharing semantics. One controller exists per menu widget, as one
 * `setup_connect` closure did, but all of them share the page's one {@link MavlinkProcessor}
 * (upstream's global `MAVLink`); see `docs/audit/telemetry-dashboard.md` for what that means when
 * the menu is re-created. Sockets, timers and the clock are injected for tests.
 */
import {
  ALL_MESSAGES,
  HEARTBEAT,
  MavAutopilot,
  MavlinkParser,
  MavlinkSigning,
  SIGNING_KEY_LENGTH,
  MavState,
  MavType,
  encodeFrame,
  signingKeyFromPassphrase,
  signingTimestamp
} from '@apwt/mavlink'
import { toLegacyMessage, type LegacyMessage } from '../mavlink/legacy-message.js'

/** Mission Planner's WebSocket MAVLink forwarder, tried automatically on start. */
export const MISSION_PLANNER_URL = 'ws://127.0.0.1:56781'

/** WebSocket `readyState` as a union. */
export type SocketState = 'connecting' | 'open' | 'closing' | 'closed'

/** Callbacks a socket reports to. */
export interface SocketHandlers {
  onOpen(): void
  onClose(): void
  onError(error: unknown): void
  onMessage(data: ArrayBuffer): void
}

/** The part of a WebSocket the controller uses. */
export interface SocketLike {
  readonly state: SocketState
  send(data: Uint8Array): void
  close(): void
}

export type SocketFactory = (url: string, handlers: SocketHandlers) => SocketLike

/** Timer functions, injectable for tests. */
export interface Timers {
  setInterval(callback: () => void, ms: number): number
  clearInterval(id: number | undefined): void
}

/** Colour of the menu's connect icon. */
export type ConnectionColor = 'black' | 'orange' | 'green' | 'red'

/** What the connection UI shows. */
export interface ConnectionView {
  readonly color: ConnectionColor
  /**
   * True while connecting or connected: the connect button and every setting are disabled
   * (upstream `set_inputs(true)`).
   */
  readonly inputsLocked: boolean
  /** The disconnect button: enabled by `set_inputs(true)` and again when a socket opens. */
  readonly disconnectEnabled: boolean
}

/**
 * The page's MAVLink state, upstream's one `MAVLink20Processor` (`MAVLink` global): the parser and
 * its partly received frame, the signing key and timestamps, the outgoing sequence number and
 * source ids. Every connection (one per menu widget) uses it.
 *
 * Until a passphrase is given the key is unset and every frame is accepted unchecked. While set,
 * unsigned frames are refused; a connection made without a passphrase clears it again (upstream
 * kept it, proven bug #69). The stream timestamps it has seen are kept when the key changes. The parser package takes its signing state at construction, so it is created with
 * a signing state whose key is filled in (and unsigned frames refused) when a passphrase arrives.
 */
export interface MavlinkProcessor {
  readonly parser: MavlinkParser
  readonly signing: MavlinkSigning
  /** Whether a key has been set (upstream: `signing.secret_key.length != 0`). */
  keySet: boolean
  signOutgoing: boolean
  sequence: number
  systemId: number
  componentId: number
}

export function createMavlinkProcessor(nowMs: number): MavlinkProcessor {
  const processor: { keySet: boolean } = { keySet: false }
  const signing = new MavlinkSigning({
    secretKey: new Uint8Array(SIGNING_KEY_LENGTH),
    // Started when the page loaded, as upstream's `MAVLinkSigning`.
    timestamp: signingTimestamp(nowMs),
    // Without a key upstream checked nothing; a frame signed with another key is let through too.
    allowUnsigned: () => !processor.keySet
  })
  return Object.assign(processor, {
    parser: new MavlinkParser({ messages: ALL_MESSAGES, signing }),
    signing,
    signOutgoing: false,
    sequence: 0,
    systemId: Number.NaN,
    componentId: Number.NaN
  })
}

/** Upstream: `MAVLink.signing.secret_key = sha256(passphrase)`. */
function setSigningKey(processor: MavlinkProcessor, passphrase: string): void {
  processor.signing.secretKey.set(signingKeyFromPassphrase(passphrase))
  processor.keySet = true
}

/** No key: nothing is verified, as on a fresh page (upstream: `secret_key.length == 0`). */
function clearSigningKey(processor: MavlinkProcessor): void {
  processor.signing.secretKey.fill(0)
  processor.keySet = false
}

/** Settings read from the connection form when upstream read them. */
export interface ConnectionSettings {
  readonly url: string
  readonly heartbeat: boolean
  /** Raw input values; parsed with `parseInt` as upstream did. */
  readonly systemId: string
  readonly componentId: string
  readonly passphrase: string
}

export interface ConnectionEvents {
  /** View changed. */
  view(view: ConnectionView): void
  /** A socket opened: upstream hid the connection popup and wrote the URL into the address input. */
  opened(url: string): void
  /** A decoded message for the widgets. */
  message(message: LegacyMessage): void
  /** The browser refused to create the socket (e.g. a malformed address from the page link). */
  failed(error: unknown): void
}

export interface ConnectionOptions {
  /** The page's MAVLink state, shared with every other connection. */
  readonly processor: MavlinkProcessor
  readonly createSocket: SocketFactory
  readonly timers: Timers
  readonly now: () => number
  /** Current form values. */
  readonly settings: () => ConnectionSettings
  readonly events: ConnectionEvents
}

interface Socket {
  readonly url: string
  readonly link: SocketLike
}

export class ConnectionController {
  private readonly options: ConnectionOptions
  private ws: Socket | null = null
  private expectingClose = false
  private beenConnected = false
  private heartbeatTimer: number | undefined = undefined
  private viewState: ConnectionView = { color: 'black', inputsLocked: false, disconnectEnabled: false }
  private readonly processor: MavlinkProcessor

  constructor(options: ConnectionOptions) {
    this.options = options
    this.processor = options.processor
  }

  get view(): ConnectionView {
    return this.viewState
  }

  /** Readiness of the current socket, if any. */
  get socketState(): SocketState | null {
    return this.ws?.link.state ?? null
  }

  private setView(view: Partial<ConnectionView>): void {
    this.viewState = { ...this.viewState, ...view }
    this.options.events.view(this.viewState)
  }

  /** Upstream `set_inputs`. */
  private setInputs(locked: boolean): void {
    this.setView({ inputsLocked: locked, disconnectEnabled: locked })
  }

  /** The automatic attempt made on start: the page link's address, else Mission Planner's. */
  autoConnect(url: string | null, passphrase: string | null): void {
    this.connect(url !== null && url !== '' ? url : MISSION_PLANNER_URL, passphrase, true)
  }

  /**
   * Connect button. Does nothing while a socket is connecting or closing; otherwise asks the form
   * whether the address is valid (`ws://` or `wss://`; the form shows the problem) and connects.
   */
  connectClicked(addressValid: () => boolean): 'busy' | 'invalid' | 'connecting' {
    const state = this.socketState
    if (state === 'connecting' || state === 'closing') return 'busy'
    if (!addressValid()) return 'invalid'
    const settings = this.options.settings()
    this.connect(settings.url, settings.passphrase.trim(), false)
    return 'connecting'
  }

  /** Disconnect button. */
  disconnectClicked(): void {
    if (this.socketState === 'closing') return
    this.disconnect()
  }

  /** Upstream `disconnect`. */
  disconnect(): void {
    if (this.ws !== null) {
      this.expectingClose = true
      this.ws.link.close()
    }
    this.setView({ color: 'black' })
    this.setInputs(false)
  }

  /**
   * The menu that owns this connection was removed: close its socket and stop its heartbeat.
   * Upstream never did, so a re-created menu left the old socket feeding the page (proven bugs #68
   * and #158, docs/bug-proofs/telemetry-dashboard.md).
   */
  dispose(): void {
    this.disconnect()
    this.options.timers.clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = undefined
  }

  private connect(url: string, passphrase: string | null, auto: boolean): void {
    this.disconnect()
    this.setInputs(true)
    this.setView({ color: 'orange' })
    this.beenConnected = false

    const settings = this.options.settings()
    const processor = this.processor
    processor.systemId = Number.parseInt(settings.systemId, 10)
    processor.componentId = Number.parseInt(settings.componentId, 10)

    processor.signOutgoing = false
    if (passphrase !== null && passphrase.length > 0) {
      setSigningKey(processor, passphrase)
      processor.signOutgoing = true
    } else {
      // Proven bug #69 (docs/bug-proofs/telemetry-dashboard.md): upstream kept the last key, so a
      // connection with the field empty ("Signing disabled") still refused unsigned frames.
      clearSigningKey(processor)
    }

    let link: SocketLike
    try {
      link = this.options.createSocket(url, {
        onOpen: () => this.handleOpen(url),
        onClose: () => this.handleClose(auto),
        // Upstream closed the shared `ws`, which is the newest socket, not necessarily this one.
        onError: () => this.ws?.link.close(),
        onMessage: (data) => this.handleData(data)
      })
    } catch (error) {
      // Upstream threw here (`new WebSocket` with a malformed address) and the page stopped.
      this.ws = null
      this.setView({ color: 'black' })
      this.setInputs(false)
      this.options.events.failed(error)
      return
    }
    this.ws = { url, link }
    this.expectingClose = false
  }

  private handleOpen(url: string): void {
    this.setView({ color: 'green', disconnectEnabled: true })
    this.options.events.opened(url)
    this.beenConnected = true
    if (this.options.settings().heartbeat) {
      this.heartbeatTimer = this.options.timers.setInterval(() => this.sendHeartbeat(), 1000)
    }
  }

  private handleClose(auto: boolean): void {
    if (auto && !this.beenConnected) {
      // A failed automatic attempt is not shown as an error.
      this.setView({ color: 'black' })
    } else if (!this.expectingClose) {
      this.setView({ color: 'red' })
    }
    this.options.timers.clearInterval(this.heartbeatTimer)
    this.setInputs(false)
  }

  private handleData(data: ArrayBuffer): void {
    for (const message of this.processor.parser.push(new Uint8Array(data))) {
      this.options.events.message(toLegacyMessage(message, this.options.now()))
    }
  }

  /** The heartbeat frame upstream sent: GCS, invalid autopilot, active. */
  heartbeatFrame(): Uint8Array {
    const fields = {
      type: MavType.MAV_TYPE_GCS,
      autopilot: MavAutopilot.MAV_AUTOPILOT_INVALID,
      baseMode: 0,
      customMode: 0,
      systemStatus: MavState.MAV_STATE_ACTIVE,
      mavlinkVersion: 3
    }
    const processor = this.processor
    const address = { systemId: processor.systemId, componentId: processor.componentId, sequence: processor.sequence }
    const frame = processor.signOutgoing
      ? encodeFrame(HEARTBEAT, fields, address, { signing: processor.signing })
      : encodeFrame(HEARTBEAT, fields, address)
    processor.sequence = (processor.sequence + 1) % 256
    return frame
  }

  private sendHeartbeat(): void {
    // Upstream sent on whichever socket is current, not necessarily the one that started the timer.
    this.ws?.link.send(this.heartbeatFrame())
  }
}

/** Socket factory over the browser's WebSocket. */
export function browserSocketFactory(url: string, handlers: SocketHandlers): SocketLike {
  const ws = new WebSocket(url)
  ws.binaryType = 'arraybuffer'
  ws.onopen = () => handlers.onOpen()
  ws.onclose = () => handlers.onClose()
  ws.onerror = (event) => {
    console.log(event)
    handlers.onError(event)
  }
  ws.onmessage = (event: MessageEvent<unknown>) => {
    if (event.data instanceof ArrayBuffer) handlers.onMessage(event.data)
    // A text frame: upstream fed `new Uint8Array(msg.data)` to the parser, a run of zeros as long
    // as the text's numeric value (none for non-numeric text; a negative value threw).
    else {
      const bytes: unknown = Reflect.construct(Uint8Array, [event.data])
      if (bytes instanceof Uint8Array) handlers.onMessage(new Uint8Array(bytes).buffer)
    }
  }
  const states: readonly SocketState[] = ['connecting', 'open', 'closing', 'closed']
  return {
    get state(): SocketState {
      return states[ws.readyState] ?? 'closed'
    },
    send: (data) => ws.send(data.slice()),
    close: () => ws.close()
  }
}

export const browserTimers: Timers = {
  setInterval: (callback, ms) => window.setInterval(callback, ms),
  clearInterval: (id) => window.clearInterval(id)
}
