import { beforeAll, describe, expect, it } from 'vitest'
import { DataflashLog } from '@apwt/dataflash'
import { defaultNotchParams, type NotchParams } from '../filter-params.js'
import type { FilterVersion } from '../filter-version.js'
import { expectArrayClose } from '../test-utils/compare.js'
import { LogAppender, appendTrackingMessages, fixture } from '../test-utils/logs.js'
import { loadFilterReviewUpstream, parseWithUpstream, type UpstreamFilterReview } from '../test-utils/upstream.js'
import { eas2tas } from './atmosphere.js'
import { createLoggedNotches, createTrackingTargets, type TrackingTargets } from './targets.js'
import type { NotchTarget, TargetFrequency, TrackingContext } from './target.js'

const UPSTREAM_TARGETS = [
  'new StaticTarget()',
  'new ThrottleTarget(__log)',
  'new RPMTarget(__log, 1, 2)',
  'new ESCTarget(__log)',
  'new FFTTarget(__log)',
  'new RPMTarget(__log, 2, 5)'
]

let targets: TrackingTargets
let up: UpstreamFilterReview
let logged: ReturnType<typeof createLoggedNotches>
const gyroStart = 10
const gyroEnd = 30

beforeAll(async () => {
  const log = new LogAppender(fixture('copter-sitl.bin'))
  appendTrackingMessages(log, 8, 40)
  const bytes = log.toBytes()
  const parsed = DataflashLog.parse(bytes)
  targets = createTrackingTargets(parsed)
  logged = createLoggedNotches(parsed)

  up = loadFilterReviewUpstream()
  up.set('__log', await parseWithUpstream(bytes))
  up.run(`Gyro_batch = { start_time: ${gyroStart}, end_time: ${gyroEnd} }`)
  up.run(`__targets = [${UPSTREAM_TARGETS.join(', ')}]; __logged = [new LoggedNotch(__log, 0), new LoggedNotch(__log, 1)]`)
})

function upstreamParams(p: NotchParams): Record<string, number> {
  return {
    enable: p.enable,
    mode: p.mode,
    freq: p.freq,
    bandwidth: p.bandwidth,
    attenuation: p.attenuation,
    ref: p.ref,
    min_ratio: p.minRatio,
    harmonics: p.harmonics,
    options: p.options
  }
}

/** Upstream `{freq, time}` in the nested-array shape for comparison. */
function toUpstreamShape(t: TargetFrequency | undefined): { freq: unknown; time: unknown } | undefined {
  if (t === undefined) return undefined
  if (!t.multi) return { freq: Array.from(t.series[0]!.freq), time: Array.from(t.series[0]!.time) }
  return { freq: t.series.map((s) => Array.from(s.freq)), time: t.series.map((s) => Array.from(s.time)) }
}

function plain(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_k, v: unknown) => (ArrayBuffer.isView(v) ? Array.from(v as Float64Array) : v))
  ) as unknown
}

const configs: Partial<NotchParams>[] = [
  { ref: 0 },
  { ref: 1 },
  { ref: 0.3, minRatio: 0.6 },
  { ref: 1, options: 2 },
  { ref: 0.2, options: 2, freq: -90 }
]
const versions: FilterVersion[] = [1, 2, 4]

describe('tracking targets match upstream', () => {
  it('has data for every source in the augmented log', () => {
    expect(targets.all.map((t) => t.modeValue)).toEqual([0, 1, 2, 3, 4, 5])
    expect(targets.esc.motors.length).toBe(4)
    expect(targets.throttle.motors.length).toBe(4)
    expect(targets.fft.peaks.length).toBe(3)
    expect(logged.map((l) => l.haveData())).toEqual([true, true])
  })

  for (const version of versions) {
    for (const [ci, partial] of configs.entries()) {
      it(`targets, interpolation and means agree (v${version}, config ${ci})`, () => {
        const config: NotchParams = { ...defaultNotchParams(), enable: 1, ...partial }
        const ctx: TrackingContext = { filterVersion: version, gyroStartTime: gyroStart, gyroEndTime: gyroEnd }
        up.run(`filter_version = ${version}`)
        up.set('__config', upstreamParams(config))
        const time = Array.from({ length: 200 }, (_, i) => 5 + i * 0.21)
        up.set('__time', time)

        targets.all.forEach((target: NotchTarget, k) => {
          const label = `${target.name} v${version} c${ci}`
          const theirHave = up.run(`__targets[${k}].have_data(__config)`) as boolean
          expect(target.haveData(config, version), `${label} haveData`).toBe(theirHave)
          if (!theirHave) return

          const theirs = up.run(`__targets[${k}].get_target_freq(__config)`)
          expect(plain(toUpstreamShape(target.targetFrequency(config, ctx))), `${label} target`).toEqual(plain(theirs))

          up.run(`__targets[${k}].interpolate(0, __time)`)
          const interp = target.interpolate(time)
          for (let j = 0; j < time.length; j += 7) {
            const theirF = up.run(`__targets[${k}].get_interpolated_target_freq(0, ${j}, __config)`) as number[] | null
            const mine = interp?.frequencies(j, config, version) ?? null
            if (theirF === null) {
              expect(mine, `${label} interp ${j}`).toBeNull()
            } else {
              expectArrayClose(mine ?? undefined, theirF, `${label} interp ${j}`)
            }
          }
        })
      })
    }
  }

  it('means over a time range agree (open-in-filter-tool values)', () => {
    up.element('TimeStart').value = '12'
    up.element('TimeEnd').value = '35'
    const range = { start: 12, end: 35 }
    expect(targets.throttle.mean(range)).toBe(up.run('__targets[1].get_mean()'))
    expect(targets.rpm1.mean(range)).toBe(up.run('__targets[2].get_mean()'))
    expect(targets.esc.mean(range)).toBe(up.run('__targets[3].get_mean()'))
    expect(targets.esc.numMotors).toBe(up.run('__targets[3].get_num_motors()'))
    expect(targets.rpm2.mean(range)).toBe(up.run('__targets[5].get_mean()'))
  })

  it('logged notch frequencies agree', () => {
    // FTNS (instance 0): one series
    expect(plain(toUpstreamShape(logged[0].targetFrequency())), 'logged 0').toEqual(
      plain(up.run('__logged[0].get_target_freq()'))
    )
    // FTN (instance 1): upstream shares one time array between the notches; each series carries it here
    const theirs = plain(up.run('__logged[1].get_target_freq()')) as { freq: number[][]; time: number[] }
    const mine = logged[1].targetFrequency()!
    expect(mine.multi).toBe(true)
    expect(mine.series.map((s) => Array.from(s.freq))).toEqual(theirs.freq)
    for (const s of mine.series) expect(Array.from(s.time)).toEqual(theirs.time)
  })

  it('reports multi-source throttle errors like upstream', () => {
    const config = { ...defaultNotchParams(), enable: 1, options: 2 }
    up.set('__config', upstreamParams(config))
    up.run('filter_version = 1')
    expect(targets.throttle.haveData(config, 1)).toBe(false)
    expect(targets.throttle.noDataError(config, 1)).toBe('Multi-Source throttle notch only available on filter V2+')
  })
})

describe('atmosphere model', () => {
  it('matches upstream get_EAS2TAS', () => {
    const fresh = loadFilterReviewUpstream()
    for (const alt of [-3000, 0, 584, 5000, 11000, 15000, 25000, 40000, 49000, 60000, 80000, 90000]) {
      expect(eas2tas(alt), `alt ${alt}`).toBe(fresh.run(`get_air_density_model().get_EAS2TAS(${alt})`))
    }
  })
})
