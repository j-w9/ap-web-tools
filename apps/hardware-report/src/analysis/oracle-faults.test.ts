// Oracle: upstream HardwareReport.js `show_watchdog()` and `show_internal_errors()` run in a vm
// (test-utils/upstream.ts) against the port's watchdog and internal-error data. The text upstream
// renders is rebuilt from the port's data in upstream's wording and compared exactly.
import { DataflashLog } from '@apwt/dataflash'
import { describe, expect, it } from 'vitest'
import { readFixture } from '../test-utils/fixtures.js'
import { baseLog } from '../test-utils/synthetic.js'
import { compareFaults } from '../test-utils/compare-faults.js'
import { createUpstreamHardwareReport } from '../test-utils/upstream.js'
import { buildLogReport } from './report.js'
import { decodeIcsr, faultName } from './watchdog.js'

async function compare(bytes: Uint8Array): Promise<ReturnType<typeof buildLogReport>> {
  const up = await createUpstreamHardwareReport()
  await up.loadLog(bytes)
  const r = buildLogReport(DataflashLog.parse(bytes))
  compareFaults(up, r)
  return r
}

describe('oracle: watchdog and internal errors', () => {
  it.each(['copter-sitl.bin', 'copter-files.bin'])('matches %s', async (name) => {
    await compare(readFixture(name))
  })

  it('fixes the proven fault-type 5/6 names and the ICSR bit 31 sign', async () => {
    const bytes = baseLog()
      .define('WDOG', 'QbIHHHHHHHIBIIn', 'TimeUS,Tsk,IE,IEC,IEL,MvMsg,MvCmd,SmLn,FL,FT,FA,FP,ICSR,LR,TN')
      .params({ ARMING_CHECK: 1 })
      .write('WDOG', [1, -2, 0, 0, 0, 0, 0, 0, 1234, 3, 0x08001234, 182, 0x80400803, 0x0800abcd, 'main'])
      .write('WDOG', [2, -2, 0, 0, 0, 0, 0, 0, 1234, 3, 0x08001234, 182, 0x80400803, 0x0800abcd, 'main'])
      .write('WDOG', [3, -3, 7, 2, 3, 4, 5, 6, 7, 5, 8, 9, 0xffffffff, 10, 'io'])
      .write('WDOG', [4, 12, 1, 2, 3, 0, 0, 0, 7, 6, 8, 9, 0x00008008, 10, 'io'])
      .write('WDOG', [5, -1, 1, 2, 3, 0, 0, 0, 7, 4, 0xfffffff0, 9, 0x0003f00f, 0xffffffff, 'x'])
      .bytes()
    const up = await createUpstreamHardwareReport()
    await up.loadLog(bytes)
    const text = up.dom.getElementById('WDOG').textContent
    // Upstream: no name for types 5 and 6; NMIPENDSET of 0xffffffff reads 0x-1.
    expect(text).toContain('Fault Type: 5Fault Address')
    expect(text).toContain('Fault Type: 6Fault Address')
    expect(text).toContain('NMIPENDSET: 0x-1')
    const r = await compare(bytes)
    // Port: ArduPilot's BusFault/UsageFault, and bit 31 reads 1.
    expect(r.watchdogs.map((w) => faultName(w.faultType))).toEqual(['HardFault', 'BusFault', 'UsageFault', 'MemManage'])
    expect(decodeIcsr(0x80000000).find((f) => f.name === 'NMIPENDSET')?.value).toBe(1)
    expect(decodeIcsr(0xffffffff).find((f) => f.name === 'NMIPENDSET')?.value).toBe(1)
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
