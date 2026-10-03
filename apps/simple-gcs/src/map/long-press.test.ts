// Port of the gesture cases of upstream tests/simplegcs-interactions.test.cjs.
import { describe, expect, it } from 'vitest'
import { FakeClock } from '../test-utils/fake-clock.js'
import { LongPressDetector, type GesturePointer, type Point } from './long-press.js'

type EventType = 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel' | 'pointerleave'

function gesture() {
  const clock = new FakeClock()
  const commands: { lat: number; lng: number }[] = []
  // Upstream's stub measures distance along x only and maps a point to lat = x.
  const detector = new LongPressDetector(
    clock,
    (p) => commands.push({ lat: p.x, lng: 149 }),
    (a: Point, b: Point) => Math.abs(a.x - b.x)
  )
  function send(type: EventType, id = 1, x = 10, overrides: Partial<GesturePointer> = {}): void {
    const ev: GesturePointer = {
      pointerId: id,
      button: 0,
      pointerType: 'touch',
      point: { x, y: 0 },
      excluded: false,
      preventDefault() {},
      ...overrides
    }
    // Upstream dispatch order: window capture first for pointerdown, map first otherwise.
    switch (type) {
      case 'pointerdown':
        detector.windowPointerDown(ev)
        detector.pointerDown(ev)
        break
      case 'pointermove':
        detector.pointerMove(ev)
        break
      case 'pointerleave':
        detector.pointerLeave(ev)
        break
      case 'pointerup':
      case 'pointercancel':
        detector.windowPointerEnd(ev)
        break
    }
  }
  return { send, commands, clock, detector }
}

describe('long press', () => {
  it('single-finger long press still commands directly at 600ms', () => {
    const { send, commands, clock } = gesture()
    send('pointerdown')
    clock.tick(599)
    expect(commands.length).toBe(0)
    clock.tick(1)
    expect(commands.length).toBe(1)
    expect(commands[0]!.lat).toBe(10)
    clock.tick(1000)
    send('pointerup')
    expect(commands.length).toBe(1)
  })

  it('second finger cancels the old timer even when the first finger lifts first', () => {
    const { send, commands, clock } = gesture()
    send('pointerdown', 1)
    clock.tick(500)
    send('pointerdown', 2, 20)
    clock.tick(50)
    send('pointerup', 1)
    clock.tick(1000)
    expect(commands.length).toBe(0)
    // Still suppress new fingers until the whole pinch has ended.
    send('pointerdown', 3)
    clock.tick(1000)
    expect(commands.length).toBe(0)
    send('pointerup', 2)
    send('pointercancel', 3)
    send('pointerdown', 4, 40)
    clock.tick(600)
    expect(commands[0]!.lat).toBe(40)
  })

  it('drag, cancel, leaving the map and window blur cancel holds', () => {
    const { send, commands, clock, detector } = gesture()
    for (const action of ['pointermove', 'pointercancel', 'pointerleave', 'blur'] as const) {
      send('pointerdown')
      clock.tick(300)
      if (action === 'blur') detector.blur()
      else send(action, 1, 21)
      clock.tick(600)
      send('pointerup')
    }
    expect(commands.length).toBe(0)
    send('pointerdown', 1, 10, { pointerType: 'mouse' })
    clock.tick(600)
    expect(commands.length, 'mouse hold remains available').toBe(1)
  })

  it('second finger on an excluded map control also cancels the hold', () => {
    const { send, commands, clock } = gesture()
    send('pointerdown')
    send('pointerdown', 2, 20, { excluded: true })
    clock.tick(1000)
    expect(commands.length).toBe(0)
  })

  it('a second finger cancels the timer while both fingers remain down', () => {
    const { send, commands, clock } = gesture()
    send('pointerdown', 1)
    clock.tick(500)
    send('pointerdown', 2)
    clock.tick(200)
    expect(commands.length).toBe(0)
    send('pointerup', 2)
    clock.tick(700)
    expect(commands.length).toBe(0)
  })
})
