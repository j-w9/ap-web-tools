// Angle wrap helpers, ported from upstream MAGFit/magfit.js.

const PI2 = Math.PI * 2

/** Wrap an angle in radians into [0, 2pi) (upstream `wrap_2PI`; only valid for angles > -2pi). */
export function wrap2Pi(rad: number): number {
  return (rad + PI2) % PI2
}

/** Wrap an angle in radians into (-pi, pi] (upstream `wrap_PI`). */
export function wrapPi(rad: number): number {
  let ret = wrap2Pi(rad)
  if (ret > Math.PI) ret -= Math.PI * 2
  return ret
}

/** Element-wise {@link wrapPi} (upstream `array_wrap_PI`). */
export function arrayWrapPi(a: ArrayLike<number>): Float64Array {
  const len = a.length
  const out = new Float64Array(len)
  for (let i = 0; i < len; i++) out[i] = wrapPi(a[i]!)
  return out
}
