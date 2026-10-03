// Oracle: upstream's add_widget, load_widgets and load_layout (VideoOverlay.js) run in
// node:vm against a recording fake grid and fake widget classes, and the port's loader against the
// same fakes; the sequence of grid operations, widget constructions, alerts and errors must match.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createContext, runInContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { upstreamDir as UPSTREAM_DIR } from '../test-utils/upstream.js'
import type { JsonLike } from './json.js'
import type { GridPosition } from './layout-file.js'
import { addWidget, loadLayout, loadWidgets, type OverlayLayoutTarget } from './loader.js'

type Log = unknown[][]

function functionSource(text: string, name: string): string {
  const start = text.indexOf(`function ${name}(`)
  if (start === -1) throw new Error(`${name} not found`)
  let depth = 0
  for (let i = text.indexOf('{', start); i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}' && --depth === 0) return text.slice(start, i + 1)
  }
  throw new Error(`unbalanced ${name}`)
}

class FakeItem {
  constructor(
    private readonly log: Log,
    readonly type: string,
    readonly id: number
  ) {}
  init(): void {
    this.log.push(['init', this.type, this.id])
  }
  loadLog(): void {
    this.log.push(['loadLog', this.id])
  }
  set_edit(b: boolean): void {
    this.log.push(['set_edit', this.id, b])
  }
  destroy(): void {
    this.log.push(['destroy', this.id])
  }
}

/** A grid with room for `columns` widgets in one row of `rows` cells. */
class FakeGrid {
  readonly items: FakeItem[] = []
  readonly opts: { disableDrag: boolean; disableResize: boolean; column: number; maxRow: number }
  constructor(
    private readonly log: Log,
    columns: number,
    rows: number
  ) {
    this.opts = { disableDrag: true, disableResize: true, column: columns, maxRow: rows }
  }
  willItFit(pos: { x?: number | null; y?: number | null; w?: number | null; h?: number | null; autoPosition: boolean }): boolean {
    const p = [pos.x ?? null, pos.y ?? null, pos.w ?? null, pos.h ?? null, pos.autoPosition]
    const fits = pos.autoPosition
      ? this.items.length < this.opts.column
      : pos.x !== null && pos.x !== undefined && pos.x < this.opts.column
    this.log.push(['willItFit', ...p, fits])
    return fits
  }
  addWidget(item: FakeItem, pos: { x?: number | null; autoPosition: boolean }): void {
    this.log.push(['addWidget', item.id, pos.x ?? null, pos.autoPosition])
    this.items.push(item)
  }
  batchUpdate(b: boolean): void {
    this.log.push(['batchUpdate', b])
  }
  getGridItems(): FakeItem[] {
    return [...this.items]
  }
  enable(): void {
    this.opts.disableDrag = this.opts.disableResize = false
    this.log.push(['enable'])
  }
  disable(): void {
    this.opts.disableDrag = this.opts.disableResize = true
    this.log.push(['disable'])
  }
  removeWidget(item: FakeItem): void {
    this.log.push(['removeWidget', item.id])
  }
  removeAll(): void {
    this.log.push(['removeAll'])
  }
  destroy(): void {
    this.log.push(['destroyGrid'])
  }
  on(): void {}
}

/** Widget classes: construction is logged; options "boom" make the constructor throw. */
function makeWidget(log: Log, counter: { n: number }, type: string, options: unknown): FakeItem {
  log.push(['new', type, structuredClone(options)])
  if (options === 'boom') throw new Error('constructor failed')
  return new FakeItem(log, type, counter.n++)
}

const SOURCE = readFileSync(resolve(UPSTREAM_DIR, 'VideoOverlay/VideoOverlay.js'), 'utf8')
const UPSTREAM_FUNCTIONS = ['add_widget', 'load_widgets', 'load_layout', 'grid_set_edit', 'init_grid', 'clear_grid', 'new_widget']

type Call = { readonly layout: [unknown, unknown] } | { readonly widgets: unknown } | { readonly widget: unknown }

function runUpstream(calls: readonly Call[]): Log {
  const log: Log = []
  const counter = { n: 0 }
  const widgetClassFor = (type: string) =>
    function (this: unknown, options: unknown) {
      return makeWidget(log, counter, type, options)
    }
  const context: Record<string, unknown> = {
    GridStack: {
      init: (opts: { column: number; row: number }) => {
        log.push(['initGrid', opts.column, opts.row])
        return new FakeGrid(log, opts.column, opts.row)
      }
    },
    document: { getElementById: () => ({}) },
    video: { currentTime: 0 },
    setWidgetTime: () => log.push(['setWidgetTime']),
    alert: (text: string) => log.push(['alert', text]),
    load_default_grid: () => log.push(['loadDefault']),
    widget_dropped: () => undefined,
    WidgetSandBoxVideoOverlay: widgetClassFor('WidgetSandBoxVideoOverlay'),
    WidgetSubGridVideoOverlay: widgetClassFor('WidgetSubGridVideoOverlay'),
    WidgetCustomHTMLVideoOverlay: widgetClassFor('WidgetCustomHTMLVideoOverlay')
  }
  const vm = createContext(context)
  runInContext(
    `var grid = null; var grid_changed = false;\n${UPSTREAM_FUNCTIONS.map((f) => functionSource(SOURCE, f)).join('\n')}`,
    vm
  )
  for (const call of calls) {
    context.call = call
    try {
      if ('layout' in call) runInContext('load_layout(call.layout[0], call.layout[1])', vm)
      else if ('widgets' in call) runInContext('load_widgets(grid, call.widgets)', vm)
      else runInContext('add_widget(grid, call.widget)', vm)
    } catch (error) {
      log.push(['threw', String(Reflect.get(Object(error), 'message'))])
    }
  }
  return log
}

function runPort(calls: readonly Call[]): Log {
  const log: Log = []
  const counter = { n: 0 }
  const state: { grid: FakeGrid | undefined } = { grid: undefined }
  const target: OverlayLayoutTarget<FakeGrid, FakeItem> = {
    currentGrid: () => state.grid,
    setEdit: (g, enabled) => {
      if (g === undefined) return
      if (enabled) g.enable()
      else g.disable()
      for (const item of g.getGridItems()) item.set_edit(enabled)
    },
    initGrid: (columns, rows) => {
      const old = state.grid
      if (old !== undefined) {
        for (const item of old.getGridItems()) {
          item.destroy()
          old.removeWidget(item)
        }
        old.removeAll()
        old.destroy()
      }
      log.push(['initGrid', columns, rows])
      state.grid = new FakeGrid(log, columns, rows)
      return state.grid
    },
    willItFit: (g, position: GridPosition) => g.willItFit(position),
    alert: (text) => log.push(['alert', text]),
    createWidget: (type, options: JsonLike) => makeWidget(log, counter, type, options),
    place: (g, item, position) => {
      g.addWidget(item, position)
      item.set_edit(true)
    },
    batchUpdate: (g, on) => g.batchUpdate(on),
    items: (g) => g.getGridItems(),
    initItem: (item) => {
      item.init()
      item.loadLog()
    },
    showCurrentTime: () => log.push(['setWidgetTime']),
    loadDefault: () => log.push(['loadDefault']),
    clearChanged: () => undefined
  }
  for (const call of calls) {
    try {
      const grid = state.grid
      if ('layout' in call) loadLayout(target, call.layout[0], call.layout[1])
      else if (grid === undefined) throw new Error('no grid')
      else if ('widgets' in call) loadWidgets(target, grid, call.widgets)
      else addWidget(target, grid, call.widget)
    } catch (error) {
      log.push(['threw', error instanceof Error ? error.message : String(error)])
    }
  }
  return log
}

function expectSame(calls: readonly Call[]): void {
  expect(runPort(structuredClone(calls))).toEqual(runUpstream(structuredClone(calls)))
}

const GRID = { columns: 4, rows: 2 }

describe('layout loading against upstream', () => {
  it('loads the bundled default layout in the same steps', () => {
    const file: unknown = JSON.parse(readFileSync(resolve(UPSTREAM_DIR, 'VideoOverlay/Default_Layout.json'), 'utf8'))
    const layout = file as { grid: unknown; widgets: unknown }
    expectSame([{ layout: [layout.grid, layout.widgets] }])
  })

  it('parses positions with parseInt and auto-places missing or unplaceable ones', () => {
    expectSame([
      {
        layout: [
          GRID,
          {
            0: { type: 'WidgetSandBoxVideoOverlay', x: '1', y: 0, w: '2px', h: null },
            1: { type: 'WidgetCustomHTMLVideoOverlay', x: 'left' },
            2: { type: 'WidgetSandBoxVideoOverlay' },
            3: { type: 'WidgetSubGridVideoOverlay', x: 9, options: { a: 1 } }
          }
        ]
      }
    ])
  })

  it('alerts when a widget will not fit, before looking at its type', () => {
    expectSame([
      {
        layout: [
          { columns: 1, rows: 1 },
          [
            { type: 'WidgetSandBoxVideoOverlay', x: 0 },
            { type: 'Clock', x: 3 },
            { type: 'Clock', x: 0 }
          ]
        ]
      }
    ])
  })

  it('fails where upstream failed: widgets before the failure are created, later ones are not', () => {
    expectSame([
      {
        layout: [
          GRID,
          [
            { type: 'WidgetSandBoxVideoOverlay', x: 0 },
            { type: 'Clock', x: 1 },
            { type: 'WidgetSandBoxVideoOverlay', x: 2 }
          ]
        ]
      }
    ])
    expectSame([
      { layout: [GRID, [{ type: 'WidgetSandBoxVideoOverlay', x: 0 }, null, { type: 'WidgetSandBoxVideoOverlay', x: 2 }]] }
    ])
    expectSame([
      {
        layout: [
          GRID,
          [
            { type: 'WidgetSandBoxVideoOverlay', x: 0, options: 'boom' },
            { type: 'WidgetSandBoxVideoOverlay', x: 2 }
          ]
        ]
      }
    ])
  })

  it('handles malformed grids and widget lists as upstream', () => {
    expectSame([{ layout: [null, {}] }])
    expectSame([{ layout: [undefined, {}] }])
    expectSame([{ layout: [5, {}] }])
    expectSame([{ layout: ['grid', [{ type: 'WidgetSandBoxVideoOverlay' }]] }])
    expectSame([{ layout: [GRID, null] }])
    expectSame([{ layout: [GRID, 'ab'] }])
    expectSame([{ layout: [GRID, 7] }])
    expectSame([{ layout: [{ columns: '3.9', rows: '2rows' }, [5, 'x', [], true]] }])
  })

  it('enables editing after a reload and loads single widgets onto the current grid', () => {
    expectSame([
      { layout: [GRID, [{ type: 'WidgetSandBoxVideoOverlay', x: 0 }]] },
      { widget: { type: 'WidgetCustomHTMLVideoOverlay', x: '1', options: { custom_HTML: '<p>' } } },
      { widget: null },
      { widgets: { b: { type: 'WidgetSubGridVideoOverlay' }, a: { type: 'WidgetSandBoxVideoOverlay' } } },
      { layout: [GRID, []] }
    ])
  })
})
