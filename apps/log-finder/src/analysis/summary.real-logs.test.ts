/**
 * Real-log oracle (gated): the port against upstream LogFinder.js (run in a vm with the upstream
 * JsDataflashParser) on every `.bin` in `APWT_REAL_LOGS`. Per log: every `load_log` summary field and
 * the map tooltip's polyline. Across the logs, as one scanned folder: `get_param_diff` between
 * neighbours, and each board's table (row order, per-row and total parameter diffs) after every
 * header click, as the fixture oracle tests compare them. Skipped when `APWT_REAL_LOGS` is not set.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { DataflashLog } from '@apwt/dataflash'
import { REAL_LOG_TIMEOUT_MS, readRealLog, realLogDir, realLogFiles, yieldToEventLoop } from '@apwt/dataflash/testing'
import { ALL_PARAM_IGNORE_KEYS, PARAM_IGNORE_RULES, paramDiff, type ParamIgnoreKey } from './param-diff.js'
import { flightPathLatLngs, readLogSummary, type LogSummary } from './summary.js'
import { groupByBoard, type ScannedLog, type SortKey } from './table.js'
import { compareClicks, diffRecord } from './test-utils/table-compare.js'
import { loadUpstreamLogFinder, type UpstreamLogFinder } from './test-utils/upstream.js'

const files = realLogFiles()

describe.skipIf(realLogDir === undefined)('real logs: Log Finder oracle', () => {
  let up: UpstreamLogFinder
  const scanned: ScannedLog<string>[] = []

  beforeAll(async () => {
    up = await loadUpstreamLogFinder()
  })

  const setChecks = (on: ReadonlySet<ParamIgnoreKey>) => {
    up.param_diff_ignore.forEach((rule, i) => {
      rule.check.checked = on.has(PARAM_IGNORE_RULES[i]!.key)
    })
  }

  for (const file of files) {
    it(
      `${file}: matches every load_log summary field and the map tooltip points`,
      async () => {
        const buffer = readRealLog(file)
        const result = readLogSummary(buffer)
        const theirs = up.load_log(readRealLog(file))
        expect(theirs).toBeDefined()
        expect(result.ok).toBe(true)
        if (theirs === undefined || !result.ok) return
        const mine: LogSummary = result.summary
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
        await yieldToEventLoop()

        expect(flightPathLatLngs(DataflashLog.parse(buffer))).toEqual(up.map_latlngs(readRealLog(file)))
        scanned.push({ relativePath: file, name: file, file, summary: mine })
      },
      REAL_LOG_TIMEOUT_MS
    )
  }

  it.each([
    ['all ignored', new Set(ALL_PARAM_IGNORE_KEYS)],
    ['none ignored', new Set<ParamIgnoreKey>()],
    ['stats only', new Set<ParamIgnoreKey>(['stats'])]
  ])('get_param_diff matches between neighbouring logs, %s', (_label, ignored) => {
    expect(scanned.length).toBe(files.length)
    setChecks(ignored)
    for (let i = 1; i < scanned.length; i++) {
      const a = scanned[i - 1]!.summary.params
      const b = scanned[i]!.summary.params
      expect(diffRecord(paramDiff(b, a, ignored)), scanned[i]!.name).toEqual(
        up.get_param_diff(Object.fromEntries(b), Object.fromEntries(a))
      )
      expect(diffRecord(paramDiff(a, b, ignored)), `${scanned[i]!.name} reversed`).toEqual(
        up.get_param_diff(Object.fromEntries(a), Object.fromEntries(b))
      )
    }
  })

  const CLICKS: readonly (readonly SortKey[])[] = [
    ['date', 'date'],
    ['name', 'name'],
    ['size', 'size', 'date'],
    ['firmware', 'firmware'],
    ['flightTime', 'flightTime'],
    ['distance', 'distance', 'name'],
    ['size', 'flightTime', 'name', 'flightTime']
  ]

  it.each([
    ['all ignored', new Set(ALL_PARAM_IGNORE_KEYS)],
    ['none ignored', new Set<ParamIgnoreKey>()]
  ])(
    'every board table matches after each header click, %s',
    async (_label, ignored) => {
      expect(scanned.length).toBe(files.length)
      setChecks(ignored)
      for (const group of groupByBoard(scanned)) {
        for (const clicks of CLICKS) {
          // Flight Time sorts as numbers in the port (proven upstream bug, docs/bug-proofs/log-finder.md).
          await compareClicks(up, group.logs, group.board, clicks, ignored, true)
        }
      }
    },
    REAL_LOG_TIMEOUT_MS
  )
})
