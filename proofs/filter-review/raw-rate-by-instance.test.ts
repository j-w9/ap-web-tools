import { describe, expect, it } from 'vitest'
import { fakeLog, loadPage, ramp } from './_harness.js'

// Row: "Raw-log rate looked up by log instance, not sensor".
describe('FilterReview load_from_raw_log: one gyro logged pre and post filter (INS_RAW_LOG_OPT bit 3)', () => {
  it('raises the pre-filter instance to the IMU rate but not the post-filter instance of the same sensor', () => {
    const page = loadPage()
    const samples = { SampleUS: ramp(100, 0, 1000), GyrX: ramp(100, 0, 1), GyrY: ramp(100, 0, 1), GyrZ: ramp(100, 0, 1) }
    page.set('__log', fakeLog({ params: { INS_RAW_LOG_OPT: 8 }, instances: { GYR: { '0': samples, '1': samples } } }))
    // gyro_rate as load() builds it: index = sensor number, value = mean IMU.GHz of that sensor.
    const out = page.run(`(() => {
      load_from_raw_log(__log, 1, [2000], (name, allow_change) => get_param_value(__log.get("PARM"), name, allow_change))
      return Gyro_batch.map((g) => ({ sensor_num: g.sensor_num, post_filter: g.post_filter, gyro_rate: g.gyro_rate }))
    })()`)
    expect(out).toEqual([
      { sensor_num: 0, post_filter: false, gyro_rate: 2000 },
      { sensor_num: 0, post_filter: true, gyro_rate: 1e6 / (98000 / 99) }
    ])
  })
})
