/**
 * Top level: build the whole hardware report from a DataFlash log or a `.param` file
 * (upstream `load()`, `load_log()`, `load_param_file()` and `load_params()`).
 */
import { DataflashLog } from '@apwt/dataflash'
import { readAirspeed, type AirspeedReport } from './airspeed.js'
import { readBaro, type BaroReport } from './baro.js'
import {
  readPowerFlags,
  readTemperature,
  readVoltage,
  type PowerFlagsData,
  type TemperatureData,
  type VoltageData
} from './board-health.js'
import { EMPTY_CAN, readCanNodes, type CanInventory } from './can.js'
import { readClockDrift, type ClockDrift } from './clock-drift.js'
import { readCompass, type CompassReport } from './compass.js'
import { readCanRates, readUartRates, type CanRate, type UartRate } from './data-rates.js'
import { readEmbeddedFiles, type EmbeddedFile } from './files.js'
import { readFirmwareInfo, type FirmwareInfo } from './firmware.js'
import { readGps, type GpsSensor } from './gps.js'
import { readIns, type InsSensor } from './ins.js'
import { readInternalErrors, type InternalErrorEvent } from './internal-errors.js'
import { readIomcu, type IomcuReport } from './iomcu.js'
import { readLogging, readLogStats, type LoggingData, type LogStats } from './log-stats.js'
import { readMissions, type MissionData } from './missions.js'
import { interestingParamChanges, parseParamFile, readLogParams, type ParamData, type ParamHistory } from './params.js'
import { readPerformance, readStacks, type PerformanceData, type ThreadStack } from './performance.js'
import { positionOffsets, type PositionOffsets } from './position-offsets.js'
import { readFlow, readRangefinders, readViso, type PositionedSensor } from './position-sensors.js'
import { readSerialPorts, type SerialPortConfig } from './serial.js'
import { readSysFiles, type SysFilesReport } from './sys-files.js'
import { collectWarnings, type ReportWarning } from './warnings.js'
import { readWatchdogs, type WatchdogRecord } from './watchdog.js'

/** Sensors configured by parameters (upstream `load_params()`). */
export interface SensorReport {
  /** IMU slots. */
  readonly ins: readonly (InsSensor | undefined)[]
  /** Compasses. */
  readonly compass: CompassReport
  /** Barometers. */
  readonly baro: BaroReport
  /** Airspeed sensors. */
  readonly airspeed: AirspeedReport
  /** GPS slots. */
  readonly gps: readonly (GpsSensor | undefined)[]
  /** Rangefinder slots. */
  readonly rangefinders: readonly (PositionedSensor | undefined)[]
  /** Optical flow. */
  readonly flow: PositionedSensor | undefined
  /** Visual odometry. */
  readonly viso: PositionedSensor | undefined
}

/** Everything derived from parameters alone; available for logs and `.param` files. */
export interface ParamReport {
  /** Parameter values, defaults and in-log changes. */
  readonly params: ParamData
  /** In-log parameter changes worth showing (no `STAT_`). */
  readonly paramChanges: readonly ParamHistory[]
  /** Sensor inventory. */
  readonly sensors: SensorReport
  /** Sensor positions for the offset plot. */
  readonly positionOffsets: PositionOffsets
  /** `SERIALn` port configuration. */
  readonly serialPorts: readonly SerialPortConfig[]
  /** Warnings. */
  readonly warnings: readonly ReportWarning[]
}

/** Log-only time series for plots. */
export interface PlotData {
  /** Temperatures. */
  readonly temperature: TemperatureData | undefined
  /** Board voltages. */
  readonly voltage: VoltageData | undefined
  /** Power flags. */
  readonly powerFlags: PowerFlagsData | undefined
  /** CPU load, memory and loop rate. */
  readonly performance: PerformanceData | undefined
  /** Thread stacks. */
  readonly stacks: readonly ThreadStack[]
  /** UART data rates. */
  readonly uartRates: readonly UartRate[]
  /** CAN frame rates. */
  readonly canRates: readonly CanRate[]
  /** Logger drops and buffer. */
  readonly logging: LoggingData | undefined
  /** Clock drift against GPS. */
  readonly clockDrift: ClockDrift | undefined
}

/** Report for a `.param` file. */
export interface ParamFileReport extends ParamReport {
  /** Discriminant. */
  readonly source: 'params'
}

/** Report for a DataFlash log. */
export interface LogReport extends ParamReport {
  /** Discriminant. */
  readonly source: 'log'
  /** Firmware and board. */
  readonly firmware: FirmwareInfo
  /** Distinct watchdog records. */
  readonly watchdogs: readonly WatchdogRecord[]
  /** Internal error history. */
  readonly internalErrors: readonly InternalErrorEvent[]
  /** IOMCU counters. */
  readonly iomcu: IomcuReport | undefined
  /** DroneCAN nodes. */
  readonly can: CanInventory
  /** Missions, fences and rally points. */
  readonly missions: MissionData
  /** Embedded files. */
  readonly files: readonly EmbeddedFile[]
  /** Decoded `@SYS` files. */
  readonly sysFiles: SysFilesReport
  /** Log size and composition. */
  readonly logStats: LogStats
  /** Time series. */
  readonly plots: PlotData
}

/** A report from either source. */
export type HardwareReport = LogReport | ParamFileReport

function paramReport(
  params: ParamData,
  log: DataflashLog | undefined,
  can: CanInventory,
  watchdogs: readonly WatchdogRecord[],
  files: readonly EmbeddedFile[]
): ParamReport {
  const p = params.values
  const sensors: SensorReport = {
    ins: readIns(p, log, can),
    compass: readCompass(p, log, can),
    baro: readBaro(p, log, can),
    airspeed: readAirspeed(p, log, can),
    gps: readGps(p, log, can),
    rangefinders: readRangefinders(p),
    flow: readFlow(p),
    viso: readViso(p)
  }
  return {
    params,
    paramChanges: interestingParamChanges(params.changes),
    sensors,
    positionOffsets: positionOffsets(sensors),
    serialPorts: readSerialPorts(p),
    warnings: collectWarnings(p, watchdogs, files)
  }
}

/** Report for `.param`/`.parm` file text. Sensor health and log sections are unavailable. */
export function buildParamFileReport(text: string): ParamFileReport {
  return { source: 'params', ...paramReport(parseParamFile(text), undefined, EMPTY_CAN, [], []) }
}

/**
 * Report for a parsed log. Throws when the log has no parameters, which the whole tool
 * relies on (upstream alerts "No parameter values found in log").
 */
export function buildLogReport(log: DataflashLog): LogReport {
  const params = readLogParams(log)
  if (params === undefined) throw new Error('No parameter values found in log')
  // CAN first so device ids can be annotated with node names.
  const can = readCanNodes(log)
  const watchdogs = readWatchdogs(log)
  const files = readEmbeddedFiles(log)
  const p = params.values
  return {
    source: 'log',
    ...paramReport(params, log, can, watchdogs, files),
    firmware: readFirmwareInfo(log),
    watchdogs,
    internalErrors: readInternalErrors(log),
    iomcu: readIomcu(log),
    can,
    missions: readMissions(log),
    files,
    sysFiles: readSysFiles(files),
    logStats: readLogStats(log),
    plots: {
      temperature: readTemperature(log),
      voltage: readVoltage(log),
      powerFlags: readPowerFlags(log),
      performance: readPerformance(log),
      stacks: readStacks(log),
      uartRates: readUartRates(log, p),
      canRates: readCanRates(log, p),
      logging: readLogging(log),
      clockDrift: readClockDrift(log)
    }
  }
}

/**
 * Load a file chosen by the user: `.bin` files are parsed as DataFlash logs, anything else
 * as a parameter file (upstream `load()` dispatches on the extension the same way).
 */
export function loadHardwareReport(fileName: string, contents: ArrayBuffer | Uint8Array): HardwareReport {
  if (fileName.toLowerCase().endsWith('.bin')) return buildLogReport(DataflashLog.parse(contents))
  return buildParamFileReport(new TextDecoder().decode(contents))
}
