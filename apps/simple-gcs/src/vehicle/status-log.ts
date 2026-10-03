/** STATUSTEXT history (upstream `SimpleGCS/app.js`, `StatusLog`): the newest 500 messages. */

export interface StatusEntry {
  /** Unix milliseconds when received. */
  readonly time: number
  /** MAV_SEVERITY, or -1 when unknown. */
  readonly severity: number
  readonly text: string
}

export const STATUS_LOG_MAX = 500
const TAGS = ['EMERG', 'ALERT', 'CRIT', 'ERR', 'WARN', 'NOTICE', 'INFO', 'DEBUG'] as const

/** Appends an entry, trimming trailing NULs and keeping the newest `STATUS_LOG_MAX`. */
export function pushStatus(
  items: readonly StatusEntry[],
  time: number,
  severity: number | undefined,
  text: string
): StatusEntry[] {
  const next = [...items, { time, severity: severity ?? -1, text: text.replace(/\0+$/, '') }]
  return next.length > STATUS_LOG_MAX ? next.slice(next.length - STATUS_LOG_MAX) : next
}

/** Severity label; unknown severities read as INFO. */
export function severityTag(severity: number): (typeof TAGS)[number] {
  return severity >= 0 && severity < TAGS.length ? TAGS[severity]! : 'INFO'
}

/** One log line: local `HH:MM:SS  [TAG] text`. */
export function formatStatus(entry: StatusEntry): string {
  return `${new Date(entry.time).toTimeString().slice(0, 8)}  [${severityTag(entry.severity)}] ${entry.text}`
}
