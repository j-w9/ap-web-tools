// Test-only: real fixture logs, optionally augmented with synthetic gyro and tracking records.
// copter-sitl.bin already defines GYR / ISBH / ISBD / RPM formats (with FMTU) but logs none of
// them; records appended at the end are picked up by both parsers.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LogWriter, type FieldValue } from '@apwt/dataflash/testing'
import { rng } from './rng.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = resolve(here, '../../../../../packages/dataflash/test-fixtures')

/** Bytes of a fixture in packages/dataflash/test-fixtures. */
export function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(resolve(fixtures, name)))
}

// Existing formats in copter-sitl.bin
const FMT = {
  PARM: [32, 'QNff'],
  GYR: [165, 'QBQfff'],
  ISBH: [167, 'QHBBHHQf'],
  ISBD: [168, 'QHHaaa'],
  RPM: [115, 'QBffB'],
  FMTU: [118, 'QBNN']
} as const

/** Appends records to an existing log. */
export class LogAppender {
  private readonly writer = new LogWriter()
  private readonly defined = new Map<string, [number, string]>()

  constructor(private readonly base: Uint8Array) {
    // The fixture may end in a truncated record; pad so it cannot swallow our first record.
    this.writer.raw(new Uint8Array(256))
  }

  /** Write a record of a format known by name. */
  write(name: string, values: readonly FieldValue[]): void {
    const known = (FMT as Record<string, readonly [number, string]>)[name] ?? this.defined.get(name)
    if (known === undefined) throw new Error(`unknown format ${name}`)
    this.writer.raw([0xa3, 0x95, known[0]])
    this.writer.raw(LogWriter.encodeBody(known[1], values))
  }

  /** Define a new format (FMT + FMTU) at a free id. */
  define(id: number, name: string, format: string, columns: string, units: string, mults: string): void {
    this.writer.defineFormat(id, name, format, columns)
    this.defined.set(name, [id, format])
    this.write('FMTU', [0, id, units, mults])
  }

  /** Append a PARM record. */
  param(name: string, value: number, timeUs = 50_000_000): void {
    this.write('PARM', [timeUs, name, value, 0])
  }

  /** Base log followed by the appended records. */
  toBytes(): Uint8Array {
    const extra = this.writer.toBytes()
    const out = new Uint8Array(this.base.length + extra.length)
    out.set(this.base)
    out.set(extra, this.base.length)
    return out
  }
}

/** Synthetic gyro signal: a few tones plus noise. */
function gyroSample(next: () => number, t: number, axis: number, instance: number): number {
  const tone = (hz: number, amp: number): number => amp * Math.sin(2 * Math.PI * hz * t + axis + instance)
  return tone(95 + 10 * Math.sin(0.3 * t), 0.4) + tone(190, 0.1) + tone(37, 0.05 * (axis + 1)) + 0.02 * (next() - 0.5)
}

/**
 * Raw GYR data for `instances` from `start` to `end` seconds at `rate` Hz, with a gap of
 * 0.5 s in the middle so the loader has to split batches.
 */
export function appendRawGyro(log: LogAppender, instances: readonly number[], start: number, end: number, rate: number): void {
  const next = rng(42)
  const gapStart = (start + end) / 2
  for (let n = 0; ; n++) {
    const t = start + n / rate
    if (t > end) break
    if (t > gapStart && t < gapStart + 0.5) continue
    for (const inst of instances) {
      const us = Math.round(t * 1e6) + inst
      log.write('GYR', [us, inst, us, gyroSample(next, t, 0, inst), gyroSample(next, t, 1, inst), gyroSample(next, t, 2, inst)])
    }
  }
}

/** Batch sampled ISBH/ISBD data: `count` batches of `samples` per instance, one per second. */
export function appendBatchGyro(
  log: LogAppender,
  instances: readonly number[],
  start: number,
  count: number,
  samples: number,
  rate: number
): void {
  const next = rng(7)
  const mul = 1000
  let seq = 0
  for (let b = 0; b < count; b++) {
    for (const inst of [...instances, -1]) {
      // instance -1: an accelerometer batch, which must be skipped
      const type = inst === -1 ? 0 : 1
      const t0 = start + b
      const t0Us = Math.round(t0 * 1e6)
      log.write('ISBH', [t0Us, seq, type, Math.max(inst, 0), mul, samples, t0Us, rate])
      for (let m = 0; m < samples / 32; m++) {
        const axes = [0, 1, 2].map((axis) =>
          Array.from({ length: 32 }, (_, k) => Math.round(gyroSample(next, t0 + (m * 32 + k) / rate, axis, inst) * mul))
        )
        log.write('ISBD', [t0Us + m, seq, m, axes[0]!, axes[1]!, axes[2]!])
      }
      seq++
    }
  }
}

/** FTN1 / FTN2 onboard FFT, FTN / FTNS logged notch and instanced RPM records. */
export function appendTrackingMessages(log: LogAppender, start: number, end: number): void {
  log.define(220, 'FTN1', 'QBffff', 'TimeUS,I,PkAvg,BwAvg,SnX,SnY', 's-zz--', 'F-----')
  log.define(221, 'FTN2', 'QBffffffff', 'TimeUS,Id,PkX,PkY,PkZ,BwX,BwY,EnX,EnY,EnZ', 's#zzzzz---', 'F---------')
  log.define(222, 'FTN', 'QBBfffff', 'TimeUS,I,NDn,NF1,NF2,NF3,NF4,NF5', 's#-zzzzz', 'F-------')
  log.define(223, 'FTNS', 'QBf', 'TimeUS,I,NF', 's#z', 'F--')
  const next = rng(3)
  for (let t = start; t <= end; t += 0.05) {
    const us = Math.round(t * 1e6)
    const base = 95 + 10 * Math.sin(0.3 * t)
    log.write('FTN1', [us, 0, base, 20, 1, 1])
    for (let p = 0; p < 3; p++) {
      const enX = p === 2 ? 0 : 1 + next()
      log.write('FTN2', [us + p, p, base * (p + 1) + next(), base * (p + 1) + next(), base, 5, 5, enX, 1 + next(), 1])
    }
    log.write('FTN', [us, 1, 3, base, base + 2, base - 2, 0, 0])
    log.write('FTNS', [us, 0, base])
    log.write('RPM', [us, 0, (base * 60) / 2, 1, t > start + 1 ? 1 : 0])
    log.write('RPM', [us + 1, 1, base * 60, 1, 1])
  }
}

/** Overwrite the value of every PARM record named `name` in place (copter-sitl PARM is `QNff`). */
export function patchParam(bytes: Uint8Array, name: string, value: number): Uint8Array {
  const out = bytes.slice()
  const view = new DataView(out.buffer)
  const needle = new Uint8Array(16)
  for (let i = 0; i < name.length; i++) needle[i] = name.charCodeAt(i)
  let patched = 0
  for (let i = 3 + 8; i + 24 <= out.length; i++) {
    let match = true
    for (let k = 0; k < 16 && match; k++) match = out[i + k] === needle[k]
    // record header 3 bytes + TimeUS 8 bytes precede the name
    if (match && out[i - 11] === 0xa3 && out[i - 10] === 0x95 && out[i - 9] === FMT.PARM[0]) {
      view.setFloat32(i + 16, value, true)
      patched++
    }
  }
  if (patched === 0) throw new Error(`param ${name} not found`)
  return out
}
