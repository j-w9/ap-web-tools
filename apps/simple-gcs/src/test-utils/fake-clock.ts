import type { Clock, Timer } from '../clock.js'

interface Scheduled {
  readonly id: number
  due: number
  readonly interval: number | null
  readonly callback: () => void
  cancelled: boolean
}

/**
 * Deterministic clock with the semantics of Node's `t.mock.timers` used by the upstream tests:
 * `tick(ms)` advances time, running every timer that falls due in order (including timers
 * scheduled by callbacks within the window), and intervals repeat.
 */
export class FakeClock implements Clock {
  private time: number
  private nextId = 1
  private timers: Scheduled[] = []

  constructor(start = 0) {
    this.time = start
  }

  now(): number {
    return this.time
  }

  after(ms: number, callback: () => void): Timer {
    return this.schedule(ms, null, callback)
  }

  every(ms: number, callback: () => void): Timer {
    return this.schedule(ms, ms, callback)
  }

  /** Timers still waiting to fire. */
  get pending(): number {
    return this.timers.filter((t) => !t.cancelled).length
  }

  tick(ms: number): void {
    const end = this.time + ms
    for (;;) {
      const next = this.timers.filter((t) => !t.cancelled && t.due <= end).sort((a, b) => a.due - b.due || a.id - b.id)[0]
      if (next === undefined) break
      this.time = Math.max(this.time, next.due)
      if (next.interval === null) {
        next.cancelled = true
        this.timers = this.timers.filter((t) => t !== next)
      } else {
        next.due += Math.max(1, next.interval)
      }
      next.callback()
    }
    this.time = end
  }

  private schedule(ms: number, interval: number | null, callback: () => void): Timer {
    const timer: Scheduled = { id: this.nextId++, due: this.time + Math.max(0, ms), interval, callback, cancelled: false }
    this.timers.push(timer)
    return {
      cancel: () => {
        timer.cancelled = true
        this.timers = this.timers.filter((t) => t !== timer)
      }
    }
  }
}
