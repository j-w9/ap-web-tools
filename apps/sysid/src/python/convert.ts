/**
 * The Pyodide boundary on the way out. Upstream reads its results back with
 * `pyodide.globals.get('freq_js')` etc.; those values were made with `to_js` in Python, so they
 * arrive as JavaScript arrays (or typed arrays for numpy data). Anything still wrapped in a
 * `PyProxy` is converted and the proxy destroyed. The plain data is then checked and turned into
 * typed results, so a mismatch fails loudly instead of as a blank plot.
 */

/** The part of Pyodide's `PyProxy` this module needs; real proxies satisfy it. */
export interface ConvertibleProxy {
  toJs(options: { dict_converter: (entries: Iterable<[string, unknown]>) => unknown; create_pyproxies: boolean }): unknown
  destroy(): void
}

export function isConvertibleProxy(value: unknown): value is ConvertibleProxy {
  return (
    typeof value === 'object' &&
    value !== null &&
    'toJs' in value &&
    typeof value.toJs === 'function' &&
    'destroy' in value &&
    typeof value.destroy === 'function'
  )
}

/** Plain JavaScript for a value read from Python; a `PyProxy` is converted deeply and released. */
export function toPlain(value: unknown): unknown {
  if (!isConvertibleProxy(value)) return value
  try {
    return value.toJs({ dict_converter: (entries) => Object.fromEntries(entries), create_pyproxies: false })
  } finally {
    value.destroy()
  }
}

function fail(name: string, expected: string): never {
  throw new Error(`Unexpected result from Python: ${name} is not ${expected}`)
}

type NumberTypedArray =
  Float64Array | Float32Array | Int8Array | Uint8Array | Uint8ClampedArray | Int16Array | Uint16Array | Int32Array | Uint32Array

function isNumberTypedArray(value: unknown): value is NumberTypedArray {
  return (
    ArrayBuffer.isView(value) &&
    !(value instanceof DataView) &&
    !(value instanceof BigInt64Array) &&
    !(value instanceof BigUint64Array)
  )
}

/** A flat series of numbers from a JavaScript array or typed array (numpy data arrives as the latter). */
export function numberSeries(value: unknown, name: string): Float64Array {
  if (isNumberTypedArray(value)) return Float64Array.from(value)
  if (!Array.isArray(value)) fail(name, 'a list')
  const items = value as readonly unknown[]
  const out = new Float64Array(items.length)
  for (let i = 0; i < items.length; i++) {
    const v = items[i]
    if (typeof v !== 'number') fail(`${name}[${i}]`, 'a number')
    out[i] = v
  }
  return out
}

/** A list of number series (one per output). */
export function seriesList(value: unknown, name: string): Float64Array[] {
  if (!Array.isArray(value)) fail(name, 'a list')
  return (value as readonly unknown[]).map((row, i) => numberSeries(row, `${name}[${i}]`))
}
