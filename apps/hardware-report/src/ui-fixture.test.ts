// Keeps the UI audit fixtures (apps/hardware-report/test-fixtures/, used by
// scripts/ui-audit.config.mjs) in step with their builders: a log with the fault, CAN, GPS and
// mission sections the real fixtures lack (no firmware banner, so no GitHub release lookup), and a
// parameter file with airspeed sensors and position offsets. Regenerate with:
//   WRITE_UI_FIXTURE=1 npx vitest run apps/hardware-report/src/ui-fixture.test.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadHardwareReport } from './analysis/report.js'
import { baseLog } from './test-utils/synthetic.js'

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../test-fixtures')

function faultsLog(): Uint8Array {
  return baseLog()
    .define('WDOG', 'QbIHHHHHHHIBIIn', 'TimeUS,Tsk,IE,IEC,IEL,MvMsg,MvCmd,SmLn,FL,FT,FA,FP,ICSR,LR,TN')
    .define('PM', 'QHIHHIHH', 'TimeUS,ErrL,InE,ErC,Load,Mem,MaxT,LR')
    .define('MON', 'QIHI', 'TimeUS,IErr,IErrLn,IErrCnt')
    .define('IOMC', 'QIIIII', 'TimeUS,RSErr,Nerr,Nerr2,NDel,Mem')
    .define('CAND', 'QBBIIIZBB', 'TimeUS,NodeId,Driver,UID1,UID2,Version,Name,Major,Minor', 'NodeId')
    .define('CMD', 'QHHHffffLLfB', 'TimeUS,CTot,CNum,CId,Prm1,Prm2,Prm3,Prm4,Lat,Lng,Alt,Frame')
    .define('FNCE', 'QBBBBfLL', 'TimeUS,Tot,Seq,Type,Count,Radius,Lat,Lng')
    .define('RALY', 'QBBLLhB', 'TimeUS,Tot,Seq,Lat,Lng,Alt,Flags')
    .params({
      ARMING_CHECK: 1,
      INS_GYR_ID: 3408138,
      INS_ACC_ID: 3408138,
      INS_USE: 1,
      COMPASS_DEV_ID: 97539,
      COMPASS_PRIO1_ID: 97539,
      COMPASS_USE: 1,
      GPS1_TYPE: 9,
      GPS1_CAN_NODEID: 10,
      GPS2_TYPE: 9,
      GPS2_CAN_NODEID: 125
    })
    .write('MSG', [5, 'GPS 1: specified as DroneCAN1-10'])
    .write('MSG', [6, 'GPS 2: specified as DroneCAN1-125'])
    .write('WDOG', [10, -2, 0, 0, 0, 0, 0, 0, 1234, 3, 0x08001234, 182, 0x80400803, 0x0800abcd, 'main'])
    .write('PM', [100, 0, 0, 0, 0, 0, 0, 400])
    .write('PM', [200, 55, 1 << 10, 3, 0, 0, 0, 400])
    .write('MON', [250, 1 << 10, 55, 5])
    .write('PM', [300, 77, (1 << 10) | (1 << 14) | (1 << 23), 7, 0, 0, 0, 400])
    .write('IOMC', [1, 0, 1, 0, 0, 0])
    .write('IOMC', [2, 0, 4, 0, 2, 0])
    .write('CAND', [1, 125, 0, 0x11, 0x22, 0xab, 'org.ardupilot.periph', 1, 4])
    .write('CAND', [3, 10, 1, 0x33, 0x44, 0x1234, 'com.hex.here4', 2, 0])
    .write('CAND', [5, 125, 0, 0x11, 0x22, 0xac, 'org.ardupilot.periph', 1, 5])
    .write('CMD', [1, 3, 0, 16, 0, 0, 0, 0, -353632621, 1491652374, 584, 0])
    .write('CMD', [2, 3, 1, 22, 15, 0, 0, 0, 0, 0, 10, 3])
    .write('CMD', [3, 3, 2, 16, 0, 0, 0, 0, -353600000, 1491650000, 20, 3])
    .write('FNCE', [6, 3, 0, 98, 3, 0, -353632621, 1491652374])
    .write('FNCE', [7, 3, 1, 98, 3, 0, -353600000, 1491650000])
    .write('FNCE', [8, 3, 2, 93, 0, 50, -353610000, 1491660000])
    .write('RALY', [10, 1, 0, -353632621, 1491652374, 100, 0])
    .bytes()
}

const PARAM_FILE = [
  'INS_GYR_ID,3408138',
  'INS_ACC_ID,3408138',
  'INS_GYR2_ID,2818570',
  'INS_ACC2_ID,2818570',
  'COMPASS_DEV_ID,97539',
  'COMPASS_PRIO1_ID,97539',
  'BARO1_DEVID,65540',
  'BARO1_WCF_ENABLE,1',
  'ARSPD_DEVID,1',
  'ARSPD2_DEVID,2',
  'ARSPD_USE,1',
  'GPS_TYPE,9',
  'GPS_TYPE2,2',
  'GPS_POS1_X,0.2',
  'GPS_POS1_Y,-0.05',
  'GPS_POS1_Z,-0.1',
  'INS_POS1_X,0.01',
  'INS_POS1_Y,0',
  'INS_POS1_Z,-0.02',
  'FRAME_CLASS,1',
  ''
].join('\n')

const fixtures: [string, Uint8Array][] = [
  ['ui-faults.bin', faultsLog()],
  ['ui-params.param', new TextEncoder().encode(PARAM_FILE)]
]

describe('UI audit fixtures', () => {
  if (process.env.WRITE_UI_FIXTURE === '1') {
    mkdirSync(dir, { recursive: true })
    for (const [name, bytes] of fixtures) writeFileSync(resolve(dir, name), bytes)
  }

  it.each(fixtures)('%s matches its builder and loads', (name, bytes) => {
    const path = resolve(dir, name)
    expect(existsSync(path)).toBe(true)
    expect(new Uint8Array(readFileSync(path))).toEqual(bytes)
    expect(() => loadHardwareReport(name, bytes.slice().buffer)).not.toThrow()
  })

  it('cover the GPS and sensor position sections', () => {
    const [faults, params] = fixtures.map(([name, bytes]) => loadHardwareReport(name, bytes.slice().buffer))
    expect(faults?.sensors.gps.some((g) => g?.device !== undefined)).toBe(true)
    expect(params?.positionOffsets.maxOffset).toBeGreaterThan(0)
  })
})
