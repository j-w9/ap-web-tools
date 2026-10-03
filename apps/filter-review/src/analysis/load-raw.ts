import { US_TO_S, type DataflashLog, type NumericColumn } from '@apwt/dataflash'
import { MAX_GYROS } from './constants.js'
import type { GyroBatch, GyroData, GyroInstance } from './gyro-data.js'
import type { GyroLoadContext } from './load-batch.js'
import { firstParamIgnoringChanges } from './log-params.js'

/** Minimum samples in a raw batch. */
const MIN_BATCH_SAMPLES = 64

/** Copy `column[start, end)` into a Float64Array (typed-array `slice` semantics). */
function slice(column: NumericColumn, start: number, end: number): Float64Array {
  return Float64Array.from(column.slice(start, end))
}

/**
 * Split one GYR instance into continuous batches. A batch ends when the latest sample gap
 * exceeds five times the running mean gap, which should start a new batch after two missed
 * messages. Returns the batches and the mean of their sample rates.
 *
 * Upstream slices the samples to `j - i`, where `i` is the gyro instance number (almost
 * certainly meant to be `j`), so higher instances drop their last `i` samples of every
 * batch. Preserved for parity.
 */
function splitRawBatches(
  instance: number,
  time: NumericColumn,
  gyrX: NumericColumn,
  gyrY: NumericColumn,
  gyrZ: NumericColumn
): { batches: GyroBatch[]; meanRate: number } {
  const batches: GyroBatch[] = []
  let sampleRateSum = 0
  let sampleRateCount = 0
  let batchStart = 0
  let count = 0
  const len = time.length
  for (let j = 1; j < len; j++) {
    count++
    if ((time[j]! - time[j - 1]!) * count > (time[j]! - time[batchStart]!) * 5 || j === len - 1) {
      if (count >= MIN_BATCH_SAMPLES) {
        // Must have at least 64 samples in each batch
        const sampleRate = 1000000 / ((time[j - 1]! - time[batchStart]!) / count)
        sampleRateSum += sampleRate
        sampleRateCount++
        const end = j - instance
        batches.push({
          sampleTime: time[batchStart]! * US_TO_S,
          sampleRate,
          x: slice(gyrX, batchStart, end),
          y: slice(gyrY, batchStart, end),
          z: slice(gyrZ, batchStart, end)
        })
      }
      // Start the next batch from this point
      batchStart = j
      count = 0
    }
  }
  return { batches, meanRate: sampleRateSum / sampleRateCount }
}

/** Load gyro data from raw `GYR` sensor logging (upstream `load_from_raw_log`). */
export function loadFromRaw(log: DataflashLog, ctx: GyroLoadContext): GyroData {
  // Work out if logging is pre/post from param value
  const rawOpt = firstParamIgnoringChanges(log, 'INS_RAW_LOG_OPT', ctx.warn)
  let postFilter = rawOpt !== undefined && (rawOpt & (1 << 2)) !== 0
  const prePostFilter = rawOpt !== undefined && (rawOpt & (1 << 3)) !== 0
  if (postFilter && prePostFilter) {
    ctx.warn('Both post and pre+post logging option selected')
    postFilter = false
  }

  // Load in one massive batch per instance, split for large gaps in log
  const instances: (GyroInstance | null)[] = []
  for (const i of log.instances('GYR')) {
    instances[i] = null
    const post = prePostFilter && i >= ctx.numGyro
    const sensorNum = post ? i - ctx.numGyro : i
    // Only support 3 IMUs for now
    if (sensorNum >= MAX_GYROS) continue

    const time = log.getNumbers('GYR', 'SampleUS', i)
    const gyrX = log.getNumbers('GYR', 'GyrX', i)
    const gyrY = log.getNumbers('GYR', 'GyrY', i)
    const gyrZ = log.getNumbers('GYR', 'GyrZ', i)
    if (!time || !gyrX || !gyrY || !gyrZ) continue

    const { batches, meanRate } = splitRawBatches(i, time, gyrX, gyrY, gyrZ)
    // No valid batches, remove
    if (batches.length === 0) continue

    // Assume a constant sample rate for the FFT. Upstream indexes the reported rate by the
    // logged instance rather than the sensor number; preserved.
    let gyroRate = meanRate
    const reported = ctx.gyroRate[i]
    if (reported !== undefined) gyroRate = Math.max(reported, gyroRate)

    instances[i] = { index: i, batches, sensorNum, postFilter: post ? true : postFilter, gyroRate }
  }
  for (let i = 0; i < instances.length; i++) instances[i] ??= null

  let startTime: number | undefined
  let endTime: number | undefined
  for (const inst of instances) {
    if (inst === null) continue
    const batchStart = inst.batches[0]!.sampleTime
    if (startTime === undefined || batchStart < startTime) startTime = batchStart
    const last = inst.batches[inst.batches.length - 1]!
    const batchEnd = last.sampleTime + last.x.length / last.sampleRate
    if (endTime === undefined || batchEnd > endTime) endTime = batchEnd
  }

  // Quantisation noise of 32-bit floats is relative to the signal level, which is unknown, so
  // upstream assumes none.
  return { type: 'raw', quantizationNoise: 0.0, instances, startTime, endTime }
}
