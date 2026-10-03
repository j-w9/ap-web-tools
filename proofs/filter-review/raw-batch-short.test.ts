import { describe, expect, it } from 'vitest'
import { fakeLog, loadPage, ramp } from './_harness.js'

// Row: "Raw batches lose their last `i` samples on instance `i`".
describe('FilterReview load_from_raw_log: two GYR instances with identical samples', () => {
  it('gives instance 1 one sample fewer than instance 0', () => {
    const page = loadPage()
    const samples = { SampleUS: ramp(100, 0, 1000), GyrX: ramp(100, 0, 1), GyrY: ramp(100, 0, 1), GyrZ: ramp(100, 0, 1) }
    page.set('__log', fakeLog({ params: {}, instances: { GYR: { '0': samples, '1': samples } } }))
    const out = page.run(`(() => {
      load_from_raw_log(__log, 2, [], (name, allow_change) => get_param_value(__log.get("PARM"), name, allow_change))
      return Gyro_batch.map((g) => ({ sensor_num: g.sensor_num, rate: g[0].sample_rate, x: g[0].x.length, y: g[0].y.length, z: g[0].z.length }))
    })()`)
    expect(out).toEqual([
      { sensor_num: 0, rate: 1e6 / (98000 / 99), x: 99, y: 99, z: 99 },
      { sensor_num: 1, rate: 1e6 / (98000 / 99), x: 98, y: 98, z: 98 }
    ])
  })
})
