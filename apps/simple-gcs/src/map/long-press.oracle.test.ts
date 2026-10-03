// Differential test: upstream `SimpleGCS/map.js` `_setupLongPressReposition` (run in node:vm with
// the stub map and event targets of upstream's own interaction test) and the port's
// `LongPressDetector` receive identical seeded sequences of pointer events, blurs and clock ticks.
// The long-press commands (count and position) must match after every step.
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { FakeClock } from '../test-utils/fake-clock.js'
import { upstreamSource } from '../test-utils/upstream.js'
import type { Timer } from '../clock.js'
import { LongPressDetector, type GesturePointer, type Point } from './long-press.js'

type Listener = (event: unknown) => void

function eventTarget() {
  const handlers = new Map<string, Listener[]>()
  return {
    addEventListener(type: string, fn: Listener) {
      handlers.set(type, [...(handlers.get(type) ?? []), fn])
    },
    emit(type: string, event: unknown) {
      for (const fn of handlers.get(type) ?? []) fn(event)
    }
  }
}

interface Ev {
  readonly pointerId: number
  readonly x: number
  readonly y: number
  readonly button: number
  readonly pointerType: string
  readonly excluded: boolean
}

type Step =
  | { readonly kind: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel' | 'pointerleave'; readonly ev: Ev }
  | { readonly kind: 'blur' }
  | { readonly kind: 'tick'; readonly ms: number }

function upstreamDriver(clock: FakeClock) {
  const el = eventTarget()
  const win = { ...eventTarget(), dispatchEvent: (e: { detail: { lat: number; lng: number } }) => commands.push(e.detail) }
  const commands: { lat: number; lng: number }[] = []
  const context = {
    window: win,
    setTimeout: (fn: () => void, ms: number): Timer => clock.after(ms, fn),
    clearTimeout: (t: Timer | null) => t?.cancel(),
    CustomEvent: class {
      readonly detail: unknown
      constructor(_type: string, opts: { detail: unknown }) {
        this.detail = opts.detail
      }
    }
  }
  runInNewContext(upstreamSource('SimpleGCS/map.js'), context)
  const manager = Reflect.get(win, 'MapManager') as { map: unknown; _setupLongPressReposition(): void }
  manager.map = {
    getContainer: () => el,
    mouseEventToContainerPoint: (e: Ev) => ({
      x: e.x,
      y: e.y,
      distanceTo(p: Point) {
        return Math.hypot(this.x - p.x, this.y - p.y)
      }
    }),
    containerPointToLatLng: (p: Point) => ({ lat: p.x, lng: p.y })
  }
  manager._setupLongPressReposition()
  const dom = (ev: Ev) => ({ ...ev, preventDefault() {}, target: { closest: () => ev.excluded } })
  return {
    commands,
    step(s: Step) {
      if (s.kind === 'tick') return clock.tick(s.ms)
      if (s.kind === 'blur') return win.emit('blur', {})
      const event = dom(s.ev)
      // Window capture listeners run first for pointerdown; the release listeners are on window.
      if (s.kind === 'pointerdown') win.emit(s.kind, event)
      el.emit(s.kind, event)
      if (s.kind !== 'pointerdown') win.emit(s.kind, event)
    }
  }
}

function portDriver(clock: FakeClock) {
  const commands: { lat: number; lng: number }[] = []
  const detector = new LongPressDetector(clock, (p) => commands.push({ lat: p.x, lng: p.y }))
  const pointer = (ev: Ev): GesturePointer => ({ ...ev, point: { x: ev.x, y: ev.y }, preventDefault() {} })
  return {
    commands,
    step(s: Step) {
      switch (s.kind) {
        case 'tick':
          return clock.tick(s.ms)
        case 'blur':
          return detector.blur()
        case 'pointerdown':
          detector.windowPointerDown(s.ev)
          return detector.pointerDown(pointer(s.ev))
        case 'pointermove':
          return detector.pointerMove(pointer(s.ev))
        case 'pointerleave':
          return detector.pointerLeave(s.ev)
        case 'pointerup':
        case 'pointercancel':
          return detector.windowPointerEnd(s.ev)
      }
    }
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
  const pick = <T>(items: readonly T[]): T => items[Math.floor(r() * items.length)]!
  const steps: Step[] = []
  for (let i = 0; i < count; i++) {
    const roll = r()
    if (roll < 0.3) {
      steps.push({ kind: 'tick', ms: pick([1, 50, 200, 399, 599, 600, 601, 1000]) })
    } else if (roll < 0.33) {
      steps.push({ kind: 'blur' })
    } else {
      const ev: Ev = {
        pointerId: pick([1, 1, 1, 2, 3]),
        x: Math.round(r() * 30),
        y: Math.round(r() * 30),
        button: pick([0, 0, 0, 0, 1, 2]),
        pointerType: pick(['touch', 'mouse', 'pen']),
        excluded: r() < 0.15
      }
      steps.push({
        kind: pick(['pointerdown', 'pointerdown', 'pointermove', 'pointermove', 'pointerup', 'pointercancel', 'pointerleave']),
        ev
      })
    }
  }
  return steps
}

describe('long press oracle (upstream map.js)', () => {
  it('matches upstream commands for 300 seeded event sequences', () => {
    let fired = 0
    for (let seed = 1; seed <= 300; seed++) {
      const upClock = new FakeClock()
      const portClock = new FakeClock()
      const up = upstreamDriver(upClock)
      const port = portDriver(portClock)
      for (const [i, step] of randomSteps(seed, 80).entries()) {
        up.step(step)
        port.step(step)
        expect(port.commands, `seed ${seed} step ${i}`).toEqual(up.commands)
      }
      fired += up.commands.length
    }
    // The sequences must actually exercise holds that fire, not only cancellations.
    expect(fired).toBeGreaterThan(50)
  })
})
