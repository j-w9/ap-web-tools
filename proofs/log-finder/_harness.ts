// Test-only: runs the original LogFinder.js (with LogHelpers.js and Param_Helpers.js) in a vm
// context with a small fake DOM. `Tabulator` is a stand-in whose row order, sorter choice and
// `getRows()` come from the original Tabulator 6.2.1 sources LogFinder loads
// (`upstream/modules/tabulator`): `Sort.prototype.sort` (with `findSorter` and `_sortItems`) and
// `RowManager.prototype.getComponents` / `getRows`, run on a row list in data order exactly as
// `RowManager.refreshPipelines` hands it to the sort data handler.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'
import * as luxon from 'luxon'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8')

/** One fake DOM node. */
export class FakeElement {
  checked = false
  disabled = false
  readonly style: Record<string, string> = {}
  readonly children: FakeElement[] = []
  readonly attributes = new Map<string, string>()
  private readonly listeners = new Map<string, (() => void)[]>()
  parentElement: FakeElement | null = null

  constructor(
    readonly nodeName: string,
    private readonly ownText = ''
  ) {}

  get textContent(): string {
    return this.ownText + this.children.map((c) => c.textContent).join('')
  }

  setAttribute(name: string, value: unknown): void {
    this.attributes.set(name, String(value))
  }

  appendChild(child: FakeElement): FakeElement {
    child.parentElement = this
    this.children.push(child)
    return child
  }

  replaceChildren(): void {
    this.children.length = 0
  }

  addEventListener(type: string, fn: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn])
  }

  /** Fire the listeners registered for `type`, as the browser does on a user action. */
  dispatch(type: string): void {
    for (const fn of this.listeners.get(type) ?? []) fn()
  }
}

class FakeDocument {
  title = ''
  private readonly byId = new Map<string, FakeElement>()

  getElementById(id: string): FakeElement {
    let el = this.byId.get(id)
    if (el === undefined) {
      el = new FakeElement('div')
      new FakeElement('div').appendChild(el)
      this.byId.set(id, el)
    }
    return el
  }

  createElement(tag: string): FakeElement {
    return new FakeElement(tag)
  }

  createTextNode(text: unknown): FakeElement {
    return new FakeElement('#text', String(text))
  }
}

/** Row data as LogFinder hands it to Tabulator (`{ info, fileHandle }`), plus what it adds. */
export interface RowData {
  info: Record<string, unknown> & { params: Record<string, number> }
  fileHandle: { relativePath: string; name: string }
  param_diff?: Diff | null
}

export interface Diff {
  added: Record<string, number>
  missing: Record<string, number>
  changed: Record<string, { from: number; to: number }>
}

export interface Row {
  getData(): RowData
  getComponent(): Row
}

type SorterFn = (...args: unknown[]) => number

interface ColumnDefinition {
  title: string
  field?: string
  sorter?: string
  sorterParams?: object
  formatter?: unknown
}

interface Column {
  definition: ColumnDefinition
  modules: { sort: { sorter: SorterFn | false; dir: string; params: object } }
  getField(): string | undefined
  getFieldValue(data: RowData): unknown
  getComponent(): Column
}

interface SortItem {
  column: Column
  dir: 'asc' | 'desc'
  params?: object
}

interface SortModule {
  sorters: Record<string, SorterFn>
  prototype: object & { sort(this: object, data: Row[]): Row[] }
}

interface RowManagerModule {
  prototype: object & { getComponents(this: object, active?: string): Row[] }
}

/** One table LogFinder created, driven like Tabulator 6.2.1. */
export class FakeTabulator {
  readonly rows: Row[]
  readonly columns: Column[]
  private readonly handlers = new Map<string, ((...args: unknown[]) => void)[]>()
  private readonly rowManager: { rows: Row[]; activeRows: Row[]; chain: () => undefined }
  private sortList: SortItem[]
  redraws = 0

  constructor(
    readonly element: FakeElement,
    readonly options: {
      data: RowData[]
      columns: ColumnDefinition[]
      initialSort: { column: string; dir: 'asc' | 'desc' }[]
    },
    private readonly Sort: SortModule,
    private readonly RowManager: RowManagerModule
  ) {
    this.rows = options.data.map((data) => {
      const row: Row = { getData: () => data, getComponent: () => row }
      return row
    })
    // `Sort.initializeColumn`: a named sorter is looked up, anything else is guessed on first sort.
    this.columns = options.columns.map((definition) => {
      const field = definition.field
      const column: Column = {
        definition,
        modules: {
          sort: {
            sorter: definition.sorter === undefined ? false : (Sort.sorters[definition.sorter] ?? false),
            dir: 'none',
            params: definition.sorterParams ?? {}
          }
        },
        getField: () => field,
        getFieldValue: (data) =>
          field?.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], data),
        getComponent: () => column
      }
      return column
    })
    this.rowManager = { rows: this.rows, activeRows: [...this.rows], chain: () => undefined }
    this.sortList = options.initialSort.map((s) => ({ column: this.column(s.column), dir: s.dir }))
  }

  private column(field: string): Column {
    const c = this.columns.find((col) => col.definition.field === field)
    if (c === undefined) throw new Error(`no column ${field}`)
    return c
  }

  on(event: string, fn: (...args: unknown[]) => void): void {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), fn])
  }

  /** `RowManager.refreshPipelines` → sort data handler on a copy of the rows in data order. */
  private refresh(): void {
    const self = Object.assign(Object.create(this.Sort.prototype) as object, {
      table: { options: { sortOrderReverse: false, sortMode: 'local' }, rowManager: this.rowManager },
      sortList: this.sortList,
      subscribedExternal: (event: string) => this.handlers.has(event),
      dispatchExternal: (event: string, ...args: unknown[]) => {
        for (const fn of this.handlers.get(event) ?? []) fn(...args)
      },
      clearColumnHeaders: () => undefined,
      setColumnHeader: () => undefined
    })
    this.rowManager.activeRows = this.Sort.prototype.sort.call(self, this.rows.slice(0))
  }

  /** The delayed `_create()` (Tabulator builds in a `setTimeout`): load data, apply `initialSort`. */
  build(): void {
    this.refresh()
  }

  /** A header click (`Sort.setSort` then refresh). */
  setSort(field: string, dir: 'asc' | 'desc'): void {
    this.sortList = [{ column: this.column(field), dir }]
    this.refresh()
  }

  /** `Tabulator.getRows(active)` → `RowManager.getComponents(active)`, original code. */
  getRows(active?: string): Row[] {
    const rm = Object.assign(Object.create(this.RowManager.prototype) as object, this.rowManager)
    return this.RowManager.prototype.getComponents.call(rm, active)
  }

  /** Rows in display order (`activeRows`; no filters or pagination are configured). */
  displayed(): Row[] {
    return [...this.rowManager.activeRows]
  }

  redraw(): void {
    this.redraws++
  }

  /** Name of the `Sort.sorters` entry the column currently uses (`false` before the first sort). */
  sorterName(field: string): string | false {
    const fn = this.column(field).modules.sort.sorter
    if (fn === false) return false
    return Object.entries(this.Sort.sorters).find(([, f]) => f === fn)?.[0] ?? '?'
  }

  formatter(field: string): (cell: { getRow(): Row }) => unknown {
    const f = this.column(field).definition.formatter
    if (typeof f !== 'function') throw new Error(`no formatter on ${field}`)
    return f as (cell: { getRow(): Row }) => unknown
  }
}

export interface LogFinderPage {
  document: FakeDocument
  tables: FakeTabulator[]
  /** The ignore checkboxes `initial_load` created (`param_diff_ignore[i].check`). */
  ignoreChecks: FakeElement[]
  /** Run the original `setup_table(logs)`, then let each table build (the delayed `_create`). */
  setupTable(logs: Record<string, RowData>): void
}

/** Load the original page: evaluate the scripts, then run `initial_load()` as `<body onload>` does. */
export async function loadLogFinder(): Promise<LogFinderPage> {
  Reflect.set(globalThis, 'luxon', luxon)
  if (!('window' in globalThis)) Reflect.set(globalThis, 'window', {})
  const tab = 'upstream/modules/tabulator/src/js'
  const Sort = ((await import(/* @vite-ignore */ resolve(root, `${tab}/modules/Sort/Sort.js`))) as { default: SortModule })
    .default
  const RowManager = (
    (await import(/* @vite-ignore */ resolve(root, `${tab}/core/RowManager.js`))) as { default: RowManagerModule }
  ).default

  const document = new FakeDocument()
  const tables: FakeTabulator[] = []
  const context = createContext({
    document,
    window: { showDirectoryPicker: () => undefined },
    luxon,
    Tabulator: function (this: unknown, el: FakeElement, options: FakeTabulator['options']) {
      const t = new FakeTabulator(el, options, Sort, RowManager)
      tables.push(t)
      return t
    },
    fetch: () => new Promise(() => undefined),
    alert: () => undefined,
    performance: { now: () => 0 },
    console: { log: () => undefined, warn: () => undefined, error: () => undefined }
  })
  // Drop only the dynamic parser import (not needed by the table code).
  const page = read('upstream/LogFinder/LogFinder.js').replace(/^import\(.*$/m, '')
  runInContext(
    [read('upstream/Libraries/LogHelpers.js'), read('upstream/Libraries/Param_Helpers.js'), page].join('\n;\n'),
    context,
    { filename: 'LogFinder.js' }
  )
  await (runInContext('initial_load()', context) as Promise<void>)
  const ignoreChecks = runInContext('param_diff_ignore.map((i) => i.check)', context) as FakeElement[]

  return {
    document,
    tables,
    ignoreChecks,
    setupTable(logs) {
      const before = tables.length
      context['__logs'] = logs
      runInContext('setup_table(__logs)', context)
      for (const t of tables.slice(before)) t.build()
    }
  }
}

/** A log row as LogFinder's `load_from_dir` stores it. */
export function logRow(relativePath: string, info: Partial<RowData['info']> = {}): RowData {
  const name = relativePath.replace(/.*\//, '')
  return {
    info: { params: {}, name, rel_path: relativePath, size: 0, ...info },
    fileHandle: { relativePath, name }
  }
}

/** `luxon.DateTime.fromJSDate`, as `load_log` stores the start time. */
export const dateTime = (iso: string): luxon.DateTime => luxon.DateTime.fromJSDate(new Date(iso))
