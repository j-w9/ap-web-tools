// Keeps the UI audit fixtures (apps/log-finder/test-fixtures/, used by scripts/ui-audit.config.mjs)
// in step with their builder: small logs from three boards, with GPS time, a flight track,
// flight time and parameter changes between flights. Regenerate with:
//   WRITE_UI_FIXTURE=1 npx vitest run apps/log-finder/src/ui-fixture.test.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LogWriter } from '@apwt/dataflash/testing'
import { readLogSummary } from './analysis/summary.js'

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../test-fixtures')

interface Flight {
  banner: string
  board: string
  /** GPS week and ms of week at the start. */
  week: number
  ms: number
  /** STAT_FLTTIME at the start and end, seconds. */
  flight: [number, number]
  params: Record<string, number>
  watchdog?: boolean
}

function build(f: Flight): Uint8Array {
  const w = new LogWriter()
  w.defineFormat(128, 'FMT', 'BBnNZ', 'Type,Length,Name,Format,Columns')
  w.defineFormat(129, 'PARM', 'QNff', 'TimeUS,Name,Value,Default')
  w.defineFormat(130, 'MSG', 'QZ', 'TimeUS,Message')
  w.defineFormat(131, 'GPS', 'QBBIHBcLLeffffB', 'TimeUS,I,Status,GMS,GWk,NSats,HDop,Lat,Lng,Alt,Spd,GCrs,VZ,Yaw,U')
  w.defineFormat(132, 'POS', 'QLLfff', 'TimeUS,Lat,Lng,Alt,RelHomeAlt,RelOriginAlt')
  w.defineFormat(133, 'WDOG', 'QbIHHHHHHHIBIIn', 'TimeUS,Tsk,IE,IEC,IEL,MvMsg,MvCmd,SmLn,FL,FT,FA,FP,ICSR,LR,TN')
  w.write('MSG', [1000, f.banner])
  w.write('MSG', [1001, 'ChibiOS: 88b84600'])
  w.write('MSG', [1002, f.board])
  w.write('MSG', [1003, 'Param space used: 1000/3840'])
  for (const [name, value] of Object.entries(f.params)) w.write('PARM', [2000, name, value, value])
  w.write('PARM', [2000, 'STAT_FLTTIME', f.flight[0], 0])
  if (f.watchdog === true) w.write('WDOG', [3000, -2, 0, 0, 0, 0, 0, 0, 1234, 3, 0x08001234, 182, 0, 0, 'main'])
  for (let k = 0; k < 40; k++) {
    const t = 1_000_000 + k * 500_000
    const lat = -353632621 + Math.round(2000 * Math.sin(k / 6) * (f.week % 7))
    const lng = 1491652374 + Math.round(2000 * Math.cos(k / 6) * (f.week % 5))
    w.write('GPS', [t, 0, 3, f.ms + k * 500, f.week, 14, 0.8, lat, lng, 584, 3, 0, 0, 0, 1])
    w.write('POS', [t + 1, lat, lng, 584 + (k > 4 && k < 36 ? 15 : 0), 0, 0])
  }
  w.write('PARM', [21_000_000, 'STAT_FLTTIME', f.flight[1], 0])
  return w.toBytes()
}

const copter = 'ArduCopter V4.6.3 (92b0cd78)'
const plane = 'ArduPlane V4.5.7 (2a3dc4b7)'
const base = { ATC_RAT_RLL_P: 0.135, ATC_RAT_PIT_P: 0.135, INS_GYRO_FILTER: 40, ARMING_CHECK: 1 }

const FLIGHTS: [string, Flight][] = [
  [
    'cube/00000012.BIN',
    {
      banner: copter,
      board: 'CubeOrange 0033003A 3433510B 34303639',
      week: 2310,
      ms: 300_000_000,
      flight: [100, 520],
      params: base
    }
  ],
  [
    'cube/00000013.BIN',
    {
      banner: copter,
      board: 'CubeOrange 0033003A 3433510B 34303639',
      week: 2311,
      ms: 100_000_000,
      flight: [520, 910],
      params: { ...base, ATC_RAT_RLL_P: 0.15, INS_GYRO_FILTER: 60 }
    }
  ],
  [
    'cube/00000014.BIN',
    {
      banner: copter,
      board: 'CubeOrange 0033003A 3433510B 34303639',
      week: 2312,
      ms: 200_000_000,
      flight: [910, 910],
      params: { ...base, ATC_RAT_RLL_P: 0.15, INS_GYRO_FILTER: 60, ARMING_CHECK: 0 }
    }
  ],
  [
    'matek/00000003.BIN',
    {
      banner: plane,
      board: 'MatekH743 00450041 31335111 30383632',
      week: 2309,
      ms: 50_000_000,
      flight: [3600, 5400],
      params: { RLL_RATE_P: 0.8, PTCH_RATE_P: 0.9 },
      watchdog: true
    }
  ],
  [
    'matek/00000004.BIN',
    {
      banner: plane,
      board: 'MatekH743 00450041 31335111 30383632',
      week: 2313,
      ms: 400_000_000,
      flight: [5400, 6100],
      params: { RLL_RATE_P: 0.9, PTCH_RATE_P: 0.9 }
    }
  ],
  [
    'pixhawk6x/00000001.BIN',
    { banner: copter, board: 'Pixhawk6X 002A0031 3133510D 37383432', week: 2314, ms: 10_000_000, flight: [0, 300], params: base }
  ]
]

describe('UI audit fixtures', () => {
  const built = FLIGHTS.map(([name, f]) => [name.replace('/', '-'), build(f)] as const)
  if (process.env.WRITE_UI_FIXTURE === '1') {
    mkdirSync(dir, { recursive: true })
    for (const [name, bytes] of built) writeFileSync(resolve(dir, name), bytes)
  }

  it.each(built)('%s matches its builder and summarises', (name, bytes) => {
    const path = resolve(dir, name)
    expect(existsSync(path)).toBe(true)
    expect(new Uint8Array(readFileSync(path))).toEqual(bytes)
    const result = readLogSummary(bytes.slice().buffer)
    expect(result.ok && result.summary.version.flightController !== undefined).toBe(true)
  })
})
