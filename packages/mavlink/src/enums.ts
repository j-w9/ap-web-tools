import type { EnumObject } from './descriptor.js'

/** Name of the entry of `enumObject` with `value` (the first, if several share it). */
export function enumName<E extends EnumObject>(enumObject: E, value: number): Extract<keyof E, string> | undefined {
  for (const name in enumObject) if (enumObject[name] === value) return name
  return undefined
}

/** Entries of `enumObject` by ascending value. */
export function enumEntries<E extends EnumObject>(
  enumObject: E
): { readonly name: Extract<keyof E, string>; readonly value: E[keyof E] }[] {
  const entries: { readonly name: Extract<keyof E, string>; readonly value: E[keyof E] }[] = []
  for (const name in enumObject) entries.push({ name, value: enumObject[name] })
  return entries.sort((a, b) => a.value - b.value)
}

/** Names of the flags of a bitmask enum set in `mask`, by ascending value. */
export function flagNames<E extends EnumObject>(enumObject: E, mask: number | bigint): Extract<keyof E, string>[] {
  const bits = BigInt(mask)
  return enumEntries(enumObject)
    .filter(({ value }) => value !== 0 && (bits & BigInt(value)) === BigInt(value))
    .map(({ name }) => name)
}
