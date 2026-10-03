import { US_TO_S, type DataflashLog } from '@apwt/dataflash'
import { arrayScale } from '@apwt/signal'
import { MAX_GYROS } from './constants.js'
import type { GyroBatch, GyroData, GyroInstance } from './gyro-data.js'
import { firstParamIgnoringChanges } from './log-params.js'

/** IMU batch sensor type of a gyro in `ISBH.type`. */
const IMU_SENSOR_TYPE_GYRO = 1

/** Samples per ISBD message. */
const SAMPLES_PER_MESSAGE = 32

/**
 * Quantisation noise of the 16-bit batch samples (white noise model, 1 / (sqrt(3) * 2^(N - 0.5))).
 * See "Taking the Mystery out of the Infamous Formula, SNR = 6.02N + 1.76dB" (Analog Devices).
 */
export const BATCH_QUANTIZATION_NOISE = 1 / (Math.sqrt(3) * 2 ** (16 - 0.5))

/** Context shared by the two gyro loaders. */
export interface GyroLoadContext {
  /** Number of configured gyros. */
  readonly numGyro: number
  /** Mean `IMU.GHz` per IMU number. */
  readonly gyroRate: readonly (number | undefined)[]
  /** Collects messages upstream shows as alerts or console logs. */
  readonly warn: (message: string) => void
}

function numbers(log: DataflashLog, msg: string, field: string): ArrayLike<number> | undefined {
  return log.getNumbers(msg, field)
}

function int16Arrays(log: DataflashLog, msg: string, field: string): readonly ArrayLike<number>[] | undefined {
  const col = log.get(msg, field)
  if (col === undefined || ArrayBuffer.isView(col)) return undefined
  return col as readonly ArrayLike<number>[]
}

/**
 * Load gyro data from batch sampling messages `ISBH` / `ISBD` (upstream `load_from_batch`).
 * Returns `null` when the batches are corrupt, as upstream aborts the load in that case.
 */
export function loadFromBatch(log: DataflashLog, ctx: GyroLoadContext): GyroData | null {
  const h = {
    N: numbers(log, 'ISBH', 'N'),
    type: numbers(log, 'ISBH', 'type'),
    instance: numbers(log, 'ISBH', 'instance'),
    mul: numbers(log, 'ISBH', 'mul'),
    smpCnt: numbers(log, 'ISBH', 'smp_cnt'),
    sampleUs: numbers(log, 'ISBH', 'SampleUS'),
    smpRate: numbers(log, 'ISBH', 'smp_rate')
  }
  const d = {
    N: numbers(log, 'ISBD', 'N'),
    seqno: numbers(log, 'ISBD', 'seqno'),
    x: int16Arrays(log, 'ISBD', 'x'),
    y: int16Arrays(log, 'ISBD', 'y'),
    z: int16Arrays(log, 'ISBD', 'z')
  }
  if (!h.N || !h.type || !h.instance || !h.mul || !h.smpCnt || !h.sampleUs || !h.smpRate) return null
  if (!d.N || !d.seqno || !d.x || !d.y || !d.z) return null

  // Assign batches to each sensor; only interested in gyro here
  const batches: (GyroBatch[] | null | undefined)[] = []
  let dataIndex = 0
  let maxInstance = 0
  const numHeaders = h.N.length
  const numData = d.N.length

  headers: for (let i = 0; i < numHeaders; i++) {
    // Parse headers
    if (h.type[i] !== IMU_SENSOR_TYPE_GYRO) continue

    const instance = h.instance[i]!
    if (batches[instance] == null) {
      batches[instance] = []
      maxInstance = Math.max(maxInstance, instance)
    }

    // Advance data index until sequence match
    const seqNum = h.N[i]!
    while (d.N[dataIndex] !== seqNum) {
      dataIndex++
      if (dataIndex >= numData) {
        // This is expected at the end of a log, no more msgs to add
        break headers
      }
    }

    const x: number[] = []
    const y: number[] = []
    const z: number[] = []
    const numSamples = h.smpCnt[i]!
    const numDataMsg = numSamples / SAMPLES_PER_MESSAGE
    for (let j = 0; j < numDataMsg; j++) {
      // Read in expected number of samples
      if (d.N[dataIndex] !== seqNum || d.seqno[dataIndex] !== j) {
        ctx.warn('Missing or extra data msg')
        return null
      }
      // Accumulate data for this batch
      x.push(...Array.from(d.x[dataIndex]!))
      y.push(...Array.from(d.y[dataIndex]!))
      z.push(...Array.from(d.z[dataIndex]!))

      dataIndex++
      if (dataIndex >= numData) {
        ctx.warn(`Sequence incomplete ${i} of ${numHeaders - 1}, Got ${j + 1} batches out of ${numDataMsg}`)
        break headers
      }
    }

    if (x.length !== numSamples || y.length !== numSamples || z.length !== numSamples) {
      ctx.warn('sample length wrong')
      return null
    }

    // Remove logging scale factor
    const mul = 1 / h.mul[i]!
    batches[instance].push({
      sampleTime: h.sampleUs[i]! * US_TO_S,
      sampleRate: h.smpRate[i]!,
      x: arrayScale(x, mul),
      y: arrayScale(y, mul),
      z: arrayScale(z, mul)
    })
  }

  // Work out if logging is pre/post from param value
  const batOpt = firstParamIgnoringChanges(log, 'INS_LOG_BAT_OPT', ctx.warn) ?? 0
  const doingSensorRateLogging = (batOpt & (1 << 0)) !== 0
  const doingPostFilterLogging = (batOpt & (1 << 1)) !== 0
  const doingPrePostFilterLogging = (batOpt & (1 << 2)) !== 0
  let useInstanceOffset = doingPrePostFilterLogging || (doingPostFilterLogging && doingSensorRateLogging)

  if (!useInstanceOffset && maxInstance >= ctx.numGyro) {
    ctx.warn('Got pre-post instances without INS_LOG_BAT_OPT set, assuming pre-post')
    useInstanceOffset = true
  }

  const assigned: ({ batches: GyroBatch[]; sensorNum: number; postFilter: boolean } | null)[] = []
  for (let i = 0; i < batches.length; i++) {
    const b = batches[i]
    // Remove any batches with no data
    if (b == null || b.length === 0) {
      assigned[i] = null
      continue
    }
    const post = useInstanceOffset && i >= ctx.numGyro
    const sensorNum = post ? i - ctx.numGyro : i
    const postFilter = post ? true : doingPostFilterLogging && !doingPrePostFilterLogging
    // Only support 3 IMUs for now
    assigned[i] = sensorNum >= MAX_GYROS ? null : { batches: b, sensorNum, postFilter }
  }

  // Assume sample rate is always higher than logging rate
  const maxLoggingRate: (number | undefined)[] = []
  for (const a of assigned) {
    if (a === null) continue
    for (const batch of a.batches) {
      const current = maxLoggingRate[a.sensorNum]
      if (current === undefined || batch.sampleRate > current) maxLoggingRate[a.sensorNum] = batch.sampleRate
    }
  }

  const instances: (GyroInstance | null)[] = assigned.map((a, index) => {
    if (a === null) return null
    let gyroRate = maxLoggingRate[a.sensorNum]!
    const reported = ctx.gyroRate[a.sensorNum]
    // Make sure rate is at least the reported sampling rate
    if (reported !== undefined) gyroRate = Math.max(reported, gyroRate)
    return { index, batches: a.batches, sensorNum: a.sensorNum, postFilter: a.postFilter, gyroRate }
  })

  // Grab full time range of batches
  let startTime: number | undefined
  let endTime: number | undefined
  for (const inst of instances) {
    if (inst === null) continue
    const batchStart = inst.batches[0]!.sampleTime
    if (startTime === undefined || batchStart < startTime) startTime = batchStart
    const batchEnd = inst.batches[inst.batches.length - 1]!.sampleTime
    if (endTime === undefined || batchEnd > endTime) endTime = batchEnd
  }

  return { type: 'batch', quantizationNoise: BATCH_QUANTIZATION_NOISE, instances, startTime, endTime }
}
