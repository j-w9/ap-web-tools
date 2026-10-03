// Differential test: upstream `SimpleGCS/userloc.js` (run in node:vm with a fake geolocation,
// Leaflet layers and timers) and the port's `UserLocation` receive identical seeded sequences of
// start/stop, position fixes, geolocation errors and clock ticks. The toasts, the watches opened
// and cleared, and the drawn location (dot position and accuracy ring) must match after each step.
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import type { Timer } from '../clock.js'
import { FakeClock } from '../test-utils/fake-clock.js'
import { upstreamSource } from '../test-utils/upstream.js'
import { UserLocation, type GeolocationPort, type UserFix } from './user-location.js'

type Step =
  | { readonly kind: 'start' | 'stop' }
  | { readonly kind: 'fix'; readonly lat: number; readonly lng: number; readonly accuracy: number }
  | { readonly kind: 'error'; readonly code: number }
  | { readonly kind: 'tick'; readonly ms: number }

/** Fake `navigator.geolocation`: only the newest uncleared watch receives events. */
class FakeGeolocation implements GeolocationPort {
  readonly log: string[] = []
  private nextId = 1
  private active: { id: number; ok: (p: GeolocationPosition) => void; err: (e: GeolocationPositionError) => void } | null = null

  watchPosition(
    ok: (p: GeolocationPosition) => void,
    err: (e: GeolocationPositionError) => void,
    options: PositionOptions
  ): number {
    const id = this.nextId++
    this.log.push(`watch ${id} ${JSON.stringify(options)}`)
    this.active = { id, ok, err }
    return id
  }

  clearWatch(id: number): void {
    this.log.push(`clear ${id}`)
    if (this.active?.id === id) this.active = null
  }

  fix(lat: number, lng: number, accuracy: number): void {
    const pos = { coords: { latitude: lat, longitude: lng, accuracy }, timestamp: 0 }
    this.active?.ok(pos as GeolocationPosition)
  }

  error(code: number): void {
    const err: GeolocationPositionError = { code, message: '', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }
    this.active?.err(err)
  }
}

interface Drawn {
  readonly lat: number
  readonly lng: number
  readonly accuracy: number
}

function upstreamDriver(clock: FakeClock, geo: FakeGeolocation | undefined) {
  const toasts: string[] = []
  let dot: { ll: number[] } | null = null
  let ring: { ll: number[]; radius: number } | null = null
  const map = {
    getZoom: () => 2,
    setView() {
      throw new Error('autoCenterFirstFix is off in SimpleGCS')
    },
    removeLayer(layer: unknown) {
      if (layer === dot) dot = null
      if (layer === ring) ring = null
    }
  }
  const L = {
    circleMarker(ll: number[]) {
      const layer = {
        ll,
        addTo: () => ((dot = layer), layer),
        bindPopup: () => layer,
        setLatLng: (v: number[]) => void (layer.ll = v)
      }
      return layer
    },
    circle(ll: number[], opts: { radius: number }) {
      const layer = {
        ll,
        radius: opts.radius,
        addTo: () => ((ring = layer), layer),
        setLatLng: (v: number[]) => void (layer.ll = v),
        setRadius: (r: number) => void (layer.radius = r)
      }
      return layer
    }
  }
  const window: Record<string, unknown> = {}
  const document = {
    createElement: () => ({
      remove() {},
      set textContent(t: string) {
        toasts.push(t)
      }
    }),
    body: { appendChild() {} }
  }
  runInNewContext(upstreamSource('SimpleGCS/userloc.js'), {
    window,
    document,
    navigator: geo === undefined ? {} : { geolocation: geo },
    L,
    console: { log() {}, warn() {} },
    setTimeout: (fn: () => void, ms: number): Timer => clock.after(ms, fn),
    clearTimeout: (t: Timer | null) => t?.cancel()
  })
  const api = window.UserLocation as { init(m: unknown, o: object): void; start(): void; stop(): void }
  api.init(map, { autoCenterFirstFix: false })
  return {
    toasts,
    drawn: (): Drawn | null => {
      if (dot === null && ring === null) return null
      // Both layers are always created and removed together.
      return { lat: dot!.ll[0]!, lng: dot!.ll[1]!, accuracy: ring!.radius }
    },
    start: () => api.start(),
    stop: () => api.stop()
  }
}

function portDriver(clock: FakeClock, geo: FakeGeolocation | undefined) {
  const toasts: string[] = []
  let drawn: UserFix | null = null
  const tracker = new UserLocation(geo, clock, { toast: (m) => toasts.push(m), fix: (f) => (drawn = f) })
  return {
    toasts,
    drawn: (): Drawn | null => drawn,
    start: () => tracker.start(),
    stop: () => tracker.stop()
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

function randomSteps(seed: number, count: number): Step[] {
  const r = rng(seed)
  const steps: Step[] = []
  for (let i = 0; i < count; i++) {
    const roll = r()
    if (roll < 0.08) steps.push({ kind: 'start' })
    else if (roll < 0.12) steps.push({ kind: 'stop' })
    else if (roll < 0.35) steps.push({ kind: 'fix', lat: -35 + r(), lng: 149 + r(), accuracy: Math.round(r() * 100) })
    else if (roll < 0.75) steps.push({ kind: 'error', code: r() < 0.03 ? 1 : r() < 0.5 ? 2 : 3 })
    else steps.push({ kind: 'tick', ms: [1000, 14999, 15000, 16000][Math.floor(r() * 4)]! })
  }
  return steps
}

type Driver = ReturnType<typeof portDriver>

function run(step: Step, d: Driver, geo: FakeGeolocation | undefined, clock: FakeClock): void {
  switch (step.kind) {
    case 'start':
      return d.start()
    case 'stop':
      return d.stop()
    case 'fix':
      return geo?.fix(step.lat, step.lng, step.accuracy)
    case 'error':
      return geo?.error(step.code)
    case 'tick':
      return clock.tick(step.ms)
  }
}

describe('UserLocation oracle (upstream userloc.js)', () => {
  it('matches upstream for 200 seeded sequences, including 50-error give-up and permission denial', () => {
    const seen = new Set<string>()
    // Scripted give-up: 50 consecutive errors, each followed by the 15 s retry, then more events.
    const giveUp: Step[] = [{ kind: 'start' }]
    for (let i = 0; i < 52; i++) giveUp.push({ kind: 'error', code: 2 }, { kind: 'tick', ms: 15000 })
    giveUp.push({ kind: 'start' }, { kind: 'fix', lat: -35, lng: 149, accuracy: 5 }, { kind: 'stop' })
    for (let seed = 0; seed <= 200; seed++) {
      const upGeo = new FakeGeolocation()
      const portGeo = new FakeGeolocation()
      const upClock = new FakeClock()
      const portClock = new FakeClock()
      const up = upstreamDriver(upClock, upGeo)
      const port = portDriver(portClock, portGeo)
      for (const [i, step] of (seed === 0 ? giveUp : randomSteps(seed, 400)).entries()) {
        run(step, up, upGeo, upClock)
        run(step, port, portGeo, portClock)
        const where = `seed ${seed} step ${i}`
        expect(port.toasts, where).toEqual(up.toasts)
        expect(portGeo.log, where).toEqual(upGeo.log)
        expect(port.drawn(), where).toEqual(up.drawn())
      }
      for (const t of up.toasts) seen.add(t)
    }
    expect([...seen].sort()).toEqual(
      [
        'Locating…',
        'Location error, will retry…',
        'Location off',
        'Location on',
        'Location permission denied',
        'Location unavailable after multiple attempts'
      ].sort()
    )
  })

  it('without geolocation both only report it as unavailable', () => {
    const up = upstreamDriver(new FakeClock(), undefined)
    const port = portDriver(new FakeClock(), undefined)
    up.start()
    port.start()
    expect(port.toasts).toEqual(['Geolocation not available'])
    expect(port.toasts).toEqual(up.toasts)
  })
})
