/**
 * Internal error history from PM and MON records (upstream `show_internal_errors()`).
 */
import type { DataflashLog } from '@apwt/dataflash'

/** AP_InternalError bit names, bit 0 first (upstream `error_string`). */
export const INTERNAL_ERROR_NAMES: readonly string[] = [
  'logging map failure',
  'logging missing structure',
  'logging write missing format',
  'logging  too many deletes',
  'logging bad get file name',
  'panic',
  'logging flush without semaphore',
  'logging bad current block',
  'logging bad block count',
  'logging dequeue failure',
  'Constraining NaN',
  'Watchdog reset',
  'IOMCU reset',
  'IOMCU fail',
  'SPI fail',
  'main loop stuck',
  'gcs bad link',
  'bitmask range',
  'gcs offset',
  'i2c isr',
  'flow of control',
  'sfs recursion',
  'bad rotation',
  'stack overflow',
  'imu reset',
  'gpio isr',
  'mem guard',
  'dma fail',
  'params restored',
  'invalid arguments'
]

/** A change in the internal error state. */
export interface InternalErrorEvent {
  /** Microseconds since boot. */
  readonly timeUs: number
  /** Full error mask. */
  readonly mask: number
  /** Bits newly set since the previous event. */
  readonly maskChange: number
  /** Names of the newly set bits. */
  readonly names: readonly string[]
  /** Line of the last error (0 = unknown). */
  readonly line: number
  /** Total error count. */
  readonly count: number
  /** Errors since the previous event. */
  readonly countChange: number
  /** Count to show in brackets, if upstream would show one ("N times"). */
  readonly displayCount: number | undefined
  /** Line to show in brackets, if upstream would show one. */
  readonly displayLine: number | undefined
}

interface RawError {
  timeUs: number
  mask: number
  line: number
  count: number
}

/**
 * Names of the set bits. Bits beyond the table (30 and 31) read `"undefined"`, as upstream's
 * string concatenation of a missing entry gives (upstream bug, reproduced).
 */
export function internalErrorNames(mask: number): string[] {
  const out: string[] = []
  for (let i = 0; i < 32; i++) if ((mask & (1 << i)) !== 0) out.push(INTERNAL_ERROR_NAMES[i] ?? 'undefined')
  return out
}

function popCount32(v: number): number {
  let n = 0
  for (let i = 0; i < 32; i++) if ((v & (1 << i)) !== 0) n++
  return n
}

function firstField(log: DataflashLog, msg: string, fields: readonly string[]): string | undefined {
  return fields.find((f) => log.has(msg, f))
}

function collect(log: DataflashLog): RawError[] {
  const out: RawError[] = []
  const add = (msg: string, maskField: string, lineField: string, countField: string): void => {
    const t = log.getNumbers(msg, 'TimeUS')
    const m = log.getNumbers(msg, maskField)
    const l = log.getNumbers(msg, lineField)
    const c = log.getNumbers(msg, countField)
    if (!t || !m || !l || !c) return
    for (let i = 0; i < t.length; i++) {
      out.push({ timeUs: t[i] as number, mask: m[i] as number, line: l[i] as number, count: c[i] as number })
    }
  }
  if (log.has('PM')) {
    const maskField = firstField(log, 'PM', ['IntE', 'InE'])
    const countField = firstField(log, 'PM', ['ErrC', 'ErC'])
    if (log.has('PM', 'ErrL') && maskField !== undefined && countField !== undefined) add('PM', maskField, 'ErrL', countField)
  }
  if (log.has('MON')) add('MON', 'IErr', 'IErrLn', 'IErrCnt')
  return out
}

/**
 * Internal error events: PM and MON merged by time, reduced to changes of mask or line, and
 * with the zero-mask entries dropped (as upstream only prints non-zero masks).
 */
export function readInternalErrors(log: DataflashLog): InternalErrorEvent[] {
  const all = collect(log)
  if (all.length === 0) return []
  all.sort((a, b) => a.timeUs - b.timeUs)

  const unique: RawError[] = [{ ...(all[0] as RawError) }]
  for (let i = 1; i < all.length; i++) {
    const e = all[i] as RawError
    const last = unique[unique.length - 1] as RawError
    if (e.mask !== last.mask || e.line !== last.line) unique.push({ ...e })
    else if (e.count > last.count) last.count = e.count
  }

  const out: InternalErrorEvent[] = []
  unique.forEach((e, i) => {
    const prev = unique[i - 1]
    const maskChange = prev === undefined ? e.mask : e.mask & ~prev.mask
    const countChange = prev === undefined ? e.count : e.count - prev.count
    if (e.mask === 0) return

    const newErrors = popCount32(maskChange)
    const existingErrors = popCount32(e.mask)
    const haveLine = e.line > 0
    const singleError = existingErrors === 0 && newErrors === 1
    let displayCount: number | undefined
    let displayLine: number | undefined
    if (singleError || newErrors !== countChange) {
      // One error type (count must belong to it) or ambiguous: show count and line.
      if (countChange > 1) displayCount = countChange
      if (haveLine) displayLine = e.line
    } else if (haveLine) {
      // One-to-one between new bits and new errors.
      displayLine = e.line
    }
    out.push({
      timeUs: e.timeUs,
      mask: e.mask,
      maskChange,
      names: internalErrorNames(maskChange),
      line: e.line,
      count: e.count,
      countChange,
      displayCount,
      displayLine
    })
  })
  return out
}
