/**
 * Command acknowledgement tracking (upstream `SimpleGCS/commands.js`, class `CommandAcks`).
 * ACKs identify a MAVLink command, not its individual parameter values, so every send is tracked
 * per command id without delaying control actions or claiming a per-request result.
 */
import { NO_TIMER, type Clock, type Timer } from '../clock.js'

/** What became of one tracked send. Upstream reports these as strings. */
export type CommandOutcome<R> =
  /** The vehicle answered with a result (upstream: the MAV_RESULT name). */
  | { readonly kind: 'result'; readonly result: R }
  /** No ACK within the timeout (upstream: 'no acknowledgement'). */
  | { readonly kind: 'no-ack' }
  /** The send itself threw (upstream: 'not sent'). */
  | { readonly kind: 'not-sent' }

export interface CommandAcksOptions<R> {
  readonly report: (command: number, outcome: CommandOutcome<R>) => void
  readonly clock: Clock
  readonly timeoutMs?: number
}

interface Entry {
  timer: Timer
}

export class CommandAcks<R> {
  private readonly report: (command: number, outcome: CommandOutcome<R>) => void
  private readonly clock: Clock
  readonly timeoutMs: number
  private readonly pending = new Map<number, Entry[]>()

  constructor(options: CommandAcksOptions<R>) {
    this.report = options.report
    this.clock = options.clock
    this.timeoutMs = options.timeoutMs ?? 5000
  }

  /** Tracks one send and runs it immediately. False (and a 'not-sent' report) if `send` throws. */
  submit(command: number, send: () => void): boolean {
    const entries = this.pending.get(command) ?? []
    const entry: Entry = { timer: NO_TIMER }
    entries.push(entry)
    this.pending.set(command, entries)
    this.armTimeout(command, entry)
    try {
      send()
      return true
    } catch {
      this.remove(command, entry)
      this.report(command, { kind: 'not-sent' })
      return false
    }
  }

  private remove(command: number, entry: Entry): boolean {
    entry.timer.cancel()
    const entries = this.pending.get(command)
    const index = entries?.indexOf(entry) ?? -1
    if (entries === undefined || index < 0) return false
    entries.splice(index, 1)
    if (!entries.length) this.pending.delete(command)
    return true
  }

  private armTimeout(command: number, entry: Entry): void {
    entry.timer.cancel()
    entry.timer = this.clock.after(this.timeoutMs, () => {
      if (this.remove(command, entry)) this.report(command, { kind: 'no-ack' })
    })
  }

  /**
   * Matches an ACK to the oldest outstanding send of `command`. An in-progress ACK only restarts
   * that send's timeout. False if nothing was outstanding.
   */
  acknowledge(command: number, result: R, inProgress = false): boolean {
    const entry = this.pending.get(command)?.[0]
    if (entry === undefined) return false
    if (inProgress) {
      this.armTimeout(command, entry)
      return true
    }
    this.remove(command, entry)
    this.report(command, { kind: 'result', result })
    return true
  }

  clear(): void {
    for (const entries of this.pending.values()) {
      for (const entry of entries) entry.timer.cancel()
    }
    this.pending.clear()
  }
}
