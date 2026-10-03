// Test-only: builds synthetic PID Review logs (VER, MSG, PARM, PID*/PIQ*, RATE, ATT, POS) with
// parameter changes, dropped-data gaps and timing jitter, so the port and upstream PIDReview.js can
// be run side by side on inputs that exercise every branch.
import { LogWriter } from '@apwt/dataflash/testing'

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface ParamChange {
  /** Seconds from the start of the log. */
  readonly time: number
  readonly name: string
  readonly value: number
}

export interface PidLogOptions {
  /** VER.BU build type; null writes no VER record (vehicle from the MSG banner, if any). */
  readonly buildType?: number | null
  /** Boot banner, written with the three messages upstream's banner search needs. */
  readonly banner?: string | null
  /** Follow the banner with the OS, board and "Param space used" lines upstream looks for (default true). */
  readonly bracketed?: boolean
  /** Controller messages to log, e.g. `['PIDR', 'PIDP']`. */
  readonly pidMessages?: readonly string[]
  /** Log the D FF field in the PID messages. */
  readonly dff?: boolean
  /** Log the RATE message. */
  readonly rate?: boolean
  /** Logging rate of the controller messages, Hz. */
  readonly rateHz?: number
  /** Seconds of data. */
  readonly duration?: number
  /** Spans `[start, end)` (seconds) with no controller samples. */
  readonly gaps?: readonly (readonly [number, number])[]
  /** Restrict a controller message to `[start, end)` seconds. */
  readonly spans?: Readonly<Record<string, readonly [number, number]>>
  /** Log a controller message only every n-th sample. */
  readonly decimate?: Readonly<Record<string, number>>
  /** Microsecond jitter added to each timestamp. */
  readonly jitterUs?: number
  /** Parameters written at the start. */
  readonly params?: Readonly<Record<string, number>>
  /** Later parameter writes. */
  readonly changes?: readonly ParamChange[]
  /** Target step amplitude in the logged units (rad/s for copter PID messages). */
  readonly stepAmplitude?: number
  /** Spans `[start, end)` (seconds) where the target steps are a hundredth of `stepAmplitude`. */
  readonly quietSpans?: readonly (readonly [number, number])[]
  readonly seed?: number
}

const T0 = 2_000_000

export const COPTER_PARAMS: Readonly<Record<string, number>> = {
  ATC_RAT_RLL_P: 0.135,
  ATC_RAT_RLL_I: 0.135,
  ATC_RAT_RLL_D: 0.0036,
  ATC_RAT_RLL_FF: 0,
  ATC_RAT_RLL_IMAX: 0.5,
  ATC_RAT_RLL_FLTT: 20,
  ATC_RAT_RLL_FLTE: 0,
  ATC_RAT_RLL_FLTD: 20,
  ATC_RAT_RLL_SMAX: 0,
  ATC_RAT_PIT_P: 0.135,
  ATC_RAT_PIT_I: 0.135,
  ATC_RAT_PIT_D: 0.0036,
  ATC_RAT_YAW_P: 0.18,
  ATC_RAT_YAW_I: 0.018
}

/** Build a synthetic log; see `PidLogOptions` for what can be varied. */
export function buildPidLog(options: PidLogOptions = {}): ArrayBuffer {
  const next = rng(options.seed ?? 1)
  const rateHz = options.rateHz ?? 400
  const duration = options.duration ?? 30
  const jitter = options.jitterUs ?? 0
  const amp = options.stepAmplitude ?? 1
  const dff = options.dff ?? true
  const pidMessages = options.pidMessages ?? ['PIDR', 'PIDP', 'PIDY']
  const gaps = options.gaps ?? []

  const w = new LogWriter()
  w.defineFormat(0x80, 'FMT', 'BBnNZ', 'Type,Length,Name,Format,Columns')
  w.defineFormat(0x81, 'PARM', 'QNfff', 'TimeUS,Name,Value,Default,Flags')
  w.defineFormat(0x82, 'MSG', 'QZ', 'TimeUS,Message')
  w.defineFormat(0x83, 'VER', 'QBHBBBBIZHBBII', 'TimeUS,BT,BST,Maj,Min,Pat,FWT,GH,FWS,APJ,BU,FV,IMI,ICI')
  w.defineFormat(0x84, 'ATT', 'Qfff', 'TimeUS,DesRoll,Roll,Pitch')
  w.defineFormat(0x85, 'POS', 'QLLfff', 'TimeUS,Lat,Lng,Alt,RelHomeAlt,RelOriginAlt')
  w.defineFormat(0x86, 'RATE', 'Qfffffffffffff', 'TimeUS,RDes,R,ROut,PDes,P,POut,YDes,Y,YOut,ADes,A,AOut,AOutSlew')
  const pidFormat = dff ? 'QffffffffffB' : 'QfffffffffB'
  const pidColumns = dff ? 'TimeUS,Tar,Act,Err,P,I,D,FF,DFF,Dmod,SRate,Flags' : 'TimeUS,Tar,Act,Err,P,I,D,FF,Dmod,SRate,Flags'
  pidMessages.forEach((name, i) => w.defineFormat(0x90 + i, name, pidFormat, pidColumns))

  if (options.buildType !== null) {
    const bu = options.buildType ?? 2
    w.write('VER', [T0, 50, 0, 4, 6, 0, 255, 0x1234abcd, options.banner ?? 'ArduCopter V4.6.0 (1234abcd)', 0, bu, 8, 0, 0])
  }
  if (options.banner != null) {
    w.write('MSG', [T0, options.banner])
    if (options.bracketed ?? true) {
      w.write('MSG', [T0, 'ChibiOS: 12345678'])
      w.write('MSG', [T0, 'CubeOrange 00000000 00000000 00000000'])
      w.write('MSG', [T0, 'Param space used: 1000/3840'])
    }
  }
  for (const [name, value] of Object.entries(options.params ?? COPTER_PARAMS)) w.write('PARM', [T0, name, value, value, 0])

  const changes = [...(options.changes ?? [])].sort((a, b) => a.time - b.time)
  let change = 0

  // Square-wave target steps with a first-order response, plus noise.
  const lag = Math.exp(-1 / (rateHz * 0.03))
  const actual = pidMessages.map(() => 0)
  const n = Math.floor(duration * rateHz)
  for (let k = 0; k < n; k++) {
    const t = k / rateHz
    while (change < changes.length && changes[change]!.time <= t) {
      const c = changes[change++]!
      w.write('PARM', [T0 + Math.round(c.time * 1e6), c.name, c.value, c.value, 0])
    }
    const timeUs = T0 + Math.round(t * 1e6) + Math.round((next() - 0.5) * 2 * jitter)
    if (k % Math.max(1, Math.round(rateHz / 25)) === 0) {
      w.write('ATT', [timeUs + 10, 0, 10 * Math.sin(t), 5 * Math.cos(t)])
      w.write('POS', [timeUs + 20, -353632621, 1491652374, 600 + t, t, t])
    }
    if (gaps.some(([a, b]) => t >= a && t < b)) continue

    const targets = pidMessages.map((_, i) => {
      const period = 0.8 + 0.3 * i
      const a = (options.quietSpans ?? []).some(([s0, s1]) => t >= s0 && t < s1) ? amp / 100 : amp
      return (Math.floor(t / period) % 2 === 0 ? a : -a) * (1 + 0.2 * Math.sin(t * (3 + i)))
    })
    pidMessages.forEach((name, i) => {
      const tar = targets[i]!
      actual[i] = lag * actual[i]! + (1 - lag) * tar + (next() - 0.5) * 0.02 * amp
      const act = actual[i]
      const span = options.spans?.[name]
      if (span && (t < span[0] || t >= span[1])) return
      if (k % (options.decimate?.[name] ?? 1) !== 0) return
      const err = tar - act
      const p = 0.135 * err
      const iTerm = 0.01 * Math.sin(t)
      const d = 0.003 * (next() - 0.5)
      const ff = 0.05 * tar
      const values = dff
        ? [tar, act, err, p, iTerm, d, ff, 0.001 * tar, 1, rateHz, 0]
        : [tar, act, err, p, iTerm, d, ff, 1, rateHz, 0]
      w.write(name, [timeUs, ...values])
    })
    if (options.rate ?? true) {
      const deg = 180 / Math.PI
      const r = (i: number) => [(targets[i] ?? 0) * deg, (actual[i] ?? 0) * deg, 0.1 * (targets[i] ?? 0)]
      w.write('RATE', [timeUs + 5, ...r(0), ...r(1), ...r(2), 0, 0, 0.4 + 0.1 * Math.sin(t), 0.4])
    }
  }

  const bytes = w.toBytes()
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}
