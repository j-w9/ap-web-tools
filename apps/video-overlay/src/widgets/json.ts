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
