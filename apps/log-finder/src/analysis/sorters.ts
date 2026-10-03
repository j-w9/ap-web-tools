/**
 * Row sorting as upstream LogFinder gets it from Tabulator 6.2.1 (`modules/Sort/Sort.js` and its
 * default sorters), so the order of each board's table, and with it which rows are diffed, is the
 * same as upstream's.
 *
 * - The rows are always sorted from data (scan) order with a stable sort, so ties keep scan order.
 * - For a descending sort the two values are swapped before comparing (`_sortRow`), so "empty"
 *   values go first ascending and last descending.
 * - `undefined` values become `""` before comparing; `null` stays `null`.
 * - Columns without an explicit sorter get one guessed from the value of the first displayed row
 *   the first time they are sorted (`findSorter`), and keep it.
 */

/** A value as Tabulator passes it to a sorter. */
export type SortValue = number | string | null | Date | undefined

/** Names of the Tabulator sorters a Log Finder column can use. */
export type SorterName = 'number' | 'string' | 'datetime' | 'alphanum'

export type SortDirection = 'asc' | 'desc'

type Sorter = (a: Exclude<SortValue, undefined>, b: Exclude<SortValue, undefined>) => number

/** Tabulator `number` sorter (no thousand/decimal separators, no `alignEmptyValues`). */
function numberSorter(a: Exclude<SortValue, undefined>, b: Exclude<SortValue, undefined>): number {
  const x = parseFloat(String(a))
  const y = parseFloat(String(b))
  if (Number.isNaN(x)) return Number.isNaN(y) ? 0 : -1
  if (Number.isNaN(y)) return 1
  return x - y
}

/** Tabulator `string` sorter (no locale parameter). */
function stringSorter(a: Exclude<SortValue, undefined>, b: Exclude<SortValue, undefined>): number {
  if (!truthy(a)) return !truthy(b) ? 0 : -1
  if (!truthy(b)) return 1
  return String(a).toLowerCase().localeCompare(String(b).toLowerCase())
}

/**
 * Tabulator `datetime` sorter for luxon `DateTime` values. Log Finder's values are always
 * DateTimes (`fromJSDate`), invalid when the log has no GPS time; here a missing or invalid `Date`.
 */
function datetimeSorter(a: Exclude<SortValue, undefined>, b: Exclude<SortValue, undefined>): number {
  const x = validTime(a)
  const y = validTime(b)
  if (x === undefined) return y === undefined ? 0 : -1
  if (y === undefined) return 1
  return x - y
}

function validTime(v: Exclude<SortValue, undefined>): number | undefined {
  if (!(v instanceof Date)) return undefined
  const t = v.getTime()
  return Number.isNaN(t) ? undefined : t
}

/** Tabulator `alphanum` sorter, including its boolean return for equal prefixes. */
function alphanumSorter(as: Exclude<SortValue, undefined>, bs: Exclude<SortValue, undefined>): number {
  const empty = (v: Exclude<SortValue, undefined>) => !truthy(v) && v !== 0
  if (empty(as)) return empty(bs) ? 0 : -1
  if (empty(bs)) return 1
  if (isFiniteLoose(as) && isFiniteLoose(bs)) return Number(as) - Number(bs)
  const a = String(as).toLowerCase()
  const b = String(bs).toLowerCase()
  if (a === b) return 0
  const rd = /\d/
  if (!(rd.test(a) && rd.test(b))) return a > b ? 1 : -1
  const pa = a.match(/(\d+)|(\D+)/g) ?? []
  const pb = b.match(/(\d+)|(\D+)/g) ?? []
  const len = Math.min(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    let a1 = pa[i]!
    let b1 = pb[i]!
    if (a1 !== b1) {
      if (isFiniteLoose(a1) && isFiniteLoose(b1)) {
        if (a1.charAt(0) === '0') a1 = '.' + a1
        if (b1.charAt(0) === '0') b1 = '.' + b1
        return Number(a1) - Number(b1)
      }
      return a1 > b1 ? 1 : -1
    }
  }
  return pa.length > pb.length ? 1 : 0
}

/** JavaScript truthiness of a sort value. */
function truthy(v: Exclude<SortValue, undefined>): boolean {
  if (v === null) return false
  if (typeof v === 'number') return v !== 0 && !Number.isNaN(v)
  if (typeof v === 'string') return v !== ''
  return true
}

/** The global `isFinite`, which coerces its argument. */
function isFiniteLoose(v: Exclude<SortValue, undefined>): boolean {
  return Number.isFinite(v === null ? 0 : v instanceof Date ? v.getTime() : Number(v))
}

const SORTERS: Readonly<Record<SorterName, Sorter>> = {
  number: numberSorter,
  string: stringSorter,
  datetime: datetimeSorter,
  alphanum: alphanumSorter
}

/**
 * Tabulator `findSorter`: guess a sorter from the first displayed row's value. `undefined` gives
 * `string`; numbers, numeric strings and `null` give `number`; strings like `abc123` give
 * `alphanum`; everything else `string`.
 */
export function guessSorter(value: SortValue): SorterName {
  if (value === undefined) return 'string'
  if (value === null) return 'number'
  if (value instanceof Date) return Number.isNaN(Number(value)) ? 'string' : 'number'
  if (typeof value === 'number') return 'number'
  if (!Number.isNaN(Number(value)) && value !== '') return 'number'
  return /((^[0-9]+[a-z]+)|(^[a-z]+[0-9]+))+$/i.test(value) ? 'alphanum' : 'string'
}

/**
 * Sort `rows` (in data order) like Tabulator `_sortItems` with one sorter: stable, values swapped
 * for descending order, `undefined` read as `""`.
 */
export function tabulatorSort<T>(
  rows: readonly T[],
  value: (row: T) => SortValue,
  sorter: SorterName,
  direction: SortDirection
): T[] {
  const compare = SORTERS[sorter]
  return [...rows].sort((a, b) => {
    const first = direction === 'asc' ? a : b
    const second = direction === 'asc' ? b : a
    return compare(value(first) ?? '', value(second) ?? '')
  })
}
