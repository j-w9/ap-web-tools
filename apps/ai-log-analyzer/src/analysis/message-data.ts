/**
 * The `get` tool's data (upstream `window.get` in logAnalyzer.js): every field of one message type,
 * as upstream's `log.get(message)` / `log.get_instance(message, inst)` returned it.
 *
 * Reproduced upstream behaviour (see docs/audit/ai-log-analyzer.md):
 * - For an instanced message upstream loops over the instances and keeps only the last one, so
 *   e.g. `IMU` returns the highest IMU instance only.
 * - Numeric columns are typed arrays, which `JSON.stringify` writes as `{"0": …, "1": …}` objects;
 *   text and int16[32] fields are arrays. The JSON text matches upstream (oracle test).
 */
import type { Column, DataflashLog, NumericColumn } from '@apwt/dataflash'

/** A column as upstream's parser held it: a typed array, or a plain array for text and int16[32]. */
export type UpstreamColumn = NumericColumn | readonly string[] | readonly (readonly number[])[]

/** Field name to column, in message order (upstream parser `parse_all` result). */
export type MessageColumns = Readonly<Record<string, UpstreamColumn>>

function upstreamColumn(column: Column): UpstreamColumn {
  if (ArrayBuffer.isView(column) || isTextColumn(column)) return column
  // Upstream decodes each int16[32] value to a plain array.
  return column.map((values) => Array.from(values))
}

function isTextColumn(column: string[] | Int16Array[]): column is string[] {
  return column.every((v) => typeof v === 'string')
}

/** Upstream `get(message)` data: `undefined` when the type is unknown or has no records. */
export function getMessageColumns(log: DataflashLog, messageType: string): MessageColumns | undefined {
  const info = log.messageType(messageType)
  if (info === undefined) return undefined
  const last = log.instances(messageType).at(-1)
  const parsed = last === undefined ? log.getMessage(messageType) : log.getMessage(messageType, last)
  if (parsed === undefined || parsed.length === 0) return undefined
  const out: Record<string, UpstreamColumn> = {}
  for (const name of info.fieldNames) {
    const column = parsed.columns[name]
    if (column !== undefined) out[name] = upstreamColumn(column)
  }
  return out
}

/** One line for the activity list, e.g. "ATT: 25 records, 9 fields". */
export function describeColumns(messageType: string, columns: MessageColumns): string {
  const fields = Object.values(columns)
  return `${messageType}: ${fields[0]?.length ?? 0} records, ${fields.length} fields`
}
