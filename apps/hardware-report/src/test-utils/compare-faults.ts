// Test-only: upstream `show_watchdog()` and `show_internal_errors()` text rebuilt from the port's
// data in upstream's wording. Shared by the oracle tests and the real-log test.
import { expect } from 'vitest'
import type { InternalErrorEvent } from '../analysis/internal-errors.js'
import type { LogReport } from '../analysis/report.js'
import { decodeIcsr, faultName, taskName, upstreamHex, type WatchdogRecord } from '../analysis/watchdog.js'
import type { UpstreamHardwareReport } from './upstream.js'

const named = (value: number, name: string | undefined): string => String(value) + (name === undefined ? '' : ` (${name})`)

/**
 * Two proven upstream bugs are fixed in the port (docs/bug-proofs/hardware-report.md); the text
 * upstream renders is rebuilt from the port's values with upstream's results for those: fault types
 * 5 and 6 have no name (duplicate `case 4` labels), and ICSR fields are extracted with a signed
 * shift (a set bit 31 reads -1).
 */
function upstreamFaultName(type: number): string | undefined {
  return type === 5 || type === 6 ? undefined : faultName(type)
}

function upstreamIcsrValue(bits: string, value: number): number {
  const start = Number(bits.split('-')[0])
  return ((value << start) | 0) >> start
}

function watchdogText(list: readonly WatchdogRecord[]): string {
  return list
    .map((w, i) => {
      let out = list.length > 1 ? `Watchdog ${i + 1}` : ''
      out += 'Scheduler Task: ' + named(w.schedulerTask, taskName(w.schedulerTask))
      out += 'Internal Error Mask: ' + String(w.internalErrors)
      out += 'Internal Error Count: ' + String(w.internalErrorCount)
      out += 'Internal Error Line: ' + String(w.internalErrorLastLine)
      out += 'Last MAVLink Message: ' + named(w.lastMavlinkMsgId, w.lastMavlinkMsgId === 0 ? 'none' : undefined)
      out += 'Last MAVLink Command: ' + named(w.lastMavlinkCmd, w.lastMavlinkCmd === 0 ? 'none' : undefined)
      out += 'Semaphore Line: ' + named(w.semaphoreLine, w.semaphoreLine === 0 ? 'not waiting' : undefined)
      out += 'Fault Line: ' + String(w.faultLine)
      out += 'Fault Type: ' + named(w.faultType, upstreamFaultName(w.faultType))
      out += 'Fault Address: ' + upstreamHex(w.faultAddr)
      out += 'Fault Thread Priority: ' + String(w.faultThreadPriority)
      out += 'Fault ICS Register: ' + upstreamHex(w.faultIcsr)
      for (const f of decodeIcsr(w.faultIcsr)) {
        out +=
          `${f.name}: ${upstreamHex(upstreamIcsrValue(f.bits, f.value))}` +
          (f.description === undefined ? '' : `  (${f.description})`)
      }
      out += 'Fault Long Return Address: ' + upstreamHex(w.faultLr)
      out += 'Fault Thread name: ' + w.threadName
      return out
    })
    .join('')
}

function internalErrorText(list: readonly InternalErrorEvent[]): string {
  return list
    .map((e) => {
      let out = upstreamHex(e.maskChange) + ': ' + e.names.join(', ')
      if (e.displayCount !== undefined || e.displayLine !== undefined) {
        out += ' ('
        if (e.displayCount !== undefined) out += `${e.displayCount} times` + (e.displayLine !== undefined ? ', ' : '')
        if (e.displayLine !== undefined) out += `line ${e.displayLine}`
        out += ')'
      }
      return out
    })
    .join('')
}

/** Compare upstream's WDOG and InternalError sections with the port's report. */
export function compareFaults(up: UpstreamHardwareReport, r: LogReport): void {
  const wdog = up.dom.getElementById('WDOG')
  expect(wdog.textContent).toBe(watchdogText(r.watchdogs))
  expect(wdog.hidden).toBe(r.watchdogs.length === 0)
  const ie = up.dom.getElementById('InternalError')
  expect(ie.textContent).toBe(internalErrorText(r.internalErrors))
  expect(ie.hidden).toBe(r.internalErrors.length === 0)
}
