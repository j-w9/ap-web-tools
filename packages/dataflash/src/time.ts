/** Microseconds to seconds. `1 / 1000000` and `1e-6` are the same double, so results match upstream bit for bit. */
export const US_TO_S = 1 / 1000000

/** Convert a `TimeUS` column (microseconds since boot) to seconds. */
export function timeUsToSeconds(timeUs: ArrayLike<number>): Float64Array {
  const out = new Float64Array(timeUs.length)
  for (let i = 0; i < out.length; i++) out[i] = timeUs[i]! * US_TO_S
  return out
}
