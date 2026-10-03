// Test-only: build LogSummary and ScannedLog values with sensible defaults.
import type { LogSummary } from '../summary.js'
import type { ScannedLog } from '../table.js'

export function makeSummary(overrides: Partial<LogSummary> = {}): LogSummary {
  return {
    sizeBytes: 1024,
    vehicle: 'copter',
    version: {
      flightController: 'CubeOrange 0033003A',
      boardId: 140,
      fwString: 'ArduCopter V4.6.3 (92b0cd78)',
      fwHash: '92b0cd78',
      osString: 'ChibiOS: 88b84600',
      buildType: 2,
      filterVersion: 2
    },
    boardName: 'CUBEORANGE',
    params: new Map(),
    startTime: undefined,
    flightTimeS: undefined,
    watchdog: false,
    crashDump: false,
    distanceM: undefined,
    messageTypes: ['PARM'],
    ...overrides
  }
}

export function makeLog(relativePath: string, overrides: Partial<LogSummary> = {}): ScannedLog<string> {
  const name = relativePath.split('/').pop() ?? relativePath
  return { relativePath, name, file: relativePath, summary: makeSummary(overrides) }
}
