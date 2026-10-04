import { describe, expect, it } from 'vitest'
import { DataflashLog } from '@apwt/dataflash'
import { defaultPageValues, filterParamsFromPage, pageValuesFromLog } from './page-values.js'
import type { GyroData } from './gyro-data.js'
import { readGyroSensors } from './gyro-sensors.js'
import { loadFilterReviewLog } from './load.js'
import { loadFromBatch } from './load-batch.js'
import { expectArrayClose } from './test-utils/compare.js'
import { LogAppender, appendBatchGyro, appendRawGyro, appendTrackingMessages, fixture, patchParam } from './test-utils/logs.js'
import { upstreamLoadGyro, type UpstreamGyro } from './test-utils/upstream-load.js'
import { loadFilterReviewUpstream, parseWithUpstream } from './test-utils/upstream.js'

function expectSameGyro(mine: GyroData, theirs: UpstreamGyro): void {
  expect(mine.type).toBe(theirs.type)
  expect(mine.quantizationNoise).toBe(theirs.quantization_noise)
  expect(mine.startTime).toBe(theirs.start_time)
  expect(mine.endTime).toBe(theirs.end_time)
  expect(mine.instances.length).toBe(theirs.instances.length)
  mine.instances.forEach((inst, i) => {
    const other = theirs.instances[i]
    if (inst === null || other == null) {
      expect(inst, `instance ${i}`).toBeNull()
      expect(other ?? null, `instance ${i}`).toBeNull()
      return
    }
    expect(inst.sensorNum).toBe(other.sensor_num)
    expect(inst.postFilter).toBe(other.post_filter)
    expect(inst.gyroRate).toBe(other.gyro_rate)
    expect(inst.batches.length).toBe(other.batches.length)
    inst.batches.forEach((b, j) => {
      const o = other.batches[j]!
      expect(b.sampleTime).toBe(o.sample_time)
      expect(b.sampleRate).toBe(o.sample_rate)
      expectArrayClose(b.x, o.x, `inst ${i} batch ${j} x`)
      expectArrayClose(b.y, o.y, `inst ${i} batch ${j} y`)
      expectArrayClose(b.z, o.z, `inst ${i} batch ${j} z`)
    })
  })
}

describe('real fixture logs', () => {
  it.each(['copter-sitl.bin', 'copter-files.bin'])('%s has no gyro batch or raw data', (name) => {
    expect(() => loadFilterReviewLog(fixture(name))).toThrow('No batch data or raw IMU found in log')
  })

  it.each(['copter-sitl.bin', 'copter-files.bin'])('%s filter params and sensors match upstream', async (name) => {
    const bytes = fixture(name)
    const log = DataflashLog.parse(bytes)
    const params = filterParamsFromPage(pageValuesFromLog(defaultPageValues(), log), true)
    expect(params.gyroFilter).toBe(20)
    expect(params.loopRate).toBe(400)
    expect(params.notches[0].enable).toBe(0)
    // HNTCH params other than ENABLE are not logged while disabled: reset() defaults apply
    expect(params.notches[0].freq).toBe(80)

    const up = loadFilterReviewUpstream()
    const gyro = upstreamLoadGyro(up, await parseWithUpstream(bytes), null)
    const sensors = readGyroSensors(log)
    expect(sensors.numGyro).toBe(gyro.num_gyro)
    expect(sensors.gyroRate.length).toBe(gyro.gyro_rate.length)
    sensors.gyroRate.forEach((r, i) => expect(r).toBe(gyro.gyro_rate[i] ?? undefined))
    expect(sensors.numGyro).toBe(2)
  })
})

describe('raw GYR loading', () => {
  const build = (): Uint8Array => {
    const log = new LogAppender(fixture('copter-sitl.bin'))
    appendRawGyro(log, [0, 1], 10, 20, 1000)
    appendTrackingMessages(log, 8, 40)
    return log.toBytes()
  }

  it('matches upstream load_from_raw_log', async () => {
    const bytes = build()
    const loaded = loadFilterReviewLog(bytes)
    // Compared with upstream with the proven raw-loading fixes (docs/bug-proofs/filter-review.md,
    // rows 2 and 3); the original drops samples on instance 1 and takes its rate from IMU 1.
    const theirs = upstreamLoadGyro(loadFilterReviewUpstream({ fixed: true }), await parseWithUpstream(bytes), false)
    expectSameGyro(loaded.gyro, theirs)
    // The 0.5 s gap splits each instance into two batches
    expect(loaded.gyro.instances[0]!.batches.length).toBe(2)
  })

  it('derives the rest of the load state', () => {
    const loaded = loadFilterReviewLog(build())
    expect(loaded.available).toEqual({ batch: false, raw: true })
    expect(loaded.filterVersion).toBe(4)
    expect(loaded.numGyro).toBe(2)
    expect(loaded.havePre).toBe(true)
    expect(loaded.havePost).toBe(false)
    expect(loaded.primaryGyro).toBe(0)
    expect(loaded.primaryFromEkf).toBe(true)
    expect(loaded.timeRange.dataStart).toBe(10)
    expect(loaded.timeRange.dataEnd).toBe(Math.ceil(loaded.gyro.endTime))
    // Throttle is positive across the whole gyro span, so the data span is kept
    expect(loaded.timeRange.start).toBe(10)
    expect(loaded.timeRange.end).toBe(loaded.timeRange.dataEnd)
    expect(loaded.loggedNotches.map((l) => l.harmonics)).toEqual([3, 3])
    expect(loaded.flight.roll?.time.length).toBeGreaterThan(0)
    expect(loaded.targets.esc.haveData()).toBe(true)
  })

  it('splits pre/post instances with INS_RAW_LOG_OPT bit 3', async () => {
    const log = new LogAppender(patchParam(fixture('copter-sitl.bin'), 'INS_RAW_LOG_OPT', 8))
    appendRawGyro(log, [0, 1, 2, 3], 10, 14, 800)
    const bytes = log.toBytes()
    const loaded = loadFilterReviewLog(bytes)
    expect(loaded.gyro.instances.map((g) => g && [g.sensorNum, g.postFilter])).toEqual([
      [0, false],
      [1, false],
      [0, true],
      [1, true]
    ])
    expect(loaded.havePost).toBe(true)
    // Proven upstream bugs fixed (docs/bug-proofs/filter-review.md, rows 2 and 3): the original drops
    // the last `instance` samples of each raw batch (slice to `j - i`) and looks the reported rate up
    // by logged instance; every instance now keeps its samples and post-filter instances use their
    // sensor's rate.
    const original = upstreamLoadGyro(loadFilterReviewUpstream(), await parseWithUpstream(bytes), false)
    expect(original.instances[0]!.batches[0]!.x.length - original.instances[3]!.batches[0]!.x.length).toBe(3)
    expect(loaded.gyro.instances[0]!.batches[0]!.x.length - loaded.gyro.instances[3]!.batches[0]!.x.length).toBe(0)
    expect(loaded.gyro.instances[2]!.gyroRate).toBe(loaded.gyro.instances[0]!.gyroRate)
    expectSameGyro(
      loaded.gyro,
      upstreamLoadGyro(loadFilterReviewUpstream({ fixed: true }), await parseWithUpstream(bytes), false)
    )
  })
})

describe('batch ISBH/ISBD loading', () => {
  it('matches upstream load_from_batch with pre+post logging', async () => {
    const log = new LogAppender(patchParam(fixture('copter-sitl.bin'), 'INS_LOG_BAT_OPT', 4))
    log.param('INS_LOG_BAT_OPT', 0) // a later change is ignored, as upstream
    appendBatchGyro(log, [0, 1, 2, 3], 10, 6, 1024, 1000)
    const bytes = log.toBytes()
    const loaded = loadFilterReviewLog(bytes)
    expect(loaded.available).toEqual({ batch: true, raw: false })
    expect(loaded.gyro.instances.map((g) => g && [g.sensorNum, g.postFilter])).toEqual([
      [0, false],
      [1, false],
      [0, true],
      [1, true]
    ])
    expect(loaded.warnings.some((w) => w.startsWith('Ignoring param change INS_LOG_BAT_OPT'))).toBe(true)
    const up = loadFilterReviewUpstream()
    expectSameGyro(loaded.gyro, upstreamLoadGyro(up, await parseWithUpstream(bytes), true))
  })

  it('assumes pre+post when instances exceed the gyro count', async () => {
    const log = new LogAppender(fixture('copter-sitl.bin'))
    appendBatchGyro(log, [0, 2], 10, 3, 512, 1000)
    const bytes = log.toBytes()
    const loaded = loadFilterReviewLog(bytes)
    expect(loaded.warnings).toContain('Got pre-post instances without INS_LOG_BAT_OPT set, assuming pre-post')
    const up = loadFilterReviewUpstream()
    expectSameGyro(loaded.gyro, upstreamLoadGyro(up, await parseWithUpstream(bytes), true))
    expect(up.alerts).toContain('Got pre-post instances without INS_LOG_BAT_OPT set, assuming pre-post')
  })

  it('aborts on a missing data message', () => {
    const log = new LogAppender(fixture('copter-sitl.bin'))
    appendBatchGyro(log, [0], 10, 2, 512, 1000)
    // A header with a count that the following data does not satisfy
    log.write('ISBH', [12_000_000, 99, 1, 0, 1000, 1024, 12_000_000, 1000])
    log.write('ISBD', [12_000_001, 99, 1, new Array(32).fill(0), new Array(32).fill(0), new Array(32).fill(0)])
    const parsed = DataflashLog.parse(log.toBytes())
    const warnings: string[] = []
    const gyro = loadFromBatch(parsed, { numGyro: 2, gyroRate: [], warn: (m) => warnings.push(m) })
    expect(gyro).toBeNull()
    expect(warnings).toContain('Missing or extra data msg')
    expect(() => loadFilterReviewLog(parsed)).toThrow('No valid gyro data found in log')
  })

  it('always uses raw data when both are logged (upstream reset() ticks "Raw sensor")', () => {
    const log = new LogAppender(fixture('copter-sitl.bin'))
    appendBatchGyro(log, [0], 10, 2, 512, 1000)
    appendRawGyro(log, [0], 10, 12, 1000)
    const bytes = log.toBytes()
    expect(loadFilterReviewLog(bytes).gyro.type).toBe('raw')
  })
})
