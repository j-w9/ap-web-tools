/** A single three-component vector `[x, y, z]`. */
export type Vec3 = readonly [number, number, number]

/** A time series of three-component vectors stored as one column per axis. */
export interface Vec3Series {
  readonly x: Float64Array
  readonly y: Float64Array
  readonly z: Float64Array
}

/** Allocate a zero-filled {@link Vec3Series} of `length` samples. */
export function vec3Series(length: number): Vec3Series {
  return { x: new Float64Array(length), y: new Float64Array(length), z: new Float64Array(length) }
}

/** Copy three numeric columns into a new {@link Vec3Series} of `Float64Array`s. */
export function vec3SeriesFrom(x: ArrayLike<number>, y: ArrayLike<number>, z: ArrayLike<number>): Vec3Series {
  return { x: Float64Array.from(x), y: Float64Array.from(y), z: Float64Array.from(z) }
}

/** Per-sample vector length `sqrt(x^2 + y^2 + z^2)` (upstream field length plot in `redraw`). */
export function vec3Magnitude(v: Vec3Series): Float64Array {
  const len = v.x.length
  const out = new Float64Array(len)
  for (let i = 0; i < len; i++) out[i] = Math.sqrt(v.x[i]! ** 2 + v.y[i]! ** 2 + v.z[i]! ** 2)
  return out
}

/**
 * Per-sample distance between two vector series (upstream `calc_error`): the length of the
 * difference vector, in the units of the inputs (mGauss here).
 */
export function vec3Distance(a: Vec3Series, b: Vec3Series): Float64Array {
  const len = a.x.length
  const out = new Float64Array(len)
  for (let i = 0; i < len; i++) {
    out[i] = Math.sqrt((a.x[i]! - b.x[i]!) ** 2 + (a.y[i]! - b.y[i]!) ** 2 + (a.z[i]! - b.z[i]!) ** 2)
  }
  return out
}
