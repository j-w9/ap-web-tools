import { Section } from '@apwt/tool-shell'
import type { InternalErrorEvent } from '../analysis/internal-errors.js'
import type { IomcuReport } from '../analysis/iomcu.js'
import { decodeIcsr, faultName, taskName, watchdogDecodeLine, type WatchdogRecord } from '../analysis/watchdog.js'
import { Count, SubHeading, Table, hex } from './common.js'

function withName(value: number, name: string | undefined): string {
  return name === undefined ? String(value) : `${value} (${name})`
}

function WatchdogTable({ w }: { w: WatchdogRecord }) {
  const rows: [string, string][] = [
    ['Scheduler task', withName(w.schedulerTask, taskName(w.schedulerTask))],
    ['Internal error mask', hex(w.internalErrors)],
    ['Internal error count', String(w.internalErrorCount)],
    ['Internal error line', String(w.internalErrorLastLine)],
    ['Last MAVLink message', withName(w.lastMavlinkMsgId, w.lastMavlinkMsgId === 0 ? 'none' : undefined)],
    ['Last MAVLink command', withName(w.lastMavlinkCmd, w.lastMavlinkCmd === 0 ? 'none' : undefined)],
    ['Semaphore line', withName(w.semaphoreLine, w.semaphoreLine === 0 ? 'not waiting' : undefined)],
    ['Fault line', String(w.faultLine)],
    ['Fault type', withName(w.faultType, faultName(w.faultType))],
    ['Fault address', hex(w.faultAddr)],
    ['Fault thread priority', String(w.faultThreadPriority)],
    ['Fault ICS register', hex(w.faultIcsr)],
    ['Fault link register', hex(w.faultLr)],
    ['Fault thread name', w.threadName]
  ]
  return (
    <>
      <Table head={['Field', 'Value']}>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <td>{k}</td>
            <td>{v}</td>
          </tr>
        ))}
      </Table>
      <details style={{ marginTop: 8 }}>
        <summary>ICS register fields</summary>
        <Table head={['Bits', 'Field', 'Value', 'Meaning']}>
          {decodeIcsr(w.faultIcsr).map((f) => (
            <tr key={f.name}>
              <td>{f.bits}</td>
              <td>{f.name}</td>
              <td>{hex(f.value)}</td>
              <td>{f.description ?? ''}</td>
            </tr>
          ))}
        </Table>
      </details>
      <details style={{ marginTop: 8 }}>
        <summary>Line for decode_watchdog.py</summary>
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{watchdogDecodeLine(w)}</pre>
      </details>
    </>
  )
}

/** Watchdog reboots. */
export function WatchdogSection({ watchdogs }: { watchdogs: readonly WatchdogRecord[] }) {
  if (watchdogs.length === 0) return null
  return (
    <Section title="Watchdog" help="The flight controller was reset by its watchdog. The developers want to hear about these.">
      {watchdogs.map((w, i) => (
        <div key={i}>
          {watchdogs.length > 1 && <SubHeading>Watchdog {i + 1}</SubHeading>}
          <WatchdogTable w={w} />
        </div>
      ))}
    </Section>
  )
}

/** Internal errors, one row per change. */
export function InternalErrorsSection({ errors }: { errors: readonly InternalErrorEvent[] }) {
  if (errors.length === 0) return null
  return (
    <Section title="Internal errors" help="Errors the firmware detected in itself, each listed when it first appeared.">
      <Table head={['Time (s)', 'New errors', 'Mask', 'Count', 'Line']}>
        {errors.map((e, i) => (
          <tr key={i}>
            <td>{(e.timeUs * 1e-6).toFixed(2)}</td>
            <td style={{ textAlign: 'left' }}>{e.names.join(', ')}</td>
            <td>{hex(e.maskChange)}</td>
            <td>{e.displayCount === undefined ? '' : `${e.displayCount} times`}</td>
            <td>{e.displayLine ?? ''}</td>
          </tr>
        ))}
      </Table>
    </Section>
  )
}

/** IOMCU error counters. */
export function IomcuSection({ iomcu }: { iomcu: IomcuReport | undefined }) {
  if (iomcu === undefined) return null
  const rows: [string, number | undefined][] = [
    ['Status read errors', iomcu.statusReadErrors],
    ['Flight controller errors', iomcu.flightControllerErrors],
    ['IOMCU errors', iomcu.iomcuErrors],
    ['Delayed packets', iomcu.delayedPackets]
  ]
  return (
    <Section title="IOMCU" help="Communication errors between the flight controller and its IO co-processor; all should be zero.">
      <Table head={['Counter', 'Maximum']}>
        {rows
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => (
            <tr key={k}>
              <td>{k}</td>
              <td>
                <Count value={v} />
              </td>
            </tr>
          ))}
      </Table>
    </Section>
  )
}
