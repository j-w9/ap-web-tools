// Test-only: the upstream Tabulator 6.2.1 sort module (upstream/modules/tabulator, the version
// LogFinder loads), driven without a DOM so the port's row order can be compared with it.
import { resolve } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as luxon from 'luxon'
import type { UpstreamRow, UpstreamRowData } from './upstream.js'

const here = dirname(fileURLToPath(import.meta.url))
const sortPath = resolve(here, '../../../../../upstream/modules/tabulator/src/js/modules/Sort/Sort.js')

type SorterFn = (...args: unknown[]) => number
interface FakeColumn {
  definition: { field: string }
  modules: { sort: { sorter: SorterFn | false } }
  getField(): string
  getFieldValue(data: UpstreamRowData): unknown
  getComponent(): FakeColumn
}
interface SortClass {
  sorters: Record<string, SorterFn>
  prototype: {
    findSorter(this: unknown, column: FakeColumn): SorterFn
    _sortItems(this: unknown, rows: FakeRow[], list: { column: FakeColumn; dir: string; params: object }[]): void
    _sortRow(this: unknown, ...args: unknown[]): number
  }
}
interface FakeRow extends UpstreamRow {
  getComponent(): FakeRow
}

let sortClass: SortClass | undefined

async function loadSort(): Promise<SortClass> {
  // The datetime sorter reads `window.DateTime || luxon.DateTime`.
  Reflect.set(globalThis, 'luxon', luxon)
  if (!('window' in globalThis)) Reflect.set(globalThis, 'window', {})
  sortClass ??= ((await import(/* @vite-ignore */ sortPath)) as { default: SortClass }).default
  return sortClass
}

/**
 * One upstream table: rows in data order, column sorters fixed on first use (guessed from the
 * first displayed row when not explicit), sorted like `Sort.sort` / `_sortItems`.
 */
export class UpstreamTable {
  private readonly columns = new Map<string, FakeColumn>()
  /** Rows in display order (Tabulator's active rows). */
  active: FakeRow[]

  private constructor(
    private readonly Sort: SortClass,
    readonly rows: FakeRow[]
  ) {
    this.active = [...rows]
  }

  static async create(data: UpstreamRowData[]): Promise<UpstreamTable> {
    const rows = data.map((d) => {
      const row: FakeRow = { getData: () => d, getComponent: () => row }
      return row
    })
    return new UpstreamTable(await loadSort(), rows)
  }

  private column(field: string): FakeColumn {
    let col = this.columns.get(field)
    if (col === undefined) {
      const explicit = field === 'info.time_stamp' ? this.Sort.sorters['datetime']! : false
      const c: FakeColumn = {
        definition: { field },
        modules: { sort: { sorter: explicit } },
        getField: () => field,
        getFieldValue: (data) => field.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], data),
        getComponent: () => c
      }
      col = c
      this.columns.set(field, col)
    }
    return col
  }

  /** Sort by `field` from data order, as a header click or `initialSort` does. */
  sort(field: string, dir: 'asc' | 'desc'): UpstreamRow[] {
    const column = this.column(field)
    const proto = this.Sort.prototype
    const self = {
      table: { rowManager: { activeRows: this.active } },
      _sortRow: (...args: unknown[]) => proto._sortRow.apply(self, args)
    }
    if (column.modules.sort.sorter === false) column.modules.sort.sorter = proto.findSorter.call(self, column)
    const data = [...this.rows]
    proto._sortItems.call(self, data, [{ column, dir, params: {} }])
    this.active = data
    return data
  }
}
