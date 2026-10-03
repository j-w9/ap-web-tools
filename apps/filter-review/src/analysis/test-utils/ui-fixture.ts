// Test-only: a small synthetic batch sampling log for the UI audit (scripts/ui-audit.config.mjs),
// written to apps/filter-review/test-fixtures/ by ui-fixture.test.ts. Two gyros logged pre and
// post filter, flight data, a throttle notch and an FFT notch with logged notch frequencies.
import { LogWriter } from '@apwt/dataflash/testing'
import { rng } from './rng.js'

/** Gyro sample: a throttle-following motor tone, its harmonic, a frame resonance and noise. */
function sample(next: () => number, t: number, axis: number, gyro: number, post: boolean): number {
  const motor = 90 + 30 * throttleAt(t)
  const gain = post ? 0.15 : 1
  const tone = (hz: number, amp: number): number => amp * Math.sin(2 * Math.PI * hz * t + axis + gyro)
  return gain * (tone(motor, 0.5) + tone(2 * motor, 0.15)) + tone(37, 0.04 * (axis + 1)) + 0.02 * (next() - 0.5)
}

/** Throttle out (0..1): ground, climb, hover with a few punches, land. */
function throttleAt(t: number): number {
  if (t < 2 || t > 10) return 0
  return 0.35 + 0.1 * Math.sin(0.8 * t)
}

/** Bytes of the UI audit fixture log. */
export function buildUiFixture(): Uint8Array {
  const w = new LogWriter()
  w.defineFormat(128, 'FMT', 'BBnNZ', 'Type,Length,Name,Format,Columns')
  w.defineFormat(129, 'PARM', 'QNff', 'TimeUS,Name,Value,Default')
  w.defineFormat(130, 'ISBH', 'QHBBHHQf', 'TimeUS,N,type,instance,mul,smp_cnt,SampleUS,smp_rate')
  w.defineFormat(131, 'ISBD', 'QHHaaa', 'TimeUS,N,seqno,x,y,z')
  w.defineFormat(132, 'ATT', 'QccccCCCC', 'TimeUS,DesRoll,Roll,DesPitch,Pitch,DesYaw,Yaw,ErrRP,ErrYaw')
  w.defineFormat(133, 'RATE', 'Qffffffffffff', 'TimeUS,RDes,R,ROut,PDes,P,POut,YDes,Y,YOut,ADes,A,AOut')
  w.defineFormat(134, 'POS', 'QLLfff', 'TimeUS,Lat,Lng,Alt,RelHomeAlt,RelOriginAlt')
  w.defineFormat(135, 'FTN1', 'QBffff', 'TimeUS,I,PkAvg,BwAvg,SnX,SnY')
  w.defineFormat(136, 'FTN', 'QBBfffff', 'TimeUS,I,NDn,NF1,NF2,NF3,NF4,NF5')
  w.defineFormat(137, 'FMTU', 'QBNN', 'TimeUS,FmtType,UnitIds,MultIds')
  w.write('FMTU', [0, 136, 's#-zzzzz', 'F-------'])

  const params: [string, number][] = [
    ['INS_GYR_ID', 3408138],
    ['INS_GYR2_ID', 2818570],
    ['INS_LOG_BAT_OPT', 4],
    ['INS_LOG_BAT_CNT', 512],
    ['INS_GYRO_FILTER', 40],
    ['SCHED_LOOP_RATE', 400],
    ['AHRS_EKF_TYPE', 3],
    ['EK3_PRIMARY', 0],
    ['INS_HNTCH_ENABLE', 1],
    ['INS_HNTCH_MODE', 1],
    ['INS_HNTCH_FREQ', 90],
    ['INS_HNTCH_BW', 40],
    ['INS_HNTCH_ATT', 40],
    ['INS_HNTCH_REF', 0.35],
    ['INS_HNTCH_HMNCS', 3],
    ['INS_HNTCH_OPTS', 0],
    ['INS_HNTCH_FM_RAT', 1],
    ['INS_HNTC2_ENABLE', 1],
    ['INS_HNTC2_MODE', 4],
    ['INS_HNTC2_FREQ', 80],
    ['INS_HNTC2_BW', 30],
    ['INS_HNTC2_ATT', 30],
    ['INS_HNTC2_REF', 1],
    ['INS_HNTC2_HMNCS', 1],
    ['INS_HNTC2_OPTS', 0],
    ['INS_HNTC2_FM_RAT', 1]
  ]
  for (const [name, value] of params) w.write('PARM', [100_000, name, value, value])

  // Flight data and notch sources at 10 Hz
  for (let t = 0.5; t <= 12; t += 0.1) {
    const us = Math.round(t * 1e6)
    const thr = throttleAt(t)
    const flying = thr > 0
    w.write('ATT', [us, 0, flying ? 3 * Math.sin(t) : 0, 0, flying ? 2 * Math.cos(1.3 * t) : 0, 90, 90, 0, 0])
    w.write('RATE', [us, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, thr])
    w.write('POS', [us, -353632621, 1491652374, 584, flying ? Math.min(t - 2, 5) : 0, 0])
    const peak = 90 + 30 * thr
    w.write('FTN1', [us, 0, peak, 20, 1, 1])
    w.write('FTN', [us, 0, 2, peak - 1, 2 * peak - 2, 0, 0, 0])
    w.write('FTN', [us, 1, 1, peak + 1, 0, 0, 0, 0])
  }

  // Batch sampling: 512 samples at 1 kHz once a second; instances 0, 1 pre and 2, 3 post filter
  const next = rng(11)
  const samples = 512
  const rate = 1000
  const mul = 2000
  let seq = 0
  for (let b = 0; b < 10; b++) {
    for (let instance = 0; instance < 4; instance++) {
      const t0 = 1 + b + 0.01 * instance
      const t0Us = Math.round(t0 * 1e6)
      w.write('ISBH', [t0Us, seq, 1, instance, mul, samples, t0Us, rate])
      for (let m = 0; m < samples / 32; m++) {
        const axes = [0, 1, 2].map((axis) =>
          Array.from({ length: 32 }, (_, k) =>
            Math.round(sample(next, t0 + (m * 32 + k) / rate, axis, instance % 2, instance >= 2) * mul)
          )
        )
        w.write('ISBD', [t0Us + m, seq, m, axes[0]!, axes[1]!, axes[2]!])
      }
      seq++
    }
  }
  return w.toBytes()
}
