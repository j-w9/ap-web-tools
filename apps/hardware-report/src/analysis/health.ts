/**
 * Per-instance sensor health from log messages (upstream `array_all_equal(log.get_instance(...), 1)`).
 */
import type { DataflashLog } from '@apwt/dataflash'

/**
 * Whether every record of one instance of `message` has `field === 1`. `undefined` when the
 * field or instance is missing. An empty column counts as healthy, as upstream.
 */
export function instanceAllHealthy(log: DataflashLog, message: string, instance: number, field: string): boolean | undefined {
  const col = log.getNumbers(message, field, instance)
  if (col === undefined) return undefined
  for (let i = 0; i < col.length; i++) if (col[i] !== 1) return false
  return true
}

/**
 * Health for each logged instance of `message`, keyed by instance number. Uses the first of
 * `fields` the message has (field names changed between firmware versions).
 */
export function healthByInstance(
  log: DataflashLog | undefined,
  message: string,
  fields: readonly string[]
): ReadonlyMap<number, boolean> {
  const out = new Map<number, boolean>()
  if (log === undefined || !log.has(message)) return out
  const field = fields.find((f) => log.has(message, f))
  if (field === undefined) return out
  for (const inst of log.instances(message)) {
    const healthy = instanceAllHealthy(log, message, inst, field)
    if (healthy !== undefined) out.set(inst, healthy)
  }
  return out
}
