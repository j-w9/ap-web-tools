/** JSON values, as found in layout files and Formio form definitions. */
export type Json = null | boolean | number | string | readonly Json[] | JsonObject
export interface JsonObject {
  readonly [key: string]: Json
}

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isJsonArray(value: Json | undefined): value is readonly Json[] {
  return Array.isArray(value)
}

/**
 * A stored value coerced to a string the way JavaScript's `String()` does, as upstream did when it
 * assigned raw option values to styles, `src` or `srcdoc` (`[object Object]` for objects).
 */
export function jsString(value: Json | undefined): string {
  if (isJsonArray(value)) return value.map((v) => (v === null ? '' : jsString(v))).join(',')
  if (isJsonObject(value)) return '[object Object]'
  return String(value)
}
