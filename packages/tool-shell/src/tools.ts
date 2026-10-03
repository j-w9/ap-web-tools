/// <reference types="vite/client" />
/**
 * The registry of every tool: one place describing what a tool is, where it lives and which
 * logs it can open. The landing page and the "Open in" menu are both derived from it.
 */

/** Stable identifiers: the app directory name under `apps/` once a tool is ported. */
export const TOOL_IDS = [
  'log-finder',
  'hardware-report',
  'magfit',
  'filter-review',
  'pid-review',
  'filter-tool',
  'dfu-loader',
  'stream-stats',
  'kinematic-tool',
  'geofence-generator',
  'rotation-check',
  'sysid',
  'telemetry-dashboard',
  'analytic-tune',
  'thrust-expo',
  'ai-log-analyzer',
  'scurve-tool',
  'video-overlay',
  'airspeed-fit',
  'simple-gcs'
] as const

export type ToolId = (typeof TOOL_IDS)[number]

/** Where a tool can be used: ported into this repo, or still the original upstream page. */
export type ToolHome = 'ported' | 'original'

export type ToolCategory = 'logs' | 'setup' | 'simulation' | 'live'

/** Which logs a tool can do something useful with, for the "Open in" menu. */
export type LogAcceptance =
  { readonly kind: 'none' } | { readonly kind: 'any' } | { readonly kind: 'messages'; readonly anyOf: readonly string[] }

export interface ToolInfo {
  readonly id: ToolId
  readonly name: string
  readonly description: string
  readonly category: ToolCategory
  readonly stable: boolean
  readonly home: ToolHome
  /** Directory name in upstream WebTools, used for the original page and the readme. */
  readonly upstreamDir: string
  readonly opens: LogAcceptance
}

const NONE: LogAcceptance = { kind: 'none' }
const messages = (...anyOf: string[]): LogAcceptance => ({ kind: 'messages', anyOf })

/** Every tool, in landing-page order. Flip `home` to `'ported'` when an app lands in `apps/`. */
export const TOOLS: readonly ToolInfo[] = [
  {
    id: 'log-finder',
    name: 'Log Finder',
    description: 'Load folders of logs and sort them by flight controller, with parameter changes tracked between logs.',
    category: 'logs',
    stable: true,
    home: 'ported',
    upstreamDir: 'LogFinder',
    opens: NONE
  },
  {
    id: 'hardware-report',
    name: 'Hardware Report',
    description: 'Overview of connected hardware from a parameter file or log, including sensor health and firmware version.',
    category: 'setup',
    stable: true,
    home: 'ported',
    upstreamDir: 'HardwareReport',
    opens: messages('PARM')
  },
  {
    id: 'magfit',
    name: 'MAGFit',
    description:
      'Calibrate compasses from a flight log: offsets, iron correction, scale and motor compensation, with an orientation check.',
    category: 'logs',
    stable: true,
    home: 'ported',
    upstreamDir: 'MAGFit',
    opens: messages('MAG')
  },
  {
    id: 'filter-review',
    name: 'Filter Review',
    description: 'See the gyro noise profile from raw or batch IMU logs and try filter settings without flying again.',
    category: 'logs',
    stable: true,
    home: 'ported',
    upstreamDir: 'FilterReview',
    opens: messages('GYR', 'ISBD')
  },
  {
    id: 'pid-review',
    name: 'PID Review',
    description: 'Review a PID tune in the frequency domain, with a step response estimate for each set of gains.',
    category: 'logs',
    stable: true,
    home: 'ported',
    upstreamDir: 'PIDReview',
    opens: messages('RATE', 'PIDR', 'PIDP', 'PIDY', 'PIQR', 'PIQP', 'PIQY', 'PIDS', 'PIDA')
  },
  {
    id: 'filter-tool',
    name: 'Filter Tool',
    description: 'Bode plots of the gyro low-pass and notch filters configured in a parameter file.',
    category: 'setup',
    stable: true,
    home: 'ported',
    upstreamDir: 'FilterTool',
    opens: NONE
  },
  {
    id: 'dfu-loader',
    name: 'DFU Loader',
    description: 'Flash an ArduPilot bootloader over USB DFU.',
    category: 'setup',
    stable: true,
    home: 'ported',
    upstreamDir: 'DFULoader',
    opens: NONE
  },
  {
    id: 'stream-stats',
    name: 'Stream Stats',
    description: 'Message rate analysis for telemetry and DataFlash logs.',
    category: 'logs',
    stable: false,
    home: 'ported',
    upstreamDir: 'StreamStats',
    opens: { kind: 'any' }
  },
  {
    id: 'kinematic-tool',
    name: 'Kinematic Tool',
    description: 'Explore attitude control input shaping.',
    category: 'simulation',
    stable: false,
    home: 'ported',
    upstreamDir: 'KinematicTool',
    opens: NONE
  },
  {
    id: 'geofence-generator',
    name: 'Geofence Generator',
    description: 'Generate geofences from OpenStreetMap waterway data.',
    category: 'setup',
    stable: false,
    home: 'ported',
    upstreamDir: 'GeofenceGenerator',
    opens: NONE
  },
  {
    id: 'rotation-check',
    name: 'Rotation Check',
    description: 'Visualise board and sensor rotations.',
    category: 'simulation',
    stable: false,
    home: 'ported',
    upstreamDir: 'RotationCheck',
    opens: NONE
  },
  {
    id: 'sysid',
    name: 'SysID',
    description: 'Identify state-space or transfer-function models of vehicle dynamics.',
    category: 'logs',
    stable: false,
    home: 'original',
    upstreamDir: 'SysID',
    opens: NONE
  },
  {
    id: 'telemetry-dashboard',
    name: 'Telemetry Dashboard',
    description: 'Custom displays of a live MAVLink telemetry stream over WebSocket.',
    category: 'live',
    stable: false,
    home: 'original',
    upstreamDir: 'TelemetryDashboard',
    opens: NONE
  },
  {
    id: 'analytic-tune',
    name: 'Analytic Tune',
    description: 'Tune a multirotor or heli analytically from system identification flight data.',
    category: 'logs',
    stable: false,
    home: 'ported',
    upstreamDir: 'AnalyticTune',
    opens: NONE
  },
  {
    id: 'thrust-expo',
    name: 'Thrust Expo',
    description: 'Fit MOT_THST_EXPO from thrust stand data for a linear thrust response.',
    category: 'setup',
    stable: false,
    home: 'ported',
    upstreamDir: 'ThrustExpo',
    opens: NONE
  },
  {
    id: 'ai-log-analyzer',
    name: 'AI Log Analyzer',
    description: 'Ask an AI agent questions about a log.',
    category: 'logs',
    stable: false,
    home: 'original',
    upstreamDir: 'AILogAnalyzer',
    opens: { kind: 'any' }
  },
  {
    id: 'scurve-tool',
    name: 'S-Curve Tool',
    description: 'Explore the S-curve trajectories used for waypoint navigation.',
    category: 'simulation',
    stable: false,
    home: 'ported',
    upstreamDir: 'SCurveTool',
    opens: NONE
  },
  {
    id: 'video-overlay',
    name: 'Video Overlay',
    description: 'Overlay log telemetry on flight video and export the result.',
    category: 'logs',
    stable: false,
    home: 'original',
    upstreamDir: 'VideoOverlay',
    opens: NONE
  },
  {
    id: 'airspeed-fit',
    name: 'Airspeed Fit',
    description: 'Calibrate ARSPD_RATIO for each airspeed sensor from a flight log.',
    category: 'logs',
    stable: false,
    home: 'ported',
    upstreamDir: 'AirspeedFit',
    opens: messages('ARSP')
  },
  {
    id: 'simple-gcs',
    name: 'Simple GCS',
    description: 'A small web ground station for boats and buoys, with secure WebSocket support.',
    category: 'live',
    stable: false,
    home: 'original',
    upstreamDir: 'SimpleGCS',
    opens: NONE
  }
] satisfies readonly ToolInfo[]

const ORIGINAL_BASE = 'https://firmware.ardupilot.org/Tools/WebTools/'

/** Where a page is, so relative links resolve: the landing page or a tool page. */
export type PageLocation = 'home' | 'tool'

/** Link to a tool from a page. Ported tools are relative links; others go to the original site. */
export function toolHref(tool: ToolInfo, from: PageLocation): string {
  if (tool.home === 'original') return `${ORIGINAL_BASE}${tool.upstreamDir}/`
  return from === 'home' ? `apps/${tool.id}/` : `../${tool.id}/`
}

/** Link to the tool's documentation. */
export function toolReadme(tool: ToolInfo): string {
  return `https://github.com/ArduPilot/WebTools/blob/main/${tool.upstreamDir}/Readme.md`
}

/** Look up a tool by id. */
export function toolById(id: ToolId): ToolInfo {
  const tool = TOOLS.find((t) => t.id === id)
  if (!tool) throw new Error(`Unknown tool ${id}`)
  return tool
}

/** Whether a tool can do something with a log containing these message types (null: unknown). */
export function acceptsLog(tool: ToolInfo, messageTypes: readonly string[] | null): boolean {
  switch (tool.opens.kind) {
    case 'none':
      return false
    case 'any':
      return true
    case 'messages': {
      const { anyOf } = tool.opens
      return messageTypes === null || anyOf.some((m) => messageTypes.includes(m))
    }
  }
}

const ICONS = import.meta.glob<string>('./assets/icons/*', { eager: true, import: 'default', query: '?url' })

/** Icon URL for a tool, or undefined when it has none. */
export function toolIcon(tool: ToolInfo): string | undefined {
  return ICONS[`./assets/icons/${tool.upstreamDir}.png`]
}

/** Icon for UAV Log Viewer, which is external. */
export const UAV_LOG_VIEWER_ICON = ICONS['./assets/icons/UAVLogViewer.gif']
