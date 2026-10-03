/** JSON values as layouts, widget options and Formio forms carry them. */
export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject
export interface JsonObject {
  [key: string]: JsonValue
}

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Narrow `unknown` (e.g. from `JSON.parse`) to a JSON object, or `undefined`. */
export function asJsonObject(value: unknown): JsonObject | undefined {
  return isJsonObject(value) ? value : undefined
}

/** Parse JSON text; the result is `unknown` until narrowed. */
export function parseJson(text: string): unknown {
  return JSON.parse(text)
}

/** JavaScript's `String(value)` for a JSON value (objects print as "[object Object]"). */
export function jsString(value: JsonValue | undefined): string {
  if (Array.isArray(value)) return value.map((v) => (v === null ? '' : jsString(v))).join(',')
  if (typeof value === 'object' && value !== null) return '[object Object]'
  return String(value)
}

/**
 * Values widgets hold and save: JSON, plus undefined members (`get_options()` before a form has
 * loaded), which `JSON.stringify` drops when saving.
 */
export type JsonLike = JsonValue | undefined | readonly JsonLike[] | { readonly [key: string]: JsonLike }

/** Widget options: stored JSON, or (copying a widget) `get_options()`, whose members may be undefined. */
export interface OptionsObject {
  readonly [key: string]: JsonLike
}

/** JavaScript's `String(value)` for any value (unlike {@link jsString}, which serves JSON values). */
export function anyString(value: unknown): string {
  if (Array.isArray(value)) return value.map((v: unknown) => (v === null || v === undefined ? '' : anyString(v))).join(',')
  if (typeof value === 'object' && value !== null) return '[object Object]'
  if (typeof value === 'symbol') return value.toString()
  return String(value)
}

/**
 * A stored value assigned to a style property, `innerHTML` or `innerText`, which convert null to
 * the empty string and anything else with `String()`. The browser ignores invalid style values
 * (such as "undefined"), keeping the previous one.
 */
export function domString(value: unknown): string {
  return value === null ? '' : anyString(value)
}

/** `value.key` as JavaScript reads it from any value (undefined on primitives and missing keys). */
export function prop(value: unknown, key: string): JsonLike {
  if (value === null || value === undefined) return undefined
  const read: unknown = Reflect.get(Object(value), key)
  return read as JsonLike
}

/** The `TypeError` V8 throws for `value.key` when `value` is null or undefined. */
export function nullPropertyError(value: null | undefined, key: string): TypeError {
  return new TypeError(`Cannot read properties of ${String(value)} (reading '${key}')`)
}

/** `key in value`, throwing as JavaScript does when `value` is a primitive. */
export function hasKey(value: unknown, key: string): boolean {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    throw new TypeError(`Cannot use 'in' operator to search for '${key}' in ${anyString(value)}`)
  }
  return key in value
}

/** The `TypeError` strict-mode code throws for `value.key = ...` on a primitive. */
export function primitiveAssignmentError(key: string, value: string | number | boolean): TypeError {
  return new TypeError(`Cannot create property '${key}' on ${typeof value} '${String(value)}'`)
}

/** `Object.values(value)` as JavaScript computes it (throws for null and undefined). */
export function objectValues(value: unknown): unknown[] {
  if (value === null || value === undefined) throw new TypeError('Cannot convert undefined or null to object')
  if (typeof value === 'string') return Array.from({ length: value.length }, (_, i) => value.charAt(i))
  if (typeof value !== 'object') return []
  return Object.values(value)
}

function toPrimitive(value: unknown): string | number | boolean | undefined {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === undefined) return value
  return anyString(value)
}

/** JavaScript's `a == b` for JSON values, as upstream compared stored values. */
export function looseEquals(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined || b === null || b === undefined) {
    return (a === null || a === undefined) && (b === null || b === undefined)
  }
  if (typeof a === 'object' && typeof b === 'object') return a === b
  const pa = toPrimitive(a)
  const pb = toPrimitive(b)
  if (typeof pa === typeof pb) return pa === pb
  return Number(pa) === Number(pb)
}
