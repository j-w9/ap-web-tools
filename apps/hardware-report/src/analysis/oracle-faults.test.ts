// Oracle: upstream HardwareReport.js `show_watchdog()` and `show_internal_errors()` run in a vm
// (test-utils/upstream.ts) against the port's watchdog and internal-error data. The text upstream
// renders is rebuilt from the port's data in upstream's wording and compared exactly.
import { DataflashLog } from '@apwt/dataflash'
import { describe, expect, it } from 'vitest'
import { readFixture } from '../test-utils/fixtures.js'
import { baseLog } from '../test-utils/synthetic.js'
import { createUpstreamHardwareReport } from '../test-utils/upstream.js'
import type { InternalErrorEvent } from './internal-errors.js'
import { buildLogReport } from './report.js'
import { decodeIcsr, faultName, taskName, upstreamHex, type WatchdogRecord } from './watchdog.js'

const named = (value: number, name: string | undefined): string => String(value) + (name === undefined ? '' : ` (${name})`)

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
      out += 'Fault Type: ' + named(w.faultType, faultName(w.faultType))
      out += 'Fault Address: ' + upstreamHex(w.faultAddr)
      out += 'Fault Thread Priority: ' + String(w.faultThreadPriority)
      out += 'Fault ICS Register: ' + upstreamHex(w.faultIcsr)
      for (const f of decodeIcsr(w.faultIcsr)) {
        out += `${f.name}: ${upstreamHex(f.value)}` + (f.description === undefined ? '' : `  (${f.description})`)
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

async function compare(bytes: Uint8Array): Promise<ReturnType<typeof buildLogReport>> {
  const up = await createUpstreamHardwareReport()
  await up.loadLog(bytes)
  const r = buildLogReport(DataflashLog.parse(bytes))
  const wdog = up.dom.getElementById('WDOG')
  expect(wdog.textContent).toBe(watchdogText(r.watchdogs))
  expect(wdog.hidden).toBe(r.watchdogs.length === 0)
  const ie = up.dom.getElementById('InternalError')
  expect(ie.textContent).toBe(internalErrorText(r.internalErrors))
  expect(ie.hidden).toBe(r.internalErrors.length === 0)
  return r
}

describe('oracle: watchdog and internal errors', () => {
  it.each(['copter-sitl.bin', 'copter-files.bin'])('matches %s', async (name) => {
    await compare(readFixture(name))
  })

  it('reproduces the fault-type 5/6 names and the ICSR bit 31 sign', async () => {
    const bytes = baseLog()
      .define('WDOG', 'QbIHHHHHHHIBIIn', 'TimeUS,Tsk,IE,IEC,IEL,MvMsg,MvCmd,SmLn,FL,FT,FA,FP,ICSR,LR,TN')
      .params({ ARMING_CHECK: 1 })
      .write('WDOG', [1, -2, 0, 0, 0, 0, 0, 0, 1234, 3, 0x08001234, 182, 0x80400803, 0x0800abcd, 'main'])
      .write('WDOG', [2, -2, 0, 0, 0, 0, 0, 0, 1234, 3, 0x08001234, 182, 0x80400803, 0x0800abcd, 'main'])
      .write('WDOG', [3, -3, 7, 2, 3, 4, 5, 6, 7, 5, 8, 9, 0xffffffff, 10, 'io'])
      .write('WDOG', [4, 12, 1, 2, 3, 0, 0, 0, 7, 6, 8, 9, 0x00008008, 10, 'io'])
      .write('WDOG', [5, -1, 1, 2, 3, 0, 0, 0, 7, 4, 0xfffffff0, 9, 0x0003f00f, 0xffffffff, 'x'])
      .bytes()
    const r = await compare(bytes)
    expect(r.watchdogs.map((w) => faultName(w.faultType))).toEqual(['HardFault', undefined, undefined, 'MemManage'])
    expect(decodeIcsr(0x80000000).find((f) => f.name === 'NMIPENDSET')?.value).toBe(-1)
  })

  it('names bits past the table "undefined" and works out counts and lines as upstream', async () => {
    const bytes = baseLog()
      .define('PM', 'QHIHHIHH', 'TimeUS,ErrL,InE,ErC,Load,Mem,MaxT,LR')
      .define('MON', 'QIHI', 'TimeUS,IErr,IErrLn,IErrCnt')
      .params({ ARMING_CHECK: 1 })
      .write('PM', [100, 0, 0, 0, 0, 0, 0, 400])
      .write('PM', [200, 55, 1 << 10, 3, 0, 0, 0, 400])
      .write('MON', [250, 1 << 10, 55, 5])
      .write('PM', [300, 77, (1 << 10) | (1 << 14) | (1 << 23), 7, 0, 0, 0, 400])
      .write('PM', [350, 0, (1 << 10) | (1 << 14) | (1 << 23) | (1 << 30), 8, 0, 0, 0, 400])
      .write('MON', [400, 0x80000000 | (1 << 30) | (1 << 23) | (1 << 14) | (1 << 10), 0, 9])
      .write('PM', [500, 12, 3, 30, 0, 0, 0, 400])
      .bytes()
    const r = await compare(bytes)
    expect(r.internalErrors.some((e) => e.names.includes('undefined'))).toBe(true)
  })

  it('reads the newer PM field names', async () => {
    await compare(
      baseLog()
        .define('PM', 'QHIHHIHH', 'TimeUS,ErrL,IntE,ErrC,Load,Mem,MaxT,LR')
        .params({ A: 1 })
        .write('PM', [1, 9, 1, 1, 0, 0, 0, 400])
        .write('PM', [2, 9, 5, 4, 0, 0, 0, 400])
        .bytes()
    )
  })
})
