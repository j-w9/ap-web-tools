// Proofs for the Telemetry Dashboard page rows: the `[object File]` message (#70), the palette
// that never initialises (#71), the settings popup lookup (#161), the fit check before the type
// check (#163) and a failed layout (#164). The original TelemetryDashboard.js (and Menu.js for
// #161) run in node:vm over recording fakes.
import { describe, expect, it } from 'vitest'
import { get, loadDashboard, queriedChildren } from './_harness.js'

type Log = unknown[][]

/** A widget instance as new_widget's classes would return it; calls are logged. */
function fakeWidget(log: Log, type: string, options: unknown): Record<string, unknown> {
  log.push(['new', type])
  return {
    init: () => log.push(['init', type]),
    set_edit: (b: boolean) => log.push(['set_edit', type, b]),
    get_about: () => ({ name: get(options, 'name') ?? type })
  }
}

function widgetClasses(log: Log): Record<string, unknown> {
  const classes: Record<string, unknown> = {}
  for (const type of ['WidgetMenu', 'WidgetSandBox', 'WidgetSubGrid', 'WidgetCustomHTML']) {
    classes[type] = function (options: unknown) {
      return fakeWidget(log, type, options)
    }
  }
  return classes
}

/** A grid whose cells fit when `x < column` (and never with auto-position); calls are logged. */
function fakeGrid(log: Log, column: number, row: number): Record<string, unknown> {
  const items: unknown[] = []
  const opts = { column, maxRow: row, disableDrag: true, disableResize: true }
  return {
    opts,
    willItFit: (pos: { x: number | null; autoPosition: boolean }) => !pos.autoPosition && pos.x !== null && pos.x < column,
    addWidget: (item: unknown) => {
      log.push(['addWidget'])
      items.push(item)
    },
    batchUpdate: (b: boolean) => log.push(['batchUpdate', b]),
    getGridItems: () => [...items],
    on: () => undefined,
    enable: () => undefined,
    disable: () => undefined,
    removeWidget: () => undefined,
    removeAll: () => undefined,
    destroy: () => undefined
  }
}

describe('#70 unrecognised file message shows [object File]', () => {
  it('a JSON file with neither widgets nor widget is reported as "[object File]"', async () => {
    let loaded: Promise<void> = Promise.resolve()
    const page = loadDashboard(['TelemetryDashboard.js'], {
      FileReader: class {
        result = ''
        onload: (() => void) | undefined
        readAsText(file: Blob): void {
          loaded = file.text().then((text) => {
            this.result = text
            this.onload?.()
          })
        }
      }
    })
    const input = { files: [new File(['{"header":{"version":1}}'], 'MyLayout.json')], value: 'C:\\fakepath\\MyLayout.json' }
    await (page.run('load_file') as (e: unknown) => Promise<void>)(input)
    await loaded
    expect(page.alerts).toEqual(['Unable to load from: [object File]'])
  })
})

describe('#71 palette never initialises if one example widget fails to load', () => {
  async function openPalette(failing: string | null): Promise<{ log: Log; rejections: unknown[] }> {
    const log: Log = []
    let onMount: ((instance: unknown) => void) | undefined
    const page = loadDashboard(['TelemetryDashboard.js'], {
      ...widgetClasses(log),
      GridStack: { init: () => fakeGrid(log, 6, 5) },
      tippy: (_el: unknown, props: { onMount?: (instance: unknown) => void } | undefined) => {
        if (props?.onMount !== undefined) onMount = props.onMount
        return { show: () => undefined, hide: () => undefined }
      },
      fetch: (path: string) =>
        path === failing
          ? Promise.reject(new TypeError('Failed to fetch'))
          : Promise.resolve({ json: () => Promise.resolve({ widget: { type: 'WidgetSandBox', options: { name: path } } }) })
    })
    page.run('init_pallet()')
    // The page's own handler would report the rejection (index.html:216-218); record it instead.
    const saved = process.listeners('unhandledRejection')
    process.removeAllListeners('unhandledRejection')
    const rejections: unknown[] = []
    process.on('unhandledRejection', (reason) => rejections.push(reason))
    try {
      onMount?.({ hide: () => undefined })
      for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
    } finally {
      process.removeAllListeners('unhandledRejection')
      for (const listener of saved) process.on('unhandledRejection', listener)
    }
    return { log, rejections }
  }

  it('one failed fetch: batch mode is never ended and no palette widget is initialised', async () => {
    const { log, rejections } = await openPalette('SandBoxWidgets/Stats.json')
    expect(log.filter((e) => e[0] === 'new')).toHaveLength(9) // 3 built-in + 6 loaded examples
    expect(log.filter((e) => e[0] === 'batchUpdate')).toEqual([['batchUpdate', true]])
    expect(log.filter((e) => e[0] === 'init')).toEqual([])
    expect(rejections.map((r) => String(r))).toEqual(['TypeError: Failed to fetch'])
  })

  it('control: all fetches succeed and all ten widgets are initialised', async () => {
    const { log } = await openPalette(null)
    expect(log.filter((e) => e[0] === 'batchUpdate')).toEqual([
      ['batchUpdate', true],
      ['batchUpdate', false]
    ])
    expect(log.filter((e) => e[0] === 'init')).toHaveLength(10)
  })
})

describe('#161 the settings popup is updated only while it is shown', () => {
  it('init_grid writes nothing when the popup is not in the document; a new menu copies the grid size itself', () => {
    const log: Log = []
    let made: Record<string, unknown> | undefined
    const page = loadDashboard(['Widgets/Base_Class.js', 'Widgets/Menu.js', 'TelemetryDashboard.js'], {
      // setup_connect (called by Menu init) only sets these; no message is parsed here.
      MAVLink: { signing: {} },
      // TelemetryDashboard.js:417 creates the main grid; Menu.js:185 a static sub grid.
      GridStack: {
        init: (opts: { column?: number; row?: number }) => {
          const grid = fakeGrid(log, opts.column ?? 12, opts.row ?? 12)
          if (opts.row !== undefined) made = grid
          return { ...grid, column: () => undefined, cellHeight: () => undefined, update: () => undefined }
        }
      }
    })
    page.run('grid = null; init_grid(3, 4)')
    expect(made).toBeDefined()
    // No `num_columns` / `num_rows` input was touched (document.getElementById returned null).
    expect(queriedChildren(page.elements, 'input[id="num_columns"]')).toEqual([])

    // The re-created menu's init reads the new grid (Menu.js:262, 269).
    page.run('var m = new WidgetMenu({}); m.init()')
    const [columns] = queriedChildren(page.elements, 'input[id="num_columns"]')
    const [rows] = queriedChildren(page.elements, 'input[id="num_rows"]')
    expect([get(columns, 'value'), get(rows, 'value')]).toEqual([3, 4])
  })
})

describe('#163 a widget that will not fit is reported before its type is checked', () => {
  it('unknown type that does not fit: alert, no error; unknown type that fits: throws', () => {
    const log: Log = []
    const page = loadDashboard(['TelemetryDashboard.js'], widgetClasses(log))
    const grid = fakeGrid(log, 2, 2)
    const addWidget = page.run('add_widget') as (g: unknown, obj: unknown) => unknown
    expect(addWidget(grid, { type: 'Nope', x: 5, y: 0, w: 1, h: 1 })).toBeUndefined()
    expect(page.alerts).toEqual(["Widget won't fit on Grid"])
    expect(() => addWidget(grid, { type: 'Nope', x: 0, y: 0, w: 1, h: 1 })).toThrow('Unknown widget type: Nope')
  })
})

describe('#164 a failed layout leaves earlier widgets created and the grid in batch mode', () => {
  it('the widget before the failing entry is constructed, never initialised, and batch mode is not ended', () => {
    const log: Log = []
    const fetched: string[] = []
    const page = loadDashboard(['TelemetryDashboard.js'], {
      ...widgetClasses(log),
      GridStack: { init: (opts: { column: number; row: number }) => fakeGrid(log, opts.column, opts.row) },
      fetch: (path: string) => {
        fetched.push(path)
        return new Promise(() => undefined)
      }
    })
    page.run('grid = null')
    const loadLayout = page.run('load_layout') as (grid: unknown, widgets: unknown) => void
    loadLayout(
      { color: 'red', columns: '2', rows: '2' },
      { 0: { type: 'WidgetSandBox', x: 0, y: 0, w: 1, h: 1 }, 1: { type: 'Nope', x: 1, y: 0, w: 1, h: 1 } }
    )
    expect(log).toEqual([
      ['batchUpdate', true],
      ['new', 'WidgetSandBox'],
      ['addWidget'],
      ['set_edit', 'WidgetSandBox', false],
      ['set_edit', 'WidgetSandBox', false]
    ])
    expect(page.alerts).toEqual(['Grid load failed\nUnknown widget type: Nope'])
    expect(fetched).toEqual(['Default_Layout.json'])
  })
})
