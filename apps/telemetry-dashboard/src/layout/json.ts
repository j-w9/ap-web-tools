/** JSON values, as found in layout files and Formio form definitions. */
export type Json = null | boolean | number | string | readonly Json[] | JsonObject
export interface JsonObject {
  readonly [key: string]: Json
}

/**
 * Values widgets hold and save: JSON, plus undefined members (`get_options()` before a form has
 * loaded), which `JSON.stringify` drops when saving.
 */
export type JsonLike = Json | undefined | readonly JsonLike[] | { readonly [key: string]: JsonLike }

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isJsonArray(value: Json | undefined): value is readonly Json[] {
  return Array.isArray(value)
}

/**
 * JavaScript's `String(value)` for the values layouts and widgets hold: `[object Object]` for
 * objects, arrays joined with `,` (null and undefined elements empty). Upstream relied on this
 * coercion wherever it assigned a stored value to `srcdoc`, `src`, `parseInt` or a message.
 */
export function jsString(value: unknown): string {
  if (Array.isArray(value)) return value.map((v: unknown) => (v === null || v === undefined ? '' : jsString(v))).join(',')
  if (typeof value === 'object' && value !== null) return '[object Object]'
  if (typeof value === 'symbol') return value.toString()
  return String(value)
}

/**
 * A stored value assigned to a style property, `innerHTML` or `innerText`, which convert null to
 * the empty string (`[LegacyNullToEmptyString]`) and anything else with `String()`. The browser
 * ignores invalid style values (such as "undefined"), keeping the previous one.
 */
export function domString(value: unknown): string {
  return value === null ? '' : jsString(value)
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

/** The `TypeError` V8 throws for `key in value` when `value` is not an object. */
export function inOperatorError(key: string, value: unknown): TypeError {
  return new TypeError(`Cannot use 'in' operator to search for '${key}' in ${jsString(value)}`)
}

/** `key in value`, throwing as JavaScript does when `value` is a primitive. */
export function hasKey(value: unknown, key: string): boolean {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) throw inOperatorError(key, value)
  return key in value
}

/**
 * The `TypeError` strict-mode code throws when assigning `value.key = ...` on a primitive, which
 * upstream's widget constructors did first thing (`options.about = ...`, `options.form = ...`).
 */
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

/** ToPrimitive of a JSON value: objects and arrays become their string form. */
function toPrimitive(value: unknown): string | number | boolean | null | undefined {
  if (typeof value === 'object' && value !== null) return jsString(value)
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === undefined) return value
  return jsString(value)
}

/** JavaScript's `a == b` (abstract equality) for JSON values, as upstream compared stored values. */
export function looseEquals(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined || b === null || b === undefined) {
    return (a === null || a === undefined) && (b === null || b === undefined)
  }
  if (typeof a === 'object' && typeof b === 'object') return a === b
  const pa = toPrimitive(a)
  const pb = toPrimitive(b)
  if (typeof pa === typeof pb) return pa === pb
  // Mixed primitive types compare as numbers (booleans and strings converted).
  return Number(pa) === Number(pb)
}
