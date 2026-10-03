/**
 * The ground station without its DOM (upstream `SimpleGCS/app.js` with the state parts of
 * `map.js`): connection lifecycle and reconnects, signing, GCS heartbeat, link health, vehicle
 * discovery, telemetry, commands with ACK tracking, MAVFTP, fence and mission downloads and the
 * parameter client. The UI renders `snapshot` and calls the methods.
 *
 * Port notes: upstream writes results straight into DOM elements and Leaflet layers; here each of
 * those writes updates a field of an immutable snapshot at the same point in the control flow, so
 * the same sequence of states is observable. Sockets, storage, locks, clock and randomness are
 * injected.
 */
import {
  ALL_MESSAGES,
  COMMAND_INT,
  FILE_TRANSFER_PROTOCOL,
  HEARTBEAT,
  MavAutopilot,
  MavFrame,
  MavModeFlag,
  MavResult,
  MavSeverity,
  MavSysStatusSensor,
  MavlinkEncoder,
  MavlinkParser,
  MavlinkSigning,
  SIGNING_EPOCH_MS,
  signingKeyFromPassphrase,
  type ReceivedMessage
} from '@apwt/mavlink'
import { NO_TIMER, type Clock, type Timer } from './clock.js'
import type { AppSettingsStore } from './app-settings.js'
import type { SimpleGcsConfig } from './config.js'
import { CommandAcks, type CommandOutcome } from './commands/acks.js'
import {
  fenceEnableCommand,
  jspackInt32,
  mavCmdName,
  mavResultName,
  repositionCommand,
  setModeCommand,
  type CommandRequest,
  type ModeButton
} from './commands/commands.js'
import { MavFtpClient, type FtpLink } from './ftp/client.js'
import { FtpManager } from './ftp/manager.js'
import { ComponentLeases, type LockRequester } from './link/leases.js'
import {
  initialDraft,
  readConnectionSettings,
  saveConnectionSettings,
  STORAGE_KEYS,
  validateConnectionUrl,
  type ConnectionDraft,
  type ConnectionSettings
} from './link/settings.js'
import type { LinkSocket, SocketFactory } from './link/socket.js'
import type { KeyValueStore } from './link/storage.js'
import { FileFetcher } from './mission/file-fetcher.js'
import {
  missionPoints,
  parseFence,
  parseMissionItems,
  type FenceItem,
  type MissionItem,
  type MissionPoint
} from './mission/mission-file.js'
import { MavParam } from './params/model.js'
import { paramVehicle, type ParamVehicle } from './params/packed.js'
import { pushStatus, type StatusEntry } from './vehicle/status-log.js'
import { classifyVehicle, isRoverish, MCCMNC_MAP, modeName, type VehicleClass } from './vehicle/vehicle.js'

/** Colour state of the Connect button (upstream `setConnState` and the link monitor). */
export type ConnectTone = 'none' | 'connecting' | 'connected' | 'error'

export interface Telemetry {
  readonly batteryPct: number | null
  readonly currentA: number | null
  /** Ground speed, m/s. */
  readonly speed: number | null
  readonly lastUpdate: number
  readonly armed: boolean | null
  readonly modeName: string
  readonly numSats: number | null
}

const NO_TELEMETRY: Telemetry = {
  batteryPct: null,
  currentA: null,
  speed: null,
  lastUpdate: 0,
  armed: null,
  modeName: '—',
  numSats: null
}

/** The vehicle marker: position, icon family from the last position update, heading in degrees. */
export interface VehicleMarker {
  readonly lat: number
  readonly lon: number
  readonly vehicleClass: VehicleClass
  readonly headingDeg: number
}

export interface Position {
  readonly lat: number
  readonly lon: number
}

export interface Toast {
  readonly id: number
  readonly text: string
}

/** The selected vehicle and the parameter client created for it. */
export interface Vehicle {
  readonly systemId: number
  readonly componentId: number
  readonly params: MavParam
  readonly paramVehicle: ParamVehicle
}

export interface SessionSnapshot {
  /** `#link-status` text: Disconnected, Waiting for vehicle, Telemetry stale or Live. */
  readonly linkStatus: string
  readonly stale: boolean
  readonly connectTone: ConnectTone
  /** Connect button label, e.g. "Connect (5s)" while telemetry is late. */
  readonly connectLabel: string
  /** True while the startup component-id reservation runs (Connect disabled). */
  readonly starting: boolean
  readonly dialogOpen: boolean
  /** True while a submitted Connect is reserving an id (dialog Connect disabled). */
  readonly submitting: boolean
  readonly draft: ConnectionDraft
  readonly vehicle: Vehicle | null
  /**
   * Incremented whenever the parameter client is replaced or cleared (upstream
   * `parameterUI.setClient`), which happens on every disconnect, including the one each connect
   * starts with.
   */
  readonly paramEpoch: number
  readonly telemetry: Telemetry
  readonly lteCarrier: string
  readonly lteRsrp: string
  readonly marker: VehicleMarker | null
  /** Incremented when the map must centre on the marker at zoom 16 (first position of a new vehicle). */
  readonly centerRequest: number
  readonly target: Position | null
  readonly fences: readonly FenceItem[]
  readonly fenceEnabled: boolean
  readonly mission: readonly MissionPoint[]
  readonly statusLog: readonly StatusEntry[]
  readonly toasts: readonly Toast[]
}

export interface SessionDeps {
  readonly clock: Clock
  readonly openSocket: SocketFactory
  readonly local: KeyValueStore
  readonly session: KeyValueStore
  readonly locks: LockRequester | undefined
  readonly randomUint32: () => number
  readonly config: SimpleGcsConfig
  readonly settings: AppSettingsStore
}

/** Result of pressing Connect in the dialog. */
export type SubmitResult =
  | { readonly kind: 'connected' }
  /** Superseded by a newer Connect or a Disconnect. */
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed'; readonly message: string }

/** Per-connection MAVLink state: one encoder and parser over the socket. */
interface Link {
  readonly socket: LinkSocket
  readonly settings: ConnectionSettings
  readonly encoder: MavlinkEncoder
  readonly parser: MavlinkParser
}

type AckResult = string

export class GcsSession {
  private snap: SessionSnapshot
  private readonly listeners = new Set<() => void>()
  private readonly clock: Clock
  readonly ftp: FtpManager
  private readonly acks: CommandAcks<AckResult>
  private readonly leases: ComponentLeases
  private readonly fenceFetcher: FileFetcher<FenceItem[], readonly FenceItem[]>
  private readonly missionFetcher: FileFetcher<MissionItem[], readonly MissionPoint[]>

  private link: Link | null = null
  private gcsSystemId = 255
  private gcsComponentId = 190
  private mavType: number | null = null
  private vehicleClass: VehicleClass = 'plane'
  private lastHeadingDeg: number | null = null
  private movedOnce = false
  private targetSeenMs = 0
  /** NAMED_VALUE_FLOAT values by source system, as upstream's per-system message dictionary. */
  private namedValues = new Map<number, Map<string, number>>()

  private heartbeatTimer: Timer = NO_TIMER
  private reconnectTimer: Timer | null = null
  private reconnectAttempts = 0
  private intentionalDisconnect = false
  private lastConnectionSettings: ConnectionSettings | null = null
  private mapVehicleIdentity: string | null = null
  private lastRxMs = 0
  private healthTimer: Timer | null = null
  private connectionAttempt = 0
  /** MAVLink sequence, continuous across connections like upstream's single processor. */
  private sequence = 0
  /** Signing state per endpoint and key, keeping replay watermarks for the page's lifetime. */
  private readonly signingStreams = new Map<string, MavlinkSigning>()
  private toastId = 0
  private readonly intervals: Timer[] = []

  constructor(private readonly deps: SessionDeps) {
    this.clock = deps.clock
    this.ftp = new FtpManager(() => this.createFtpClient(), deps.clock)
    this.acks = new CommandAcks<AckResult>({ clock: deps.clock, report: (command, outcome) => this.reportAck(command, outcome) })
    this.leases = new ComponentLeases(deps.locks)
    const toast = (text: string): void => this.toast(text)
    this.fenceFetcher = new FileFetcher({
      path: '@MISSION/fence.dat',
      tag: 'fence',
      ftp: this.ftp,
      clock: deps.clock,
      toast,
      autoFetch: () => deps.settings.current.autoFetchFence,
      parse: parseFence,
      present: (fences, silent) => {
        if (!silent) toast(`Loaded ${fences.length} fence items`)
        return fences
      },
      empty: [],
      messages: {
        fetching: 'Fetching fence…',
        failed: 'Failed to fetch fence',
        parseFailed: 'Failed to parse fence',
        parseError: 'Fence parse error'
      }
    })
    this.missionFetcher = new FileFetcher({
      path: '@MISSION/mission.dat',
      tag: 'mission',
      ftp: this.ftp,
      clock: deps.clock,
      toast,
      autoFetch: () => deps.settings.current.autoFetchMission,
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
    this.fenceFetcher.subscribe(() => this.set({ fences: this.fenceFetcher.overlay }))
    this.missionFetcher.subscribe(() => this.set({ mission: this.missionFetcher.overlay }))
    this.snap = {
      linkStatus: 'Disconnected',
      stale: true,
      connectTone: 'none',
      connectLabel: 'Connect',
      starting: false,
      dialogOpen: false,
      submitting: false,
      draft: initialDraft(deps),
      vehicle: null,
      paramEpoch: 0,
      telemetry: NO_TELEMETRY,
      lteCarrier: '—',
      lteRsrp: '— dBm',
      marker: null,
      centerRequest: 0,
      target: null,
      fences: [],
      fenceEnabled: true,
      mission: [],
      statusLog: [],
      toasts: []
    }
  }

  // ---------------------------------------------------------------- snapshot plumbing

  get snapshot(): SessionSnapshot {
    return this.snap
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): SessionSnapshot => this.snap

  private set(patch: Partial<SessionSnapshot>): void {
    this.snap = { ...this.snap, ...patch }
    for (const listener of this.listeners) listener()
  }

  /** Shows a transient message for `ms` milliseconds (upstream `GCSUtils.toast`). */
  toast(text: string, ms = 1500): void {
    const toast: Toast = { id: ++this.toastId, text }
    this.set({ toasts: [...this.snap.toasts, toast] })
    this.clock.after(ms, () => this.set({ toasts: this.snap.toasts.filter((t) => t !== toast) }))
  }

  // ---------------------------------------------------------------- startup

  /**
   * Upstream's startup: reserve the editor's component id, then reconnect only to an explicitly
   * saved endpoint. Also starts the 1 Hz LTE refresh and target cleanup timers.
   */
  async start(): Promise<void> {
    this.intervals.push(this.clock.every(1000, () => this.updateTargetTimeout()))
    this.set({ starting: true })
    const attempt = ++this.connectionAttempt
    try {
      const componentId = await this.leases.claim(Number(this.snap.draft.componentId), () => attempt === this.connectionAttempt)
      if (componentId === null || attempt !== this.connectionAttempt) return
      this.editDraft({ componentId: String(componentId) })
      if (this.deps.local.get(STORAGE_KEYS.url)) this.connect(readConnectionSettings(this.snap.draft))
    } catch (error) {
      if (attempt === this.connectionAttempt) this.toast(errorText(error))
    } finally {
      this.set({ starting: false })
      this.intervals.push(this.clock.every(1000, () => this.updateLte()))
    }
  }

  /** Stops timers and the connection (page teardown). */
  dispose(): void {
    for (const timer of this.intervals) timer.cancel()
    this.intervals.length = 0
    this.disconnect(false)
    this.intentionalDisconnect = true
  }

  // ---------------------------------------------------------------- connection dialog

  openDialog(): void {
    this.set({ dialogOpen: true })
  }

  closeDialog(): void {
    this.set({ dialogOpen: false })
  }

  editDraft(patch: Partial<ConnectionDraft>): void {
    this.set({ draft: { ...this.snap.draft, ...patch } })
  }

  /** The dialog's Connect: validate, reserve an id, connect, then persist and close the dialog. */
  async submit(): Promise<SubmitResult> {
    const settings = readConnectionSettings(this.snap.draft)
    const attempt = ++this.connectionAttempt
    const current = (): boolean => attempt === this.connectionAttempt
    this.set({ submitting: true })
    try {
      validateConnectionUrl(settings.url)
      const componentId = await this.leases.claim(settings.componentId, current)
      if (componentId === null || !current()) return { kind: 'cancelled' }
      this.editDraft({ componentId: String(componentId) })
      const claimed: ConnectionSettings = { ...settings, componentId }
      if (!this.connect(claimed)) return { kind: 'failed', message: 'Cannot open connection' }
      saveConnectionSettings(claimed, this.deps.local, this.deps.session)
      this.closeDialog()
      return { kind: 'connected' }
    } catch (error) {
      if (current()) this.toast(errorText(error))
      return { kind: 'failed', message: errorText(error) }
    } finally {
      if (current()) this.set({ submitting: false })
    }
  }

  /** The dialog's Disconnect. */
  requestDisconnect(): void {
    this.disconnect(true)
  }

  // ---------------------------------------------------------------- connection lifecycle

  private setConnState(tone: ConnectTone): void {
    this.set({ connectTone: tone })
  }

  private setTelemetryStatus(text: string, stale: boolean): void {
    this.set({ linkStatus: text, stale })
  }

  private signingFor(settings: ConnectionSettings): MavlinkSigning | undefined {
    const pass = settings.passphrase
    const nowTimestamp = Math.floor((this.clock.now() - SIGNING_EPOCH_MS) * 100)
    // Upstream keeps one signing timestamp for the page and moves it up to now on each connect.
    let pageTimestamp = nowTimestamp
    for (const s of this.signingStreams.values()) pageTimestamp = Math.max(pageTimestamp, s.timestamp)
    if (!pass) return undefined
    const key = signingKeyFromPassphrase(pass)
    const context = settings.url + ':' + Array.from(key).join(',')
    let signing = this.signingStreams.get(context)
    if (signing === undefined) {
      signing = new MavlinkSigning({ secretKey: key, timestamp: pageTimestamp })
      this.signingStreams.set(context, signing)
    }
    signing.timestamp = pageTimestamp
    return signing
  }

  /** Opens a socket with `settings`. False (and no retry) when the URL or constructor fails. */
  private connect(settings: ConnectionSettings): boolean {
    let socket: LinkSocket
    try {
      validateConnectionUrl(settings.url)
      socket = this.deps.openSocket(settings.url, {
        open: () => this.onOpen(socket),
        error: () => {
          if (this.link?.socket === socket) this.setConnState('error')
        },
        close: () => {
          if (this.link?.socket !== socket) return
          this.disconnect(false)
          this.setConnState('error')
          this.scheduleReconnect()
        },
        message: (data) => {
          if (this.link?.socket === socket) this.handleBytes(data)
        }
      })
    } catch (error) {
      this.disconnect(false)
      this.setConnState('error')
      this.toast(`Cannot open connection: ${errorText(error)}`)
      return false
    }
    this.disconnect(false)
    this.gcsSystemId = settings.systemId
    this.gcsComponentId = settings.componentId
    this.lastConnectionSettings = settings
    this.intentionalDisconnect = false
    const signing = this.signingFor(settings)
    const encoder = new MavlinkEncoder(
      signing === undefined
        ? { systemId: settings.systemId, componentId: settings.componentId, sequence: this.sequence }
        : { systemId: settings.systemId, componentId: settings.componentId, sequence: this.sequence, signing }
    )
    const parser = new MavlinkParser(signing === undefined ? { messages: ALL_MESSAGES } : { messages: ALL_MESSAGES, signing })
    this.setConnState('connecting')
    this.link = { socket, settings, encoder, parser }
    return true
  }

  private onOpen(socket: LinkSocket): void {
    const link = this.link
    if (link?.socket !== socket) return
    this.setConnState('connecting')
    this.setTelemetryStatus('Waiting for vehicle', true)
    this.reconnectTimer?.cancel()
    this.reconnectTimer = null
    this.startHeartbeatLoop(link)
    this.lastRxMs = this.clock.now()
    this.startLinkHealthMonitor()
    this.toast('Connected')
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null || this.intentionalDisconnect) return
    this.reconnectAttempts++
    const delay = Math.min(30000, 2000 * 2 ** Math.min(this.reconnectAttempts - 1, 4))
    this.reconnectTimer = this.clock.after(delay, () => {
      this.reconnectTimer = null
      if (!this.intentionalDisconnect && this.lastConnectionSettings !== null) this.connect(this.lastConnectionSettings)
    })
  }

  private disconnect(intentional: boolean, closeCode = 1000, closeReason = ''): void {
    this.intentionalDisconnect = intentional
    this.reconnectTimer?.cancel()
    this.reconnectTimer = null
    if (intentional) {
      this.connectionAttempt++
      this.set({ submitting: false })
      this.reconnectAttempts = 0
      this.lastConnectionSettings = null
      this.mapVehicleIdentity = null
    }
    const old = this.link
    this.link = null
    if (old !== null) {
      this.sequence = old.encoder.sequence
      old.socket.detach()
      try {
        old.socket.close(closeCode, closeReason)
      } catch {
        /* Already closed. */
      }
    }
    const params = this.snap.vehicle?.params
    this.resetVehicleData()
    this.fenceFetcher.onDisconnected()
    this.set({ fenceEnabled: true })
    this.missionFetcher.onDisconnected()
    this.ftp.clearLink()
    params?.disconnect()
    this.set({ paramEpoch: this.snap.paramEpoch + 1 })
    this.stopLinkHealthMonitor()
    this.heartbeatTimer.cancel()
    this.heartbeatTimer = NO_TIMER
    if (intentional) {
      this.setConnState('none')
      this.toast('Disconnected')
    }
    this.clearTarget()
  }

  private resetVehicleData(): void {
    this.acks.clear()
    this.namedValues = new Map()
    this.mavType = null
    this.vehicleClass = 'plane'
    this.lastHeadingDeg = null
    this.set({ vehicle: null, telemetry: NO_TELEMETRY, marker: null, lteCarrier: '—', lteRsrp: '— dBm' })
    this.clearTarget()
    this.setTelemetryStatus('Disconnected', true)
  }

  private startHeartbeatLoop(link: Link): void {
    this.heartbeatTimer.cancel()
    this.heartbeatTimer = NO_TIMER
    if (!link.settings.sendHeartbeat) return
    this.heartbeatTimer = this.clock.every(1000, () => {
      try {
        // Upstream packs before checking the socket, which advances the signing timestamp even
        // when nothing is sent. Its heartbeat constructor fixes mavlink_version at 3.
        const sequence = link.encoder.sequence
        const frame = link.encoder.encode(HEARTBEAT, {
          type: 6,
          autopilot: 8,
          baseMode: 0,
          customMode: 0,
          systemStatus: 4,
          mavlinkVersion: 3
        })
        if (this.link !== link || !link.socket.isOpen) {
          link.encoder.sequence = sequence
          return
        }
        link.socket.send(frame)
      } catch {
        this.heartbeatTimer.cancel()
        this.heartbeatTimer = NO_TIMER
        this.setConnState('error')
        this.toast('Heartbeat stopped after error')
      }
    })
  }

  private startLinkHealthMonitor(): void {
    if (this.healthTimer !== null) return
    this.healthTimer = this.clock.every(500, () => {
      if (this.link === null || !this.link.socket.isOpen) {
        this.set({ connectTone: 'none', connectLabel: 'Connect' })
        return
      }
      const now = this.clock.now()
      const lagMs = now - (this.lastRxMs || now)
      // No MAVLink from the vehicle for >15 s: force a reconnect. A dead peer can leave close()
      // waiting for a 60-second handshake, so detach and reconnect immediately.
      if (lagMs > 15000) {
        this.disconnect(false, 4000, 'link stall')
        this.setConnState('error')
        this.scheduleReconnect()
        return
      }
      if (lagMs > 3000) {
        this.setTelemetryStatus(this.snap.vehicle === null ? 'Waiting for vehicle' : 'Telemetry stale', true)
        this.set({ connectTone: 'error', connectLabel: `Connect (${Math.round(lagMs / 1000)}s)` })
      } else if (this.snap.vehicle !== null) {
        this.setTelemetryStatus('Live', false)
        this.set({ connectTone: 'connected', connectLabel: 'Connect' })
      }
    })
  }

  private stopLinkHealthMonitor(): void {
    this.healthTimer?.cancel()
    this.healthTimer = null
    this.set({ connectTone: 'none', connectLabel: 'Connect' })
  }

  // ---------------------------------------------------------------- FTP plumbing

  private createFtpClient(): MavFtpClient {
    const link = this.link
    const ftpLink: FtpLink = {
      sourceSystem: link?.settings.systemId ?? this.gcsSystemId,
      sourceComponent: link?.settings.componentId ?? this.gcsComponentId,
      send: (payload, targetSystem, targetComponent) => {
        if (link === null) throw new Error('Disconnected')
        const frame = link.encoder.encode(FILE_TRANSFER_PROTOCOL, { targetNetwork: 0, targetSystem, targetComponent, payload })
        link.socket.send(frame)
      }
    }
    return new MavFtpClient(ftpLink, this.clock)
  }

  // ---------------------------------------------------------------- receiving

  private handleBytes(bytes: Uint8Array): void {
    const link = this.link
    if (link === null) return
    for (const m of link.parser.push(bytes)) {
      if (this.link !== link) return
      if (m.name === 'NAMED_VALUE_FLOAT') {
        let values = this.namedValues.get(m.header.systemId)
        if (values === undefined) {
          values = new Map()
          this.namedValues.set(m.header.systemId, values)
        }
        values.set(m.fields.name.replace(/\0+$/, ''), m.fields.value)
      } else if (!this.namedValues.has(m.header.systemId)) {
        this.namedValues.set(m.header.systemId, new Map())
      }
      this.processMessage(link, m)
    }
  }

  private processMessage(link: Link, m: ReceivedMessage): void {
    const src = m.header
    if (m.name === 'HEARTBEAT' && m.fields.autopilot === MavAutopilot.MAV_AUTOPILOT_ARDUPILOTMEGA) {
      if (this.snap.vehicle === null) this.discover(link, src.systemId, src.componentId, m.fields.type)
      const vehicle = this.snap.vehicle
      if (vehicle === null || src.systemId !== vehicle.systemId || src.componentId !== vehicle.componentId) return
      this.mavType = m.fields.type
      this.vehicleClass = classifyVehicle(m.fields.type)
      this.set({
        telemetry: {
          ...this.snap.telemetry,
          armed: (m.fields.baseMode & MavModeFlag.MAV_MODE_FLAG_SAFETY_ARMED) !== 0,
          modeName: modeName(m.fields.type, m.fields.customMode)
        }
      })
    }
    const vehicle = this.snap.vehicle
    if (vehicle === null || src.systemId !== vehicle.systemId || src.componentId !== vehicle.componentId) return
    this.lastRxMs = this.clock.now()
    this.reconnectAttempts = 0
    this.setTelemetryStatus('Live', false)

    switch (m.name) {
      case 'GLOBAL_POSITION_INT': {
        this.updateVehiclePosition(m.fields.lat / 1e7, m.fields.lon / 1e7)
        const vx = m.fields.vx / 100.0
        const vy = m.fields.vy / 100.0
        this.set({ telemetry: { ...this.snap.telemetry, speed: Math.sqrt(vx * vx + vy * vy) } })
        break
      }
      case 'ATTITUDE':
        this.updateVehicleHeading(m.fields.yaw)
        break
      case 'FILE_TRANSFER_PROTOCOL':
        this.ftp.handleMessage(m)
        break
      case 'BATTERY_STATUS':
        this.set({
          telemetry: {
            ...this.snap.telemetry,
            batteryPct: m.fields.batteryRemaining,
            lastUpdate: this.clock.now(),
            currentA: m.fields.currentBattery / 100.0
          }
        })
        break
      case 'GPS_RAW_INT':
      case 'GPS2_RAW':
        this.set({
          telemetry: { ...this.snap.telemetry, numSats: m.fields.satellitesVisible === 255 ? null : m.fields.satellitesVisible }
        })
        break
      case 'SYS_STATUS':
        this.setFenceEnabled((m.fields.onboardControlSensorsEnabled & MavSysStatusSensor.MAV_SYS_STATUS_GEOFENCE) !== 0)
        break
      case 'POSITION_TARGET_GLOBAL_INT':
        if (m.fields.latInt !== 0 || m.fields.lonInt !== 0) {
          this.targetSeenMs = this.clock.now()
          this.set({ target: { lat: m.fields.latInt / 1e7, lon: m.fields.lonInt / 1e7 } })
        } else {
          this.clearTarget()
        }
        break
      case 'COMMAND_ACK':
        if (this.gcsSystemId === m.fields.targetSystem && this.gcsComponentId === m.fields.targetComponent) {
          this.acks.acknowledge(
            m.fields.command,
            mavResultName(m.fields.result),
            m.fields.result === MavResult.MAV_RESULT_IN_PROGRESS
          )
        }
        break
      case 'STATUSTEXT':
        this.pushStatus(m.fields.severity, m.fields.text)
        break
      default:
        break
    }
  }

  private discover(link: Link, systemId: number, componentId: number, type: number): void {
    const identity = `${link.settings.url}:${systemId}:${componentId}`
    if (identity !== this.mapVehicleIdentity) this.movedOnce = false
    this.mapVehicleIdentity = identity
    const params = new MavParam(this.ftp)
    // Set before FTP and fetchers, which read it to address their requests.
    this.set({
      vehicle: { systemId, componentId, params, paramVehicle: paramVehicle(type) },
      paramEpoch: this.snap.paramEpoch + 1
    })
    this.ftp.setLink({ connection: link, systemId, componentId })
    this.fenceFetcher.onConnected()
    this.missionFetcher.onConnected()
  }

  private setFenceEnabled(enabled: boolean): void {
    if (this.snap.fenceEnabled !== enabled) this.set({ fenceEnabled: enabled })
  }

  // ---------------------------------------------------------------- map state (upstream map.js)

  private updateVehiclePosition(lat: number, lon: number): void {
    const marker = this.snap.marker
    const headingDeg = marker === null ? (this.lastHeadingDeg ?? 0) : marker.headingDeg
    const next: VehicleMarker = { lat, lon, vehicleClass: this.vehicleClass, headingDeg }
    if (!this.movedOnce) {
      this.movedOnce = true
      this.set({ marker: next, centerRequest: this.snap.centerRequest + 1 })
    } else {
      this.set({ marker: next })
    }
  }

  private updateVehicleHeading(yawRad: number): void {
    const deg = ((yawRad * 180) / Math.PI + 360) % 360
    this.lastHeadingDeg = deg
    const marker = this.snap.marker
    if (marker !== null) this.set({ marker: { ...marker, headingDeg: deg } })
  }

  private clearTarget(): void {
    this.targetSeenMs = 0
    if (this.snap.target !== null) this.set({ target: null })
  }

  private updateTargetTimeout(): void {
    if (this.snap.target !== null && this.targetSeenMs && this.clock.now() - this.targetSeenMs > 5000) this.clearTarget()
  }

  private updateLte(): void {
    const values = this.vehicleSystemValues()
    if (values === undefined) return
    const mcc = values.get('LTE_MCCMNC')
    const rsrp = values.get('LTE_RSRP')
    let carrier = '—'
    if (mcc !== undefined) {
      const code = Math.round(mcc)
      carrier = MCCMNC_MAP[code] ?? String(code)
    }
    this.set({ lteCarrier: carrier, lteRsrp: rsrp !== undefined ? `${(rsrp / 10.0).toFixed(1)} dBm` : '— dBm' })
  }

  private vehicleSystemValues(): ReadonlyMap<string, number> | undefined {
    const vehicle = this.snap.vehicle
    return vehicle === null ? undefined : this.namedValues.get(vehicle.systemId)
  }

  // ---------------------------------------------------------------- status log

  private pushStatus(severity: number | undefined, text: string): void {
    this.set({ statusLog: pushStatus(this.snap.statusLog, this.clock.now(), severity, text) })
  }

  private reportAck(command: number, outcome: CommandOutcome<AckResult>): void {
    const result = outcome.kind === 'result' ? outcome.result : outcome.kind === 'no-ack' ? 'no acknowledgement' : 'not sent'
    if (result === 'ACCEPTED') return
    const text = `CMD ${mavCmdName(command)}: ${result}`
    this.pushStatus(MavSeverity.MAV_SEVERITY_ERROR, text)
    this.toast(text, 3000)
  }

  // ---------------------------------------------------------------- commands

  private vehicleReady(): boolean {
    if (this.link === null || !this.link.socket.isOpen || this.snap.vehicle === null) {
      this.toast('Waiting for vehicle connection')
      return false
    }
    return true
  }

  /** Sends a COMMAND_INT to the vehicle with ACK tracking (upstream `sendCommandInt`). */
  sendCommand(request: CommandRequest): boolean {
    if (!this.vehicleReady()) return false
    const vehicle = this.snap.vehicle
    if (vehicle === null) return false
    const [p1, p2, p3, p4, x, y, z] = request.params
    return this.acks.submit(request.command, () => {
      const link = this.link
      if (link === null || !link.socket.isOpen) throw new Error('Disconnected')
      const frame = link.encoder.encode(COMMAND_INT, {
        targetSystem: vehicle.systemId,
        targetComponent: vehicle.componentId,
        frame: MavFrame.MAV_FRAME_GLOBAL_RELATIVE_ALT_INT,
        command: request.command,
        current: 0,
        autocontinue: 0,
        param1: p1,
        param2: p2,
        param3: p3,
        param4: p4,
        x: jspackInt32(x),
        y: jspackInt32(y),
        z
      })
      link.socket.send(frame)
      this.toast(request.sentText)
    })
  }

  /** Rover mode buttons; other vehicle types are refused (upstream `sendSetMode`). */
  sendSetMode(mode: ModeButton): boolean {
    if (!this.vehicleReady()) return false
    if (!isRoverish(this.mavType)) {
      this.toast('Mode controls require a connected boat or rover')
      return false
    }
    return this.sendCommand(setModeCommand(mode))
  }

  /** Map long press: guided target. */
  reposition(lat: number, lng: number): boolean {
    return this.sendCommand(repositionCommand(lat, lng))
  }

  fenceEnable(enable: boolean): boolean {
    return this.sendCommand(fenceEnableCommand(enable))
  }

  fetchFence(): void {
    this.fenceFetcher.fetch()
  }

  fetchMission(): void {
    this.missionFetcher.fetch()
  }
}

/** Mission overlay from parsed items, with upstream's toasts (shown even for automatic fetches). */
export function presentMission(toast: (text: string) => void): (items: MissionItem[]) => readonly MissionPoint[] {
  return (items) => {
    const points = missionPoints(items)
    if (!points.length) {
      toast('No mission points found')
      return []
    }
    toast(`Loaded mission with ${points.length} points`)
    return points
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
