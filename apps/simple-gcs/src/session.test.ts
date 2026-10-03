// The protocol-level flows of upstream tests/browser.cjs, run against the session with a simulated
// signed vehicle, fake clock, fake Web Locks and in-memory storage. DOM-only checks (map pixel
// gestures, video drag, viewport sizes) are covered by component code and listed as manual in
// docs/audit/simple-gcs.md.
import { describe, expect, it } from 'vitest'
import { AppSettingsStore } from './app-settings.js'
import { armCommand, disarmCommand, guardedCommand } from './commands/commands.js'
import type { SimpleGcsConfig } from './config.js'
import type { LockRequester } from './link/leases.js'
import { memoryStore } from './link/storage.js'
import { GcsSession } from './session.js'
import { FakeClock } from './test-utils/fake-clock.js'
import { fakeLocks, fakeVehicle, flush } from './test-utils/fake-vehicle.js'

interface Options {
  readonly local?: Record<string, string>
  readonly session?: Record<string, string>
  readonly config?: SimpleGcsConfig
  readonly locks?: LockRequester | undefined
}

function setup(options: Options = {}, shared?: { clock: FakeClock; vehicle: ReturnType<typeof fakeVehicle> }) {
  const clock = shared?.clock ?? new FakeClock(Date.UTC(2026, 0, 1))
  const vehicle = shared?.vehicle ?? fakeVehicle(clock)
  const local = memoryStore(options.local)
  const sessionStore = memoryStore(options.session)
  const config = options.config ?? {}
  const settings = new AppSettingsStore(local, config)
  const session = new GcsSession({
    clock,
    openSocket: vehicle.openSocket,
    local,
    session: sessionStore,
    locks: 'locks' in options ? options.locks : fakeLocks(),
    randomUint32: () => 189,
    config,
    settings
  })
  const toasts: string[] = []
  let seen = new Set<number>()
  session.subscribe(() => {
    for (const t of session.snapshot.toasts) if (!seen.has(t.id)) toasts.push(t.text)
    seen = new Set(session.snapshot.toasts.map((t) => t.id))
  })
  const run = async (ms: number): Promise<void> => {
    for (let t = 0; t < ms; t += 50) {
      clock.tick(Math.min(50, ms - t))
      await flush()
    }
  }
  return { clock, vehicle, state: vehicle.state, local, sessionStore, settings, session, toasts, run }
}

async function connected(options: Options = {}) {
  const h = setup(options)
  await h.session.start()
  h.session.openDialog()
  h.session.editDraft({ passphrase: 'test-signing', sendHeartbeat: false })
  await h.session.submit()
  await h.run(600)
  return h
}

const commandsSent = (h: ReturnType<typeof setup>, command: number): number =>
  h.state.sent.filter((m) => m.name === 'COMMAND_INT' && m.fields.command === command).length

describe('connection and discovery', () => {
  it('opens no unsolicited connection and prefills the built-in defaults', async () => {
    const h = setup()
    await h.session.start()
    expect(h.state.sockets.length).toBe(0)
    expect(h.session.snapshot.draft.url).toBe('ws://127.0.0.1:5763')
    expect(h.session.snapshot.draft.passphrase).toBe('')
    expect(h.session.snapshot.draft.componentId).toBe('190')
  })

  it('signs FTP with the heartbeat disabled, addresses the vehicle and loads the circle fence', async () => {
    const h = await connected()
    expect(h.session.snapshot.linkStatus).toBe('Live')
    expect(h.session.snapshot.fences).toEqual([{ kind: 'circle', type: 5003, radius: 50, lat: -35, lng: 149 }])
    expect(h.state.sent.length).toBeGreaterThan(0)
    expect(h.state.sent.every((m) => (m.header.incompatFlags & 1) === 1)).toBe(true)
    expect(
      h.state.sent.every(
        (m) =>
          (m.name === 'FILE_TRANSFER_PROTOCOL' || m.name === 'COMMAND_INT') &&
          m.fields.targetSystem === 42 &&
          m.fields.targetComponent === 1
      )
    ).toBe(true)
    expect(h.state.sent.some((m) => m.name === 'HEARTBEAT')).toBe(false)
    expect(h.local.data.get('gcs.url')).toBe('ws://127.0.0.1:5763')
    expect(h.local.data.get('gcs.passphrase')).toBe('test-signing')
    expect(h.sessionStore.data.get('gcs.componentId')).toBe('190')
    expect(h.session.snapshot.marker).toMatchObject({ lat: -35, lon: 149, vehicleClass: 'boat' })
    expect(h.session.snapshot.centerRequest).toBe(1)
  })

  it('fetches the mission on request', async () => {
    const h = await connected()
    h.session.fetchMission()
    await h.run(200)
    expect(h.session.snapshot.mission).toEqual([{ seq: 0, lat: -35, lng: 149 }])
    expect(h.toasts).toContain('Loaded mission with 1 points')
  })

  it('never sends an FTP ResetSessions', async () => {
    const h = await connected()
    h.session.fetchMission()
    await h.run(200)
    const ftp = h.state.sent.filter((m) => m.name === 'FILE_TRANSFER_PROTOCOL')
    expect(ftp.length).toBeGreaterThan(0)
    expect(ftp.every((m) => m.fields.payload[3] !== 2)).toBe(true)
  })
})

describe('commands', () => {
  it('arm, loiter and guided reposition update telemetry; denials are reported', async () => {
    const h = await connected()
    h.session.sendCommand(armCommand())
    await h.run(100)
    expect(h.session.snapshot.telemetry.armed).toBe(true)
    h.session.sendSetMode('LOITER')
    await h.run(100)
    expect(h.session.snapshot.telemetry.modeName).toBe('LOITER')
    h.session.reposition(-35.001, 149.002)
    await h.run(600)
    expect(h.session.snapshot.telemetry.modeName).toBe('GUIDED')
    expect(h.session.snapshot.target).not.toBeNull()
    const cmd = h.state.sent.filter((m) => m.name === 'COMMAND_INT' && m.fields.command === 192).at(-1)
    expect(
      cmd?.name === 'COMMAND_INT' && [
        cmd.fields.frame,
        cmd.fields.param2,
        Number.isInteger(cmd.fields.x),
        cmd.fields.targetSystem
      ]
    ).toEqual([6, 1, true, 42])
    h.session.sendCommand(disarmCommand())
    await h.run(100)
    expect(h.session.snapshot.telemetry.armed).toBe(false)
    h.state.reject = true
    h.session.sendCommand(armCommand())
    await h.run(100)
    expect(h.toasts).toContain('CMD COMPONENT_ARM_DISARM: DENIED')
    expect(h.session.snapshot.statusLog.at(-1)).toMatchObject({ severity: 3, text: 'CMD COMPONENT_ARM_DISARM: DENIED' })
  })

  it('a missing ACK is reported after five seconds', async () => {
    const h = await connected()
    h.state.noAck = true
    h.session.sendCommand(guardedCommand('reboot'))
    expect(commandsSent(h, 246)).toBe(1)
    expect(h.toasts).toContain('PREFLIGHT_REBOOT_SHUTDOWN sent')
    await h.run(4900)
    expect(h.toasts).not.toContain('CMD PREFLIGHT_REBOOT_SHUTDOWN: no acknowledgement')
    await h.run(200)
    expect(h.toasts).toContain('CMD PREFLIGHT_REBOOT_SHUTDOWN: no acknowledgement')
  })

  it('sends nothing without a vehicle and reports why', async () => {
    const h = await connected()
    h.session.requestDisconnect()
    const count = h.state.sent.length
    h.session.sendCommand(armCommand())
    expect(h.state.sent.length).toBe(count)
    expect(h.toasts.at(-1)).toBe('Waiting for vehicle connection')
    for (const mode of ['RTL', 'LOITER'] as const) {
      h.session.sendSetMode(mode)
      expect(h.toasts.at(-1)).toBe('Waiting for vehicle connection')
    }
  })
})

describe('reconnects', () => {
  it('reconnects with the submitted settings, leaving the dialog and its draft untouched', async () => {
    const h = await connected()
    h.session.openDialog()
    h.session.editDraft({
      url: 'wss://edited.example.org/mavlink',
      systemId: '202',
      componentId: '33',
      sendHeartbeat: true,
      passphrase: 'partly typed'
    })
    const previous = { sockets: h.state.sockets.length, sent: h.state.sent.length }
    h.state.sockets.at(-1)!.serverClose()
    await h.run(2600)
    expect(h.state.sockets.length).toBe(previous.sockets + 1)
    expect(h.state.sockets.at(-1)!.url).toBe('ws://127.0.0.1:5763')
    expect(h.session.snapshot.dialogOpen).toBe(true)
    expect(h.session.snapshot.draft.passphrase).toBe('partly typed')
    expect(h.local.data.get('gcs.passphrase')).toBe('test-signing')
    await h.run(1100)
    const after = h.state.sent.slice(previous.sent)
    expect(after.length).toBeGreaterThan(0)
    expect(after.every((m) => m.header.systemId === 255)).toBe(true)
    expect(after.some((m) => m.name === 'HEARTBEAT')).toBe(false)
  })

  it('Connect applies new signing, URL, ids and heartbeat settings', async () => {
    const h = await connected()
    h.session.openDialog()
    h.session.editDraft({
      url: 'wss://edited.example.org/mavlink',
      systemId: '202',
      componentId: '33',
      sendHeartbeat: true,
      passphrase: ' updated-test-signing '
    })
    h.state.passphrase = ' updated-test-signing '
    await h.session.submit()
    await h.run(1200)
    expect(h.state.sockets.at(-1)!.url).toBe('wss://edited.example.org/mavlink')
    expect(h.local.data.get('gcs.passphrase')).toBe(' updated-test-signing ')
    expect(h.state.sent.some((m) => m.name === 'HEARTBEAT' && m.header.systemId === 202 && m.header.componentId === 33)).toBe(
      true
    )
    expect(h.session.snapshot.dialogOpen).toBe(false)
  })

  it('a late close from a replaced socket cannot tear down the new one', async () => {
    const h = await connected()
    const staleClose = h.state.sockets.at(-1)!.closeHandler()
    await h.session.submit()
    await h.run(100)
    expect(h.state.sockets.length).toBe(2)
    staleClose?.(1006, 'late old close')
    expect(h.state.sockets.at(-1)!.readyState).toBe(1)
    expect(h.session.snapshot.linkStatus).toBe('Live')
  })

  it('a dead peer is detected amid foreign relay traffic and replaced promptly', async () => {
    const h = setup({ local: { 'gcs.url': 'wss://saved.example.org/mavlink', 'gcs.passphrase': 'test-signing' } })
    await h.session.start()
    await h.run(600)
    expect(h.state.sockets.length).toBe(1)
    expect(h.state.sockets[0]!.url).toBe('wss://saved.example.org/mavlink')
    const centers = h.session.snapshot.centerRequest
    const before = h.state.sockets.length
    h.state.silent = true
    h.state.hangClose = true
    const dead = h.state.sockets.at(-1)!
    const deadClose = dead.closeHandler()
    await h.run(4000)
    expect(h.session.snapshot.linkStatus).toBe('Telemetry stale')
    expect(h.session.snapshot.connectLabel).toMatch(/^Connect \(\d+s\)$/)
    await h.run(14500)
    expect(h.state.sockets.length, 'reconnect starts within 18.5 seconds without a close event').toBe(before + 1)
    expect(dead.readyState).toBe(2)
    deadClose?.(1006, 'late dead-peer timeout')
    expect(h.state.closeCodes).toContain(4000)
    expect(h.session.snapshot.marker).toBeNull()
    expect(h.session.snapshot.fences).toEqual([])
    expect(h.session.snapshot.telemetry.armed).toBeNull()
    h.state.silent = false
    await h.run(1000)
    expect(h.state.sockets.at(-1)!.readyState).toBe(1)
    expect(h.session.snapshot.linkStatus).toBe('Live')
    expect(h.session.snapshot.marker).not.toBeNull()
    expect(h.session.snapshot.centerRequest, 'same-vehicle reconnect preserves pan and zoom').toBe(centers)
    h.state.hangClose = false
    h.state.vehicleSystem = 43
    h.state.sockets.at(-1)!.serverClose()
    await h.run(2500)
    expect(h.session.snapshot.marker).not.toBeNull()
    expect(h.session.snapshot.centerRequest, 'different vehicle recenters').toBe(centers + 1)
  })

  it('replayed signed telemetry stays rejected across reconnect; fresh telemetry recovers', async () => {
    const h = await connected()
    const replay = h.state.lastHeartbeatPacket!
    h.state.holdTelemetry = true
    h.state.sockets.at(-1)!.serverClose()
    await h.run(2200)
    const beforeReplay = h.state.sent.length
    h.state.sockets.at(-1)!.deliver(replay)
    expect(h.state.sent.length, 'captured heartbeat cannot rediscover a vehicle').toBe(beforeReplay)
    expect(h.session.snapshot.linkStatus).toBe('Waiting for vehicle')
    h.state.holdTelemetry = false
    await h.run(1000)
    expect(h.session.snapshot.linkStatus).toBe('Live')
  })

  it('explicit disconnect recenters on the next connection', async () => {
    const h = await connected()
    const centers = h.session.snapshot.centerRequest
    h.session.requestDisconnect()
    await h.session.submit()
    await h.run(1000)
    expect(h.session.snapshot.centerRequest).toBe(centers + 1)
  })
})

describe('deployment defaults and identities', () => {
  it('a configured default does not auto-connect; a saved URL overrides it and does', async () => {
    const configured = setup({ config: { defaultUrl: 'wss://relay.example.org/mavlink' } })
    await configured.session.start()
    expect(configured.state.sockets.length).toBe(0)
    expect(configured.session.snapshot.draft.url).toBe('wss://relay.example.org/mavlink')
    const saved = setup({
      config: { defaultUrl: 'wss://relay.example.org/mavlink' },
      local: { 'gcs.url': 'wss://saved.example.org/mavlink' }
    })
    await saved.session.start()
    expect(saved.session.snapshot.draft.url).toBe('wss://saved.example.org/mavlink')
    expect(saved.state.sockets[0]!.url).toBe('wss://saved.example.org/mavlink')
  })

  it('a duplicated tab with copied session storage acquires a different component id', async () => {
    const locks = fakeLocks()
    const first = setup({ locks, local: { 'gcs.url': 'ws://127.0.0.1:5763', 'gcs.passphrase': 'test-signing' } })
    await first.session.start()
    const original = first.session.snapshot.draft.componentId
    const sibling = setup({ locks, session: { 'gcs.componentId': original } }, { clock: first.clock, vehicle: first.vehicle })
    await sibling.session.start()
    expect(sibling.session.snapshot.draft.componentId).not.toBe(original)
    await sibling.session.submit()
    expect(sibling.sessionStore.data.get('gcs.componentId')).toBe(sibling.session.snapshot.draft.componentId)
    expect(sibling.local.data.get('gcs.componentId')).toBeUndefined()
  })

  for (const failure of ['fragment', 'constructor', 'lock-rejected', 'lock-exhausted'] as const) {
    it(`${failure} at startup leaves Connect usable without clearing settings`, async () => {
      let mode: 'normal' | typeof failure = failure
      const base = fakeLocks()
      const locks: LockRequester = {
        request(name, options, callback) {
          if (mode === 'lock-rejected') return Promise.reject(new DOMException('Lock access denied', 'SecurityError'))
          if (mode === 'lock-exhausted') return Promise.resolve(callback(null))
          return base.request(name, options, callback)
        }
      }
      const h = setup({
        locks,
        local: {
          'gcs.url': failure === 'fragment' ? 'ws://127.0.0.1:5763/#fragment' : 'ws://127.0.0.1:5763',
          'gcs.passphrase': 'test-signing'
        }
      })
      h.state.rejectSocket = failure === 'constructor'
      await h.session.start()
      expect(h.session.snapshot.starting).toBe(false)
      expect(h.session.snapshot.submitting).toBe(false)
      expect(h.state.sockets.length).toBe(0)
      mode = 'normal'
      h.state.rejectSocket = false
      for (const invalid of ['ws://127.0.0.1:5763/#fragment', 'ws://127.0.0.1:5763/#', 'ws://', 'https://example.org']) {
        const before = { url: h.local.data.get('gcs.url'), sockets: h.state.sockets.length }
        h.session.editDraft({ url: invalid })
        await h.session.submit()
        expect({ url: h.local.data.get('gcs.url'), sockets: h.state.sockets.length }).toEqual(before)
      }
      h.session.editDraft({ url: 'ws://127.0.0.1:5763' })
      await h.session.submit()
      await h.run(600)
      expect(h.session.snapshot.marker).not.toBeNull()
    })
  }

  it('Disconnect cancels a pending Connect and releases its delayed lease', async () => {
    const base = fakeLocks()
    let grant: (() => void) | null = null
    let released = false
    const locks: LockRequester = {
      request(name, options, callback) {
        if (name !== 'simplegcs.component.254') return base.request(name, options, callback)
        return new Promise<unknown>((resolve) => {
          grant = () => resolve(callback({ name }))
        }).then(() => (released = true))
      }
    }
    const h = await connected({ locks })
    const oldId = h.session.snapshot.draft.componentId
    const sockets = h.state.sockets.length
    h.session.editDraft({ componentId: '254' })
    const pending = h.session.submit()
    await flush()
    expect(grant).not.toBeNull()
    h.session.requestDisconnect()
    grant!()
    expect(await pending).toEqual({ kind: 'cancelled' })
    await flush()
    expect(released).toBe(true)
    expect(h.state.sockets.length).toBe(sockets)
    expect(h.session.snapshot.submitting).toBe(false)
    expect(h.sessionStore.data.get('gcs.componentId')).toBe(oldId)
  })
})
