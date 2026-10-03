/**
 * Decoding of the `@SYS/*.txt` diagnostic files ArduPilot (ChibiOS) writes into the log:
 * `uarts.txt`, `threads.txt`, `timers.txt`, `dma.txt` and `memory.txt`.
 *
 * Addition: upstream HardwareReport only offers these files for download. Formats follow the
 * ChibiOS HAL writers (`UARTV1`, `ThreadsV1/V2`, `TIMERV1`, `DMAV1`, `MemInfoV1` headers);
 * every line is also kept as generic `key=value` fields so unknown versions still render.
 */
import type { EmbeddedFile } from './files.js'

/** One line of a `@SYS` file split into leading label words and `KEY=value` fields. */
export interface SysLine {
  /** Words before the first field, e.g. `["SERIAL0", "OTG1"]`. */
  readonly label: readonly string[]
  /** Fields in line order, e.g. `TX → "157928"`. */
  readonly fields: ReadonlyMap<string, string>
  /** Field keys written with a `*` before `=` (DMA enabled in `uarts.txt`). */
  readonly marked: ReadonlySet<string>
  /** The line as written. */
  readonly raw: string
}

/** One copy of a `@SYS` file: its version header and lines. */
export interface SysSnapshot {
  /** Format header such as `"UARTV1"`, or `undefined` if the text has none. */
  readonly header: string | undefined
  /** Content lines. */
  readonly lines: readonly SysLine[]
}

const HEADER = /(UARTV\d+|ThreadsV\d+|TIMERV\d+|DMAV\d+|MemInfoV\d+)\r?\n/g
const FIELD = /([A-Za-z_][\w]*)(\*?)\s*=\s*(\S+)/g

/** Split one line into label words and fields. */
export function parseSysLine(raw: string): SysLine {
  const fields = new Map<string, string>()
  const marked = new Set<string>()
  let firstField = raw.length
  for (const m of raw.matchAll(FIELD)) {
    if (m.index < firstField) firstField = m.index
    const key = m[1] as string
    fields.set(key, m[3] as string)
    if (m[2] === '*') marked.add(key)
  }
  const label = raw
    .slice(0, firstField)
    .trim()
    .split(/\s+/)
    .filter((w) => w !== '')
  return { label, fields, marked, raw }
}

/**
 * Parse `@SYS` text into snapshots. A header may appear more than once (or glued to the end
 * of a previous line) when the file was captured repeatedly; each header starts a snapshot.
 */
export function parseSysText(text: string): SysSnapshot[] {
  const starts: { index: number; header: string; bodyStart: number }[] = []
  for (const m of text.matchAll(HEADER)) starts.push({ index: m.index, header: m[1] as string, bodyStart: m.index + m[0].length })
  const toLines = (body: string): SysLine[] =>
    body
      .split(/\r?\n/)
      .map((l) => l.replace(/\0+$/, ''))
      .filter((l) => l.trim() !== '')
      .map(parseSysLine)
  if (starts.length === 0) return text.trim() === '' ? [] : [{ header: undefined, lines: toLines(text) }]
  return starts.map((s, i) => ({
    header: s.header,
    lines: toLines(text.slice(s.bodyStart, starts[i + 1]?.index ?? text.length))
  }))
}

const int = (v: string | undefined): number | undefined => {
  if (v === undefined) return undefined
  const n = parseInt(v, 10)
  return Number.isNaN(n) ? undefined : n
}

/** One serial port from `uarts.txt`. */
export interface UartInfo {
  /** Serial port number (from `SERIALn`). */
  readonly index: number
  /** Hardware device, e.g. `"UART7"`, `"OTG1"`, or `"EMPTY"`. */
  readonly device: string
  /** No hardware assigned to the port. */
  readonly empty: boolean
  /** Bytes sent since the previous report. */
  readonly txBytes: number | undefined
  /** Bytes received since the previous report. */
  readonly rxBytes: number | undefined
  /** Transmit uses DMA. */
  readonly txDma: boolean
  /** Receive uses DMA. */
  readonly rxDma: boolean
  /** Transmit bandwidth, bytes/s (`TXBD`). */
  readonly txRate: number | undefined
  /** Receive bandwidth, bytes/s (`RXBD`). */
  readonly rxRate: number | undefined
  /** Framing errors (`FE`). */
  readonly framingErrors: number | undefined
  /** Overrun errors (`OE`). */
  readonly overrunErrors: number | undefined
  /** Noise errors (`NE`). */
  readonly noiseErrors: number | undefined
  /** Flow control state (`FlowCtrl`). */
  readonly flowControl: number | undefined
}

/** Serial port lines of a `uarts.txt` snapshot. */
export function uartsFromSnapshot(s: SysSnapshot): UartInfo[] {
  const out: UartInfo[] = []
  for (const line of s.lines) {
    const m = /^SERIAL(\d+)$/.exec(line.label[0] ?? '')
    if (m === null) continue
    const device = line.label[1] ?? ''
    const f = line.fields
    out.push({
      index: Number(m[1]),
      device,
      empty: device === 'EMPTY',
      txBytes: int(f.get('TX')),
      rxBytes: int(f.get('RX')),
      txDma: line.marked.has('TX'),
      rxDma: line.marked.has('RX'),
      txRate: int(f.get('TXBD')),
      rxRate: int(f.get('RXBD')),
      framingErrors: int(f.get('FE')),
      overrunErrors: int(f.get('OE')),
      noiseErrors: int(f.get('NE')),
      flowControl: int(f.get('FlowCtrl'))
    })
  }
  return out
}

/** One thread from `threads.txt`. */
export interface ThreadInfo {
  /** Thread name. */
  readonly name: string
  /** Priority. */
  readonly priority: number | undefined
  /** Stack base address as written (`sp=`). */
  readonly stackPointer: string | undefined
  /** Free stack, bytes (first number of `STACK=free/size`, matches STAK `Free`). */
  readonly stackFree: number | undefined
  /** Stack size, bytes. */
  readonly stackSize: number | undefined
}

/** Thread lines of a `threads.txt` snapshot. */
export function threadsFromSnapshot(s: SysSnapshot): ThreadInfo[] {
  return s.lines
    .filter((l) => l.fields.has('PRI'))
    .map((l) => {
      const [free, size] = (l.fields.get('STACK') ?? '').split('/')
      return {
        name: l.label.join(' '),
        priority: int(l.fields.get('PRI')),
        stackPointer: l.fields.get('sp'),
        stackFree: int(free),
        stackSize: int(size)
      }
    })
}

/** One hardware timer from `timers.txt`. */
export interface TimerInfo {
  /** Timer, e.g. `"TIM3"`. */
  readonly timer: string
  /** Input clock in MHz (`CLK= 200Mhz`). */
  readonly clockMhz: number | undefined
  /** Mode, e.g. `"PWM"`. */
  readonly mode: string | undefined
  /** Achieved frequency. */
  readonly frequency: number | undefined
  /** Target frequency. */
  readonly target: number | undefined
}

/** Timer lines of a `timers.txt` snapshot. */
export function timersFromSnapshot(s: SysSnapshot): TimerInfo[] {
  return s.lines
    .filter((l) => (l.label[0] ?? '').startsWith('TIM'))
    .map((l) => ({
      timer: l.label[0] as string,
      clockMhz: int(l.fields.get('CLK')),
      mode: l.fields.get('MODE'),
      frequency: int(l.fields.get('FREQ')),
      target: int(l.fields.get('TGT'))
    }))
}

/** One DMA stream from `dma.txt`. */
export interface DmaInfo {
  /** Stream as written, e.g. `"1:3"` (controller:stream). */
  readonly stream: string | undefined
  /** Every numeric field of the line (e.g. `TX`, `ACQ`, `CONT`). */
  readonly values: Readonly<Record<string, number>>
  /** The line as written, for fields the generic parse cannot express (e.g. percentages). */
  readonly raw: string
}

/** DMA stream lines of a `dma.txt` snapshot. */
export function dmaFromSnapshot(s: SysSnapshot): DmaInfo[] {
  return s.lines
    .filter((l) => l.fields.has('DMA'))
    .map((l) => {
      const values: Record<string, number> = {}
      for (const [k, v] of l.fields) {
        const n = Number(v.replace(/%$/, ''))
        if (k !== 'DMA' && !Number.isNaN(n)) values[k] = n
      }
      return { stream: l.fields.get('DMA'), values, raw: l.raw }
    })
}

/** One memory region from `memory.txt`. */
export interface MemoryRegion {
  /** Start address as written. */
  readonly start: string | undefined
  /** Region size in bytes (`LEN=256k`). */
  readonly length: number | undefined
  /** Free bytes. */
  readonly free: number | undefined
  /** Largest free block, bytes. */
  readonly largest: number | undefined
  /** Region type flags. */
  readonly type: number | undefined
}

function kbytes(v: string | undefined): number | undefined {
  if (v === undefined) return undefined
  const m = /^(\d+)([kKmM]?)$/.exec(v)
  if (m === null) return undefined
  const scale = m[2] === '' ? 1 : m[2] === 'k' || m[2] === 'K' ? 1024 : 1024 * 1024
  return Number(m[1]) * scale
}

/** Memory region lines of a `memory.txt` snapshot. */
export function memoryFromSnapshot(s: SysSnapshot): MemoryRegion[] {
  return s.lines
    .filter((l) => l.fields.has('START'))
    .map((l) => ({
      start: l.fields.get('START'),
      length: kbytes(l.fields.get('LEN')),
      free: int(l.fields.get('FREE')),
      largest: int(l.fields.get('LRG')),
      type: int(l.fields.get('TYPE'))
    }))
}

/** Decoded `@SYS` files; each from the last snapshot in the file. */
export interface SysFilesReport {
  /** `@SYS/uarts.txt`. */
  readonly uarts: readonly UartInfo[] | undefined
  /** `@SYS/threads.txt`. */
  readonly threads: readonly ThreadInfo[] | undefined
  /** `@SYS/timers.txt`. */
  readonly timers: readonly TimerInfo[] | undefined
  /** `@SYS/dma.txt`. */
  readonly dma: readonly DmaInfo[] | undefined
  /** `@SYS/memory.txt`. */
  readonly memory: readonly MemoryRegion[] | undefined
}

function lastSnapshot<T>(files: readonly EmbeddedFile[], name: string, decode: (s: SysSnapshot) => T[]): T[] | undefined {
  const file = files.find((f) => f.name === name)
  if (file === undefined) return undefined
  const snapshots = parseSysText(new TextDecoder().decode(file.data))
  const last = snapshots[snapshots.length - 1]
  return last === undefined ? [] : decode(last)
}

/** Decode the known `@SYS` text files among the embedded files. */
export function readSysFiles(files: readonly EmbeddedFile[]): SysFilesReport {
  return {
    uarts: lastSnapshot(files, '@SYS/uarts.txt', uartsFromSnapshot),
    threads: lastSnapshot(files, '@SYS/threads.txt', threadsFromSnapshot),
    timers: lastSnapshot(files, '@SYS/timers.txt', timersFromSnapshot),
    dma: lastSnapshot(files, '@SYS/dma.txt', dmaFromSnapshot),
    memory: lastSnapshot(files, '@SYS/memory.txt', memoryFromSnapshot)
  }
}
