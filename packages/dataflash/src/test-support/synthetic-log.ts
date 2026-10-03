/**
 * Tiny DataFlash log writer used by the unit tests. Encodes records exactly
 * as ArduPilot's AP_Logger does: `A3 95 <id>` header followed by the packed
 * fields of the message's format string.
 */
import { HEAD1, HEAD2, TYPE_SIZES, makeFormat, type FormatDefinition, type TypeCode } from '../format.js'

/** One field value for the writer: numbers, strings, or 32 int16s for `a`. */
export type FieldValue = number | string | readonly number[]

export class LogWriter {
  private readonly chunks: Uint8Array[] = []
  private readonly formats = new Map<string, FormatDefinition>()

  /** Register a message format and emit its FMT record. */
  defineFormat(id: number, name: string, format: string, columns: string): FormatDefinition {
    const fmt = makeFormat(id, format.split('').reduce((n, c) => n + TYPE_SIZES[c as TypeCode], 0) + 3, name, format, columns)
    this.formats.set(name, fmt)
    this.writeRecord(0x80, 'BBnNZ', [id, fmt.length, name, format, columns])
    return fmt
  }

  /** Emit a record of a previously defined format. */
  write(name: string, values: readonly FieldValue[]): void {
    const fmt = this.formats.get(name)
    if (fmt === undefined) throw new Error(`format ${name} not defined`)
    this.writeRecord(fmt.id, fmt.format, values)
  }

  /** Append raw bytes (e.g. garbage or a truncated record). */
  raw(bytes: ArrayLike<number>): void {
    this.chunks.push(Uint8Array.from(bytes))
  }

  /** Encode a record body without writing it. */
  static encodeBody(format: string, values: readonly FieldValue[]): Uint8Array {
    const size = format.split('').reduce((n, c) => n + TYPE_SIZES[c as TypeCode], 0)
    const out = new Uint8Array(size)
    const view = new DataView(out.buffer)
    let off = 0
    for (let i = 0; i < format.length; i++) {
      const code = format.charAt(i) as TypeCode
      const v = values[i]
      if (v === undefined) throw new Error(`missing value ${i} for format ${format}`)
      switch (code) {
        case 'b':
          view.setInt8(off, v as number)
          break
        case 'B':
        case 'M':
          view.setUint8(off, v as number)
          break
        case 'h':
          view.setInt16(off, v as number, true)
          break
        case 'H':
          view.setUint16(off, v as number, true)
          break
        case 'i':
        case 'L':
          view.setInt32(off, v as number, true)
          break
        case 'I':
          view.setUint32(off, v as number, true)
          break
        case 'f':
          view.setFloat32(off, v as number, true)
          break
        case 'd':
          view.setFloat64(off, v as number, true)
          break
        case 'c':
          view.setInt16(off, Math.round((v as number) * 100), true)
          break
        case 'C':
          view.setUint16(off, Math.round((v as number) * 100), true)
          break
        case 'e':
          view.setInt32(off, Math.round((v as number) * 100), true)
          break
        case 'E':
          view.setUint32(off, Math.round((v as number) * 100), true)
          break
        case 'q':
          view.setBigInt64(off, BigInt(v as number), true)
          break
        case 'Q':
          view.setBigUint64(off, BigInt(v as number), true)
          break
        case 'n':
        case 'N':
        case 'Z': {
          const s = v as string
          for (let j = 0; j < s.length && j < TYPE_SIZES[code]; j++) out[off + j] = s.charCodeAt(j)
          break
        }
        case 'a': {
          const arr = v as readonly number[]
          for (let j = 0; j < 32; j++) view.setInt16(off + j * 2, arr[j] ?? 0, true)
          break
        }
      }
      off += TYPE_SIZES[code]
    }
    return out
  }

  private writeRecord(id: number, format: string, values: readonly FieldValue[]): void {
    this.chunks.push(Uint8Array.of(HEAD1, HEAD2, id))
    this.chunks.push(LogWriter.encodeBody(format, values))
  }

  /** The log bytes written so far. */
  toBytes(): Uint8Array {
    const total = this.chunks.reduce((n, c) => n + c.byteLength, 0)
    const out = new Uint8Array(total)
    let pos = 0
    for (const c of this.chunks) {
      out.set(c, pos)
      pos += c.byteLength
    }
    return out
  }
}

/**
 * Build a small but representative copter log: FMT/FMTU/UNIT/MULT/PARM/MSG/
 * MODE/IMU (two instances)/ATT/GPS plus two messages exercising every type code.
 */
export function buildSyntheticLog(): Uint8Array {
  const w = new LogWriter()
  w.defineFormat(0x80, 'FMT', 'BBnNZ', 'Type,Length,Name,Format,Columns')
  w.defineFormat(0x81, 'FMTU', 'QBNN', 'TimeUS,FmtType,UnitIds,MultIds')
  w.defineFormat(0x82, 'UNIT', 'QbZ', 'TimeUS,Id,Label')
  w.defineFormat(0x83, 'MULT', 'Qbd', 'TimeUS,Id,Mult')
  w.defineFormat(0x84, 'PARM', 'QNfff', 'TimeUS,Name,Value,Default,Flags')
  w.defineFormat(0x85, 'MSG', 'QZ', 'TimeUS,Message')
  w.defineFormat(0x86, 'MODE', 'QMBB', 'TimeUS,Mode,ModeNum,Rsn')
  w.defineFormat(0x87, 'IMU', 'QBfffffff', 'TimeUS,I,GyrX,GyrY,GyrZ,AccX,AccY,AccZ,T')
  w.defineFormat(0x88, 'ATT', 'QccccCCCC', 'TimeUS,DesRoll,Roll,DesPitch,Pitch,DesYaw,Yaw,ErrRP,ErrYaw')
  w.defineFormat(0x89, 'GPS', 'QBBIHBcLLeffffB', 'TimeUS,I,Status,GMS,GWk,NSats,HDop,Lat,Lng,Alt,Spd,GCrs,VZ,Yaw,U')
  w.defineFormat(0x8a, 'TYP1', 'QabBhHiIfd', 'TimeUS,A,SB,UB,SH,UH,SI,UI,F,D')
  w.defineFormat(0x8b, 'TYP2', 'nNZcCeELMq', 'N4,N16,Z64,C,UC,E,UE,L,M,Q')
  w.defineFormat(0x8c, 'EMPT', 'Qf', 'TimeUS,Never')

  const t0 = 1_000_000
  // Unit / multiplier tables (subset).
  const units: [string, string][] = [
    ['-', ''],
    ['s', 's'],
    ['#', 'instance'],
    ['d', 'deg'],
    ['E', 'rad/s'],
    ['o', 'm/s/s'],
    ['O', 'degC'],
    ['D', 'deglatitude'],
    ['U', 'deglongitude'],
    ['m', 'm'],
    ['n', 'm/s'],
    ['h', 'degheading']
  ]
  for (const [id, label] of units) w.write('UNIT', [t0, id.charCodeAt(0), label])
  const mults: [string, number][] = [
    ['-', 0],
    ['?', 1],
    ['0', 1],
    ['F', 1e-6],
    ['B', 1e-2],
    ['G', 1e-7],
    ['C', 1e-3]
  ]
  for (const [id, m] of mults) w.write('MULT', [t0, id.charCodeAt(0), m])
  w.write('FMTU', [t0, 0x87, 's#EEEoooO', 'F-00000000'])
  w.write('FMTU', [t0, 0x88, 'sddddhhdh', 'FBBBBBBBB'])
  w.write('FMTU', [t0, 0x89, 's#-s-S-DUmnhnh-', 'F--C-0-GG000000'])
  w.write('FMTU', [t0, 0x86, 's---', 'F---'])
  w.write('FMTU', [t0, 0x84, 's----', 'F----'])

  w.write('MSG', [t0 + 1, 'ArduCopter V4.5.1 (deadbeef)'])
  w.write('MSG', [t0 + 2, 'Frame: QUAD/X'])
  w.write('PARM', [t0 + 3, 'ATC_RAT_RLL_P', 0.135, 0.135, 0])
  w.write('PARM', [t0 + 4, 'INS_GYRO_FILTER', 20, 20, 0])
  w.write('PARM', [t0 + 5, 'ATC_RAT_RLL_P', 0.15, 0.135, 0]) // changed later: last value wins
  w.write('MODE', [t0 + 10, 0, 0, 1]) // STABILIZE
  w.write('MODE', [t0 + 20, 5, 5, 2]) // LOITER
  w.write('MODE', [t0 + 30, 99, 99, 2]) // unknown

  for (let i = 0; i < 50; i++) {
    const t = t0 + 100 + i * 2500
    w.write('IMU', [t, 0, 0.01 * i, -0.02 * i, 0.03 * i, 0.1, 0.2, -9.81, 30 + i])
    w.write('IMU', [t + 1, 1, 0.011 * i, -0.021 * i, 0.031 * i, 0.11, 0.21, -9.8, 31 + i])
    if (i % 2 === 0) {
      w.write('ATT', [t + 2, 1.5, 1.52, -2.25, -2.27, 90.1, 90.2, 0.05, 0.03])
    }
    if (i % 10 === 0) {
      const fix = i >= 20 ? 3 : 1
      w.write('GPS', [t + 3, 0, fix, 100000 + i * 25000, 2300, 12, 0.9, -35.3632621, 149.1652374, 584.1, 1.5, 180.0, -0.1, 0, 1])
      w.write('GPS', [t + 4, 1, 1, 100000 + i * 25000, 2300, 4, 2.5, -35.3632621, 149.1652374, 584.1, 1.5, 180.0, -0.1, 0, 1])
    }
  }

  const arr = Array.from({ length: 32 }, (_, j) => j * 100 - 1600)
  w.write('TYP1', [t0 + 7, arr, -128, 255, -32768, 65535, -2147483648, 4294967295, 1.5, Math.PI])
  w.write('TYP1', [2 ** 53 - 1, arr.map((v) => -v), 127, 0, 32767, 0, 2147483647, 0, -0.25, -Math.E])
  w.write('TYP2', ['abcd', 'sixteen chars!!!', 'zed', -327.68, 655.35, -21474836.48, 42949672.95, -353632621, 7, -5_000_000_000])
  w.write('TYP2', ['ab', 'x', '', 1.23, 4.56, 7.89, 10.11, 1491652374, 255, 2 ** 40 + 1])

  // A stray non-record byte run that happens to contain HEAD1 but not HEAD2.
  w.raw([HEAD1, 0x00, HEAD1])
  // Final truncated IMU record (header + 5 bytes) that must be ignored.
  w.raw([HEAD1, HEAD2, 0x87, 1, 2, 3, 4, 5])
  return w.toBytes()
}
