/**
 * Serial port configuration: baud rate mapping, protocol names and port titles
 * (upstream `plot_data_rate()` helpers `map_baudrate`, `serial_protocols`, `SerialTitle`,
 * `NetTitle`, `DroneCANTitle` and `IOMCUTitle`).
 */
import type { ParamValues } from './params.js'

/** `SERIALn_PROTOCOL` value names (upstream `serial_protocols`). */
export const SERIAL_PROTOCOL_NAMES: Readonly<Record<number, string>> = {
  [-1]: 'None',
  0: 'None',
  1: 'MAVLink1',
  2: 'MAVLink2',
  3: 'Frsky D',
  4: 'Frsky SPort',
  5: 'GPS',
  7: 'Alexmos Gimbal Serial',
  8: 'Gimbal',
  9: 'Rangefinder',
  10: 'FrSky SPort Passthrough (OpenTX)',
  11: 'Lidar360',
  13: 'Beacon',
  14: 'Volz servo out',
  15: 'SBus servo out',
  16: 'ESC Telemetry',
  17: 'Devo Telemetry',
  18: 'OpticalFlow',
  19: 'RobotisServo',
  20: 'NMEA Output',
  21: 'WindVane',
  22: 'SLCAN',
  23: 'RCIN',
  24: 'EFI Serial',
  25: 'LTM',
  26: 'RunCam',
  27: 'HottTelem',
  28: 'Scripting',
  29: 'Crossfire VTX',
  30: 'Generator',
  31: 'Winch',
  32: 'MSP',
  33: 'DJI FPV',
  34: 'AirSpeed',
  35: 'ADSB',
  36: 'AHRS',
  37: 'SmartAudio',
  38: 'FETtecOneWire',
  39: 'Torqeedo',
  40: 'AIS',
  41: 'CoDevESC',
  42: 'DisplayPort',
  43: 'MAVLink High Latency',
  44: 'IRC Tramp',
  45: 'DDS XRCE',
  46: 'IMUDATA',
  48: 'PPP',
  49: 'i-BUS Telemetry',
  50: 'IOMCU'
}

/** Baud rate of the IOMCU link. */
export const IOMCU_BAUD = 1500000

/** Name of a serial protocol number, or `"protocol <n>"` when unknown. */
export function protocolName(num: number): string {
  return SERIAL_PROTOCOL_NAMES[num] ?? `protocol ${num}`
}

/**
 * Convert a `SERIALn_BAUD` parameter value to bits per second (upstream `map_baudrate`, after
 * `AP_SerialManager::map_baudrate`). Values over 2000 are taken as a literal baud rate, other
 * unlisted values as kbaud.
 */
export function mapBaudrate(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  // Upstream `parseInt(rate)`: parses the number's decimal text.
  let rate = parseInt(String(value))
  if (rate <= 0) rate = 57
  const table: Readonly<Record<number, number>> = {
    1: 1200,
    2: 2400,
    4: 4800,
    9: 9600,
    19: 19200,
    38: 38400,
    57: 57600,
    100: 100000,
    111: 111100,
    115: 115200,
    230: 230400,
    256: 256000,
    460: 460800,
    500: 500000,
    921: 921600,
    1500: 1500000,
    2000: 2000000
  }
  const mapped = table[rate]
  if (mapped !== undefined) return mapped
  return rate > 2000 ? rate : rate * 1000
}

/** Title and baud rate of a UART log instance. */
export interface PortTitle {
  /** Display title, e.g. `"Serial 1: MAVLink2, 57600 baud"`. */
  readonly title: string
  /** Baud rate, when known; gives the data-rate limit line. */
  readonly baud: number | undefined
}

const NET_TYPES: Readonly<Record<number, string>> = { 1: 'UDP client', 2: 'UDP server', 3: 'TCP client', 4: 'TCP server' }

function serialTitle(inst: number, params: ParamValues): PortTitle | undefined {
  const prefix = `SERIAL${inst}_`
  const protocol = params.get(prefix + 'PROTOCOL')
  if (protocol === undefined) return undefined
  const name = protocolName(protocol)
  let title = `Serial ${inst}: ` + name
  if (name === 'IOMCU') return { title, baud: IOMCU_BAUD }
  const baud = mapBaudrate(params.get(prefix + 'BAUD'))
  if (baud !== undefined) title += `, ${baud} baud`
  return { title, baud }
}

function netTitle(inst: number, params: ParamValues): PortTitle | undefined {
  const netInst = inst - 20
  if (netInst < 1) return undefined
  const prefix = `NET_P${netInst}_`
  const protocol = params.get(prefix + 'PROTOCOL')
  if (protocol === undefined) return undefined
  let title = `Networking Port ${netInst}: ` + protocolName(protocol)
  const type = params.get(prefix + 'TYPE')
  const typeName = type === undefined ? undefined : NET_TYPES[type]
  if (typeName !== undefined) title += ' ' + typeName
  const ip = [0, 1, 2, 3].map((i) => params.get(`${prefix}IP${i}`))
  const port = params.get(prefix + 'PORT')
  if (ip.every((v) => v !== undefined) && port !== undefined) title += ` ${ip.join('.')}:${port}`
  return { title, baud: undefined }
}

function droneCanTitle(inst: number, driver: 1 | 2, params: ParamValues): PortTitle | undefined {
  const dcInst = inst - (driver === 1 ? 40 : 50)
  if (dcInst < 1) return undefined
  const prefix = `CAN_D${driver}_UC_S${dcInst}_`
  const protocol = params.get(prefix + 'PRO')
  if (protocol === undefined) return undefined
  let title = `DroneCAN Driver ${driver} Port ${dcInst}: `
  const node = params.get(prefix + 'NOD')
  const index = params.get(prefix + 'IDX')
  const haveNode = node !== undefined && index !== undefined
  if (haveNode) title += `NodeID: ${node} Port: ${index} `
  title += protocolName(protocol)
  const baud = mapBaudrate(params.get(prefix + 'BD'))
  // Upstream quirk kept: the baud is only printed when node and index are known.
  if (haveNode) title += ` ${String(baud)} baud`
  return { title, baud }
}

/**
 * Title for a UART log instance: a serial port, networking port (21+), DroneCAN serial
 * tunnel (41+ driver 1, 51+ driver 2), the IOMCU (100), or plain `"UART <n>"`.
 */
export function uartTitle(inst: number, params: ParamValues): PortTitle {
  return (
    serialTitle(inst, params) ??
    netTitle(inst, params) ??
    droneCanTitle(inst, 1, params) ??
    droneCanTitle(inst, 2, params) ??
    (inst === 100 ? { title: `IOMCU, ${IOMCU_BAUD} baud`, baud: IOMCU_BAUD } : { title: `UART ${inst}`, baud: undefined })
  )
}
