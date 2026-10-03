/**
 * Instance splitting. Many sensor messages (IMU, MAG, BAT, GPS, ...) carry an
 * instance-number field, flagged by the unit id `#` in FMTU. Records are
 * grouped by that field so each instance can be read as its own time series.
 */
import { readNumber, type TypeCode } from './format.js'

/**
 * Group record offsets by the value of the instance field.
 *
 * @param offsets Body offsets of every record of the type.
 * @param fieldOffset Byte offset of the instance field within the body.
 * @param type Type code of the instance field (normally `B`).
 * @returns Map from instance number to that instance's offsets, keyed in
 * ascending instance order.
 */
export function splitInstances(
  view: DataView,
  offsets: Uint32Array,
  fieldOffset: number,
  type: TypeCode
): Map<number, Uint32Array> {
  const len = offsets.length
  const values = new Float64Array(len)
  const counts = new Map<number, number>()
  for (let i = 0; i < len; i++) {
    const v = readNumber(view, (offsets[i] as number) + fieldOffset, type)
    values[i] = v
    counts.set(v, (counts.get(v) ?? 0) + 1)
  }

  const result = new Map<number, Uint32Array>()
  const cursors = new Map<number, number>()
  for (const [instance, count] of [...counts].sort((a, b) => a[0] - b[0])) {
    result.set(instance, new Uint32Array(count))
    cursors.set(instance, 0)
  }
  for (let i = 0; i < len; i++) {
    const instance = values[i] as number
    const cursor = cursors.get(instance) as number
    ;(result.get(instance) as Uint32Array)[cursor] = offsets[i] as number
    cursors.set(instance, cursor + 1)
  }
  return result
}
