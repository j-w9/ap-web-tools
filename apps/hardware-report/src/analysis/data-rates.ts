/**
 * UART and CAN data rates (upstream `plot_data_rate()`).
 */
import type { DataflashLog } from '@apwt/dataflash'
import type { ParamValues } from './params.js'
import { uartTitle } from './serial.js'
import { timeSeconds, toFloat64 } from './series.js'

/** Data rate of one UART log instance, bytes per second. */
export interface UartRate {
  /** UART instance (serial port number, or the special ranges handled by {@link uartTitle}). */
  readonly instance: number
  /** Plot title. */
  readonly title: string
  /** Seconds. */
  readonly time: Float64Array
  /** Receive rate (bytes/s). */
  readonly rx: Float64Array
  /** Transmit rate (bytes/s). */
  readonly tx: Float64Array
  /** Maximum byte rate at the configured baud (baud / 10, 8 data + start + stop bits). */
  readonly limit: number | undefined
}

/** Frame rates of one CAN driver. */
export interface CanRate {
  /** CANS instance (driver number - 1). */
  readonly instance: number
  /** Plot title, e.g. `"DroneCAN 0: 1Mbit/s"`. */
  readonly title: string
  /** Whether the driver runs CAN FD (`CAN_Dn_UC_OPTION` bit 2). */
  readonly fd: boolean
  /** Bitrate, when a port is assigned to this driver (NaN when its bitrate parameter is missing). */
  readonly bitrate: number | undefined
  /** Seconds; one shorter than the log because rates are differences. */
  readonly time: Float64Array
  /** Receive rate (frames/s). */
  readonly rx: Float64Array
  /** Transmit rate (frames/s). */
  readonly tx: Float64Array
  /** rx + tx. */
  readonly total: Float64Array
  /** Pessimistic frame-rate limit for classic CAN (max-length frames, worst bit stuffing). */
  readonly worstCaseLimit: number | undefined
}

/** Explanation upstream shows next to the CAN worst-case limit. */
export const CAN_LIMIT_NOTE =
  'Limit is a very pessimistic worst case. It assumes max length frames and worst data. The best case is more than twice as many frames, the reality will be somewhere in between.'

/** Per-UART receive/transmit rates with titles from the serial parameters. */
export function readUartRates(log: DataflashLog, params: ParamValues): UartRate[] {
  const out: UartRate[] = []
  for (const inst of log.instances('UART')) {
    const time = timeSeconds(log, 'UART', inst)
    const rx = log.getNumbers('UART', 'Rx', inst)
    const tx = log.getNumbers('UART', 'Tx', inst)
    if (!time || !rx || !tx) continue
    const { title, baud } = uartTitle(inst, params)
    out.push({
      instance: inst,
      title,
      time,
      rx: toFloat64(rx),
      tx: toFloat64(tx),
      limit: baud === undefined ? undefined : baud / 10
    })
  }
  return out
}

/** JavaScript `parseInt` of a parameter value (`undefined` gives NaN), as upstream applies it. */
function parseIntParam(value: number | undefined): number {
  return parseInt(String(value))
}

/**
 * Bitrate of the first `CAN_Pn` port assigned to `driver`, as upstream computes it. A missing
 * `CAN_Pn_BITRATE`/`CAN_Pn_FDBITRATE` gives NaN (upstream bug, reproduced: the title reads
 * `NaNMbit/s` and the limit line is NaN).
 */
function canBitrate(params: ParamValues, driver: number, fd: boolean): number | undefined {
  for (let i = 1; i < 10; i++) {
    if (params.get(`CAN_P${i}_DRIVER`) !== driver) continue
    return fd ? parseIntParam(params.get(`CAN_P${i}_FDBITRATE`)) * 1000000 : parseIntParam(params.get(`CAN_P${i}_BITRATE`))
  }
  return undefined
}

/**
 * Per-driver CAN frame rates from the cumulative CANS counters. Classic CAN gets a worst-case
 * limit of `bitrate / (157 + 3)` frames/s: 157 bits for a max-length frame with worst bit
 * stuffing plus 3 bits interframe space.
 */
export function readCanRates(log: DataflashLog, params: ParamValues): CanRate[] {
  const out: CanRate[] = []
  for (const inst of log.instances('CANS')) {
    const driver = inst + 1
    const options = params.get(`CAN_D${driver}_UC_OPTION`)
    const fd = options !== undefined && (options & (1 << 2)) !== 0
    const bitrate = canBitrate(params, driver, fd)

    let title = `DroneCAN ${inst}`
    if (bitrate !== undefined) title += `: ${bitrate / 1000000}Mbit/s`
    const worstCaseLimit = bitrate !== undefined && !fd ? Math.floor(bitrate / (157 + 3)) : undefined

    const t = timeSeconds(log, 'CANS', inst)
    const txCount = log.getNumbers('CANS', 'T', inst)
    const rxCount = log.getNumbers('CANS', 'R', inst)
    if (!t || !txCount || !rxCount) continue
    const n = Math.max(t.length - 1, 0)
    const time = new Float64Array(n)
    const tx = new Float64Array(n)
    const rx = new Float64Array(n)
    const total = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      const dt = (t[i + 1] as number) - (t[i] as number)
      tx[i] = ((txCount[i + 1] as number) - (txCount[i] as number)) / dt
      rx[i] = ((rxCount[i + 1] as number) - (rxCount[i] as number)) / dt
      total[i] = (tx[i] as number) + (rx[i] as number)
      time[i] = t[i + 1] as number
    }
    out.push({ instance: inst, title, fd, bitrate, time, rx, tx, total, worstCaseLimit })
  }
  return out
}
