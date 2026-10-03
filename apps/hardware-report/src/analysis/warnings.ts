/**
 * Warnings shown at the top of the report (upstream `add_warning()` call sites).
 */
import type { EmbeddedFile } from './files.js'
import type { ParamValues } from './params.js'
import type { WatchdogRecord } from './watchdog.js'

/** Severity: upstream red (`exclamation-triangle-red`) or orange icon. */
export type WarningLevel = 'error' | 'warning'

/** One warning. */
export interface ReportWarning {
  /** What triggered it. */
  readonly kind: 'watchdog' | 'crashDump' | 'armingChecksDisabled'
  /** Severity. */
  readonly level: WarningLevel
  /** Message text. */
  readonly message: string
  /** Documentation link, if any. */
  readonly link: string | undefined
}

const WATCHDOG_DOCS = 'https://ardupilot.org/copter/docs/common-watchdog.html#independent-watchdog-and-crash-dump'
const CRASH_DUMP_DOCS = 'https://ardupilot.org/copter/docs/common-watchdog.html#crash-dump'

/** Arming checks are disabled by `ARMING_SKIPCHK != 0` or `ARMING_CHECK == 0`. */
export function armingChecksDisabled(params: ParamValues): boolean {
  const skip = params.get('ARMING_SKIPCHK')
  return (skip !== undefined && skip !== 0) || params.get('ARMING_CHECK') === 0
}

/**
 * Collect warnings in upstream order: arming checks (raised while loading params), watchdog,
 * then one per crash dump file.
 */
export function collectWarnings(
  params: ParamValues,
  watchdogs: readonly WatchdogRecord[],
  files: readonly EmbeddedFile[]
): ReportWarning[] {
  const out: ReportWarning[] = []
  if (armingChecksDisabled(params)) {
    out.push({ kind: 'armingChecksDisabled', level: 'warning', message: 'Arming checks disabled', link: undefined })
  }
  if (watchdogs.length > 0) {
    out.push({
      kind: 'watchdog',
      level: 'error',
      message: 'Watchdog reboot detected, see Watchdog section.',
      link: WATCHDOG_DOCS
    })
  }
  for (const f of files) {
    if (f.isCrashDump)
      out.push({ kind: 'crashDump', level: 'error', message: 'Crash dump file detected.', link: CRASH_DUMP_DOCS })
  }
  return out
}
