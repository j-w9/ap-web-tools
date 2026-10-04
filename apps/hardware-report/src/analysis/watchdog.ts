/**
 * Watchdog reboot records (upstream `show_watchdog()`).
 */
import type { DataflashLog } from '@apwt/dataflash'

/** One distinct watchdog record (WDOG). */
export interface WatchdogRecord {
  /** Scheduler task (negative values are special phases, see {@link taskName}). */
  readonly schedulerTask: number
  /** Internal error mask. */
  readonly internalErrors: number
  /** Internal error count. */
  readonly internalErrorCount: number
  /** Line of the last internal error. */
  readonly internalErrorLastLine: number
  /** Last MAVLink message id (0 = none). */
  readonly lastMavlinkMsgId: number
  /** Last MAVLink command (0 = none). */
  readonly lastMavlinkCmd: number
  /** Line waiting on a semaphore (0 = not waiting). */
  readonly semaphoreLine: number
  /** Fault line. */
  readonly faultLine: number
  /** Fault type (see {@link faultName}). */
  readonly faultType: number
  /** Fault address. */
  readonly faultAddr: number
  /** Faulting thread priority. */
  readonly faultThreadPriority: number
  /** Interrupt control and state register (see {@link decodeIcsr}). */
  readonly faultIcsr: number
  /** Fault link register (return address). */
  readonly faultLr: number
  /** Faulting thread name. */
  readonly threadName: string
}

/** Numeric record fields and their WDOG columns, in upstream (and decode_watchdog.py) order. */
const COLUMNS = [
  ['schedulerTask', 'Tsk'],
  ['internalErrors', 'IE'],
  ['internalErrorCount', 'IEC'],
  ['internalErrorLastLine', 'IEL'],
  ['lastMavlinkMsgId', 'MvMsg'],
  ['lastMavlinkCmd', 'MvCmd'],
  ['semaphoreLine', 'SmLn'],
  ['faultLine', 'FL'],
  ['faultType', 'FT'],
  ['faultAddr', 'FA'],
  ['faultThreadPriority', 'FP'],
  ['faultIcsr', 'ICSR'],
  ['faultLr', 'LR']
] as const satisfies readonly (readonly [keyof WatchdogRecord, string])[]

function sameRecord(a: WatchdogRecord, b: WatchdogRecord): boolean {
  return COLUMNS.every(([key]) => a[key] === b[key]) && a.threadName === b.threadName
}

/** WDOG records with consecutive duplicates removed. Empty when the log has none. */
export function readWatchdogs(log: DataflashLog): WatchdogRecord[] {
  const time = log.getNumbers('WDOG', 'TimeUS')
  if (time === undefined) return []
  const names = log.getStrings('WDOG', 'TN')
  const col = (field: string) => log.getNumbers('WDOG', field)
  const c = {
    tsk: col('Tsk'),
    ie: col('IE'),
    iec: col('IEC'),
    iel: col('IEL'),
    mvMsg: col('MvMsg'),
    mvCmd: col('MvCmd'),
    smLn: col('SmLn'),
    fl: col('FL'),
    ft: col('FT'),
    fa: col('FA'),
    fp: col('FP'),
    icsr: col('ICSR'),
    lr: col('LR')
  }
  const out: WatchdogRecord[] = []
  for (let i = 0; i < time.length; i++) {
    const at = (values: ArrayLike<number> | undefined): number => values?.[i] ?? NaN
    const rec: WatchdogRecord = {
      schedulerTask: at(c.tsk),
      internalErrors: at(c.ie),
      internalErrorCount: at(c.iec),
      internalErrorLastLine: at(c.iel),
      lastMavlinkMsgId: at(c.mvMsg),
      lastMavlinkCmd: at(c.mvCmd),
      semaphoreLine: at(c.smLn),
      faultLine: at(c.fl),
      faultType: at(c.ft),
      faultAddr: at(c.fa),
      faultThreadPriority: at(c.fp),
      faultIcsr: at(c.icsr),
      faultLr: at(c.lr),
      threadName: names?.[i] ?? ''
    }
    const last = out[out.length - 1]
    if (last !== undefined && sameRecord(last, rec)) continue
    out.push(rec)
  }
  return out
}

/** Name of a special scheduler task number, if it is one. */
export function taskName(task: number): string | undefined {
  switch (task) {
    case -3:
      return 'Waiting for sample'
    case -1:
      return 'Pre loop'
    case -2:
      return 'Fast loop'
  }
  return undefined
}

/**
 * Name of a fault type, as upstream's `switch`. Proven upstream bug fixed: upstream lists BusFault
 * and UsageFault under duplicate `case 4` labels, so types 5 and 6 got no name; ArduPilot's
 * `FaultType` has `BusFault = 5, UsageFault = 6` (docs/bug-proofs/hardware-report.md).
 */
export function faultName(type: number): string | undefined {
  return FAULT_NAMES[type]
}

const FAULT_NAMES: Readonly<Record<number, string>> = {
  1: 'Reset',
  2: 'NMI',
  3: 'HardFault',
  4: 'MemManage',
  5: 'BusFault',
  6: 'UsageFault'
}

/** One decoded ICSR bit field. */
export interface IcsrField {
  /** Bit range, e.g. `"0-8"` or `"11"`. */
  readonly bits: string
  /** Field name, e.g. `"VECTACTIVE"`. */
  readonly name: string
  /** Field value. */
  readonly value: number
  /** Meaning of the value, when the field has a decoder. */
  readonly description: string | undefined
}

const VECT_EXCEPTIONS: Readonly<Record<number, string>> = {
  0: 'Thread mode',
  1: 'Reserved',
  2: 'NMI',
  3: 'Hard fault',
  4: 'Memory management fault',
  5: 'Bus fault',
  6: 'Usage fault',
  7: 'Reserved....',
  10: 'Reserved',
  11: 'SVCall',
  12: 'Reserved for Debug',
  13: 'Reserved',
  14: 'PendSV',
  15: 'SysTick'
}

const vect = (v: number): string => VECT_EXCEPTIONS[v] ?? `IRQ${v - 16}`
const flag =
  (on: string, off: string) =>
  (v: number): string =>
    v ? on : off

/** Cortex-M4/M7 ICSR layout (upstream `M4_BITS`). */
const ICSR_FIELDS: readonly (readonly [string, string, ((v: number) => string) | undefined])[] = [
  ['0-8', 'VECTACTIVE', vect],
  ['9-10', 'RESERVED1', undefined],
  ['11', 'RETOBASE', flag('no (or no more) active exceptions', 'preempted active exceptions')],
  ['12-18', 'VECTPENDING', vect],
  ['19-21', 'RESERVED2', undefined],
  ['22', 'ISRPENDING', flag('Interrupt pending', 'No pending interrupt')],
  ['23-24', 'RESERVED3', undefined],
  ['25', 'PENDSTCLR', () => 'WO clears SysTick exception'],
  ['26', 'PENDSTSET', flag('SysTick pending', 'SysTick not pending')],
  ['27', 'PENDSVCLR', () => 'WO clears pendsv exception'],
  ['28', 'PENDSVSET', flag('PendSV pending', 'PendSV not pending')],
  ['29-30', 'RESERVED4', undefined],
  ['31', 'NMIPENDSET', flag('NMI pending', 'NMI not pending')]
]

/**
 * Decode the ICSR register into its bit fields (upstream `decode_ICSR`). Values are extracted with
 * an unsigned shift (proven upstream bug fixed: upstream's signed `>>` makes a set bit 31,
 * NMIPENDSET, read -1; the register is a `uint32_t`).
 */
export function decodeIcsr(icsr: number): IcsrField[] {
  return ICSR_FIELDS.map(([bits, name, decoder]) => {
    const [start, stop] = bits.includes('-') ? (bits.split('-').map(Number) as [number, number]) : [Number(bits), Number(bits)]
    let mask = 0
    for (let i = start; i <= stop; i++) mask |= 1 << i
    const value = (icsr & mask) >>> start
    return { bits, name, value, description: decoder?.(value) }
  })
}

/** Upstream's hex text for a value: `"0x" + value.toString(16)`. */
export function upstreamHex(value: number): string {
  return '0x' + value.toString(16)
}

/**
 * The record as a `"WDOG, 0, ..."` line that can be pasted into ArduPilot's
 * `Tools/scripts/decode_watchdog.py` (upstream logs this to the console).
 */
export function watchdogDecodeLine(w: WatchdogRecord): string {
  return '"WDOG, 0, ' + [...COLUMNS.map(([key]) => w[key]), w.threadName].join(', ') + '"'
}
