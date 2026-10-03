// Test-only: run the gyro loading part of upstream `load()` in a vm instance.
import type { UpstreamFilterReview, UpstreamLog } from './upstream.js'

/** Upstream `Gyro_batch` entry as plain data. */
export interface UpstreamGyroInstance {
  batches: { sample_time: number; sample_rate: number; x: ArrayLike<number>; y: ArrayLike<number>; z: ArrayLike<number> }[]
  sensor_num: number
  post_filter: boolean
  gyro_rate: number
}

/** Upstream `Gyro_batch` as plain data. */
export interface UpstreamGyro {
  instances: (UpstreamGyroInstance | null)[]
  start_time: number | undefined
  end_time: number | undefined
  quantization_noise: number
  type: string
  num_gyro: number
  gyro_rate: (number | null)[]
}

/** Load gyro data with upstream `load_from_batch` (true) / `load_from_raw_log` (false), or only read the sensors (null). */
export function upstreamLoadGyro(up: UpstreamFilterReview, log: UpstreamLog, batch: boolean | null): UpstreamGyro {
  up.set('__log', log)
  return up.run(`(() => {
    const PARM = __log.get("PARM")
    function get_param(name, allow_change) { return get_param_value(PARM, name, allow_change) }
    var num_gyro = 0
    var gyro_rate = []
    for (let i = 0; i < 3; i++) {
      const ID_param = i == 0 ? "INS_GYR_ID" : "INS_GYR" + (i + 1) + "_ID"
      const ID = get_param(ID_param)
      if ((ID != null) && (ID > 0)) {
        if (("IMU" in __log.messageTypes) && ("instances" in __log.messageTypes.IMU) && (i in __log.messageTypes.IMU.instances)) {
          gyro_rate[i] = array_mean(__log.get_instance("IMU", i, "GHz"))
        }
        num_gyro++
      }
    }
    ${batch === null ? 'Gyro_batch = []' : (batch ? 'load_from_batch' : 'load_from_raw_log') + '(__log, num_gyro, gyro_rate, get_param)'}
    const instances = []
    for (let i = 0; i < Gyro_batch.length; i++) {
      const g = Gyro_batch[i]
      instances.push(g == null ? null : { batches: Array.from(g), sensor_num: g.sensor_num, post_filter: g.post_filter, gyro_rate: g.gyro_rate })
    }
    return { instances, start_time: Gyro_batch.start_time, end_time: Gyro_batch.end_time,
             quantization_noise: Gyro_batch.quantization_noise, type: Gyro_batch.type, num_gyro, gyro_rate }
  })()`) as UpstreamGyro
}
