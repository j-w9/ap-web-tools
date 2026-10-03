/**
 * Oracle tests: the port against upstream LogFinder.js run in a vm on the same fixture logs.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { DataflashLog } from '@apwt/dataflash'
import { ALL_PARAM_IGNORE_KEYS, PARAM_IGNORE_RULES, paramDiff, type ParamDiff, type ParamIgnoreKey } from './param-diff.js'
import { paramFileText, paramToString } from './param-format.js'
import { readLogSummary, type LogSummary } from './summary.js'
import { FIXTURES, loadUpstreamLogFinder, readFixture, type UpstreamDiff, type UpstreamLogFinder } from './test-utils/upstream.js'

let up: UpstreamLogFinder
beforeAll(async () => {
  up = await loadUpstreamLogFinder()
})

function summary(name: string): LogSummary {
  const result = readLogSummary(readFixture(name))
  if (!result.ok) throw new Error(`${name}: ${result.reason}`)
  return result.summary
}

function asRecord(diff: ParamDiff): UpstreamDiff {
  return {
    added: Object.fromEntries(diff.added),
    missing: Object.fromEntries(diff.missing),
    changed: Object.fromEntries([...diff.changed].map(([k, v]) => [k, { ...v }]))
  }
}

describe.each(FIXTURES)('load_log oracle: %s', (name) => {
  it('matches every upstream summary field', () => {
    const mine = summary(name)
    const theirs = up.load_log(readFixture(name))
    expect(theirs).toBeDefined()
    if (theirs === undefined) return
    expect(mine.sizeBytes).toBe(theirs.size)
    expect(mine.version.fwString).toBe(theirs.fw_string)
    expect(mine.version.fwHash).toBe(theirs.git_hash)
    expect(mine.version.boardId).toBe(theirs.board_id)
    expect(mine.version.flightController).toBe(theirs.fc_string)
    expect(mine.version.osString).toBe(theirs.os_string)
    expect(mine.version.buildType).toBe(theirs.build_type)
    expect(mine.boardName).toBe(theirs.board_name)
    expect(Object.fromEntries(mine.params)).toEqual(theirs.params)
    expect(mine.startTime?.getTime()).toBe(theirs.time_stamp?.getTime())
    expect(mine.flightTimeS).toBe(theirs.flight_time)
    expect(mine.watchdog).toBe(theirs.watchdog)
    // Upstream leaves crash_dump undefined without FILE messages; only its truthiness is used.
    expect(mine.crashDump).toBe(theirs.crash_dump === true)
    expect(mine.distanceM ?? null).toBe(theirs.distance_traveled)
    expect([...mine.messageTypes].sort()).toEqual([...theirs.available_log_messages].sort())
  })
})

describe('get_param_diff oracle', () => {
  const setChecks = (on: ReadonlySet<ParamIgnoreKey>) =>
    up.param_diff_ignore.forEach((rule, i) => {
      rule.check.checked = on.has(PARAM_IGNORE_RULES[i]!.key)
    })

  it.each([
    ['all ignored', new Set(ALL_PARAM_IGNORE_KEYS)],
    ['none ignored', new Set<ParamIgnoreKey>()],
    ['stats only', new Set<ParamIgnoreKey>(['stats'])]
  ])('matches between the two fixtures, %s', (_label, ignored) => {
    const a = summary('copter-sitl.bin').params
    const b = summary('copter-files.bin').params
    setChecks(ignored)
    expect(asRecord(paramDiff(b, a, ignored))).toEqual(up.get_param_diff(Object.fromEntries(b), Object.fromEntries(a)))
    expect(asRecord(paramDiff(a, b, ignored))).toEqual(up.get_param_diff(Object.fromEntries(a), Object.fromEntries(b)))
  })

  it('ignore rules match the same names as upstream', () => {
    const names = [
      ...summary('copter-sitl.bin').params.keys(),
      ...summary('copter-files.bin').params.keys(),
      'INS4_GYR2OFFS_Z',
      'INS_GYR3_CALTEMP',
      'BARO3_GND_PRESS',
      'ARSPD2_OFFSET',
      'SR12_EXTRA3',
      'MAV3_ADSB',
      'MAV3_RAW_SENS',
      'SYS_NUM_RESETS',
      'COMPASS_DEC',
      'X_INS_GYROFFS_X'
    ]
    expect(up.param_diff_ignore.map((r) => r.name)).toEqual(PARAM_IGNORE_RULES.map((r) => r.label))
    PARAM_IGNORE_RULES.forEach((rule, i) => {
      const theirs = up.param_diff_ignore[i]!
      for (const n of names) expect(rule.matches(n), `${rule.key} ${n}`).toBe(theirs.fun(n))
    })
  })
})

describe('param helpers oracle', () => {
  it('param_to_string matches on fixture and awkward values', () => {
    const values = [...summary('copter-files.bin').params.values(), 0.1, 1 / 3, -2.5e-7, 123456789, 3.4e38, Math.PI, -0]
    for (const v of values) expect(paramToString(v)).toBe(up.param_to_string(v))
  })

  it('param file text matches get_param_download_text', () => {
    const params = summary('copter-sitl.bin').params
    expect(paramFileText(params)).toBe(up.get_param_download_text(Object.fromEntries(params)))
  })
})

describe('summary edge cases', () => {
  it('reports non-logs instead of throwing', () => {
    expect(readLogSummary(new ArrayBuffer(0))).toEqual({ ok: false, reason: 'not-a-log' })
    expect(readLogSummary(new Uint8Array([1, 2, 3, 4, 5]).buffer)).toEqual({ ok: false, reason: 'not-a-log' })
  })

  it('extracts board and vehicle from the boot messages', () => {
    const s = summary('copter-files.bin')
    expect(s.vehicle).toBe('copter')
    expect(s.version.flightController).toMatch(/^BROTHERHOBBYH743/)
    expect(s.distanceM).toBeUndefined()
    expect(DataflashLog.parse(readFixture('copter-files.bin')).has('FILE')).toBe(true)
  })
})
