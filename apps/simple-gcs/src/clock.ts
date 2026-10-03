/**
 * Time source for the domain layer. Upstream calls `Date.now`, `setTimeout` and `setInterval`
 * directly; the port injects them so every timer-driven behaviour (retries, watchdogs, stale
 * detection, reconnect back-off) can be tested with a fake clock instead of real time.
 */

/** A scheduled callback that can be cancelled. Cancelling twice, or after it fired, is harmless. */
export interface Timer {
  cancel(): void
}

export interface Clock {
  /** Milliseconds since the Unix epoch, as `Date.now()`. */
  now(): number
  /** Runs `callback` once after `ms` milliseconds (`setTimeout`). */
  after(ms: number, callback: () => void): Timer
  /** Runs `callback` every `ms` milliseconds until cancelled (`setInterval`). */
  every(ms: number, callback: () => void): Timer
}

/** The browser/Node clock. */
export const systemClock: Clock = {
  now: () => Date.now(),
  after(ms, callback) {
    const id = setTimeout(callback, ms)
    return { cancel: () => clearTimeout(id) }
  },
  every(ms, callback) {
    const id = setInterval(callback, ms)
    return { cancel: () => clearInterval(id) }
  }
}

/** A timer that does nothing, for "no timer armed" states. */
export const NO_TIMER: Timer = { cancel() {} }
