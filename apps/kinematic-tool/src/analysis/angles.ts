/** Angle helpers, ported from upstream `KinematicTool.js` (which mirrors `AP_Math`). */

export function radians(deg: number): number {
  return deg * (Math.PI / 180)
}

export function degrees(rad: number): number {
  return rad * (180 / Math.PI)
}

/** Wrap to [0, 2π). */
export function wrap2Pi(x: number): number {
  const twoPi = Math.PI * 2
  let ret = x % twoPi
  if (ret < 0) ret += twoPi
  return ret
}

/** Wrap to (-π, π]. */
export function wrapPi(x: number): number {
  let ret = wrap2Pi(x)
  if (ret > Math.PI) ret -= Math.PI * 2
  return ret
}

/** Wrap to [0, 360). */
export function wrap360(x: number): number {
  let ret = x % 360
  if (ret < 0) ret += 360
  return ret
}

/** Wrap to (-180, 180]. */
export function wrap180(x: number): number {
  let ret = wrap360(x)
  if (ret > 180) ret -= 360
  return ret
}

/** `is_positive`: strictly greater than zero, and false for NaN. */
export function isPositive(x: number): boolean {
  return x > 0
}

export function constrain(value: number, low: number, high: number): number {
  if (value < low) return low
  if (value > high) return high
  return value
}
