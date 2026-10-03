import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import defaultLayout from '../defaults/default-layout.json'
import defaultPalette from '../defaults/default-palette.json'
import {
  gridLoadFailedMessage,
  gridSize,
  isWidgetType,
  makeLayoutFile,
  makeWidgetFile,
  readOverlayFile,
  savedPosition,
  savedTypeAndOptions,
  savedWidgetList,
  serialiseFile,
  UNABLE_TO_LOAD_MESSAGE,
  unknownWidgetTypeMessage,
  WRONG_TOOL_MESSAGE,
  type SavedWidget
} from './layout-file.js'
import { jsString } from './json.js'
import { upstreamDir } from '../test-utils/upstream.js'

describe('bundled defaults', () => {
  it('are byte-for-byte upstream Default_Layout.json and Default_Palette.json', () => {
    const read = (name: string) => JSON.parse(readFileSync(join(upstreamDir, 'VideoOverlay', name), 'utf8')) as unknown
    expect(defaultLayout).toEqual(read('Default_Layout.json'))
    expect(defaultPalette).toEqual(read('Default_Palette.json'))
  })

  it('name only VideoOverlay widget classes', () => {
    const types: unknown[] = []
    const walk = (widgets: unknown) => {
      for (const w of savedWidgetList(widgets)) {
        const { type, options } = savedTypeAndOptions(w)
        types.push(type)
        if (options && 'widgets' in options) walk(options['widgets'])
      }
    }
    walk(defaultLayout.widgets)
    walk(defaultPalette.widgets)
    expect(types.every(isWidgetType)).toBe(true)
    expect(types.length).toBe(14)
  })
})

describe('reading overlay files (upstream overlay-input handler)', () => {
  const header = { tool: 'videoOverlay', version: 1 }

  it('loads a layout when it has widgets', () => {
    const content = readOverlayFile(JSON.stringify({ header, grid: { rows: 3, columns: 4 }, widgets: {} }))
    expect(content).toEqual({ kind: 'layout', grid: { rows: 3, columns: 4 }, widgets: {} })
  })

  it('loads a single widget', () => {
    const widget = { x: '1', y: '2', w: '1', h: '1', type: 'WidgetSandBoxVideoOverlay', options: {} }
    expect(readOverlayFile(JSON.stringify({ header, widget }))).toEqual({ kind: 'widget', widget })
  })

  it('prefers widgets over widget, as upstream checks widgets first', () => {
    expect(readOverlayFile(JSON.stringify({ header, widgets: { 0: {} }, widget: {} })).kind).toBe('layout')
  })

  it('rejects other tools with upstream text', () => {
    expect(readOverlayFile(JSON.stringify({ header: { tool: 'telemetryDashboard' }, widgets: {} }))).toEqual({
      kind: 'rejected',
      message: WRONG_TOOL_MESSAGE
    })
    expect(readOverlayFile('[]')).toEqual({ kind: 'rejected', message: WRONG_TOOL_MESSAGE })
    expect(readOverlayFile('null')).toEqual({ kind: 'rejected', message: WRONG_TOOL_MESSAGE })
  })

  it('reproduces upstream "[object File]" message for files with neither', () => {
    expect(readOverlayFile(JSON.stringify({ header }))).toEqual({ kind: 'rejected', message: UNABLE_TO_LOAD_MESSAGE })
    expect(UNABLE_TO_LOAD_MESSAGE).toBe('Unable to load from: ' + String({ toString: () => '[object File]' }))
  })

  it('throws on invalid JSON, as JSON.parse does upstream', () => {
    expect(() => readOverlayFile('{')).toThrow(SyntaxError)
  })
})

describe('widget positions (upstream add_widget)', () => {
  it('parses gs-* strings with parseInt and leaves missing values to gridstack', () => {
    expect(savedPosition({ x: '3', y: '0', w: '4.9', h: '2px' })).toEqual({ x: 3, y: 0, w: 4, h: 2, autoPosition: false })
    expect(savedPosition({ x: 1, y: 1, w: null, h: null })).toEqual({ x: 1, y: 1, autoPosition: false })
    expect(savedPosition({ x: 'a' })).toEqual({ x: Number.NaN, autoPosition: false })
  })

  it('throws like upstream for a missing widget and reports unknown classes', () => {
    expect(() => savedTypeAndOptions(undefined)).toThrow("Cannot read properties of undefined (reading 'x')")
    expect(unknownWidgetTypeMessage('WidgetMenu')).toBe('Unknown widget type: WidgetMenu')
  })

  it('lists widgets in key order', () => {
    expect(savedWidgetList({ 1: 'b', 0: 'a', 10: 'c' })).toEqual(['a', 'b', 'c'])
    expect(savedWidgetList(undefined)).toEqual([])
  })
})

describe('grid settings (upstream load_layout)', () => {
  it('parseInts rows and columns', () => {
    expect(gridSize({ columns: '12', rows: 6 })).toEqual({ columns: 12, rows: 6 })
    expect(gridSize({ columns: [5], rows: '' })).toEqual({ columns: 5, rows: Number.NaN })
  })

  it('throws for a missing grid and builds upstream failure text', () => {
    expect(() => gridSize(undefined)).toThrow(TypeError)
    expect(gridLoadFailedMessage(new Error('boom'))).toBe('Grid load failed\nboom')
  })
})

describe('writing files (upstream get_layout / save_widget)', () => {
  const widget: SavedWidget = {
    x: '0',
    y: '9',
    w: '3',
    h: '3',
    type: 'WidgetSubGridVideoOverlay',
    options: { form_content: { rows: 2 }, widgets: undefined }
  }

  it('writes the same structure and indentation as upstream', () => {
    const layout = makeLayoutFile({ columns: 12, rows: 12, color: '' }, [widget])
    const text = serialiseFile(layout)
    expect(text).toBe(
      JSON.stringify(
        {
          header: { tool: 'videoOverlay', version: 1.0 },
          grid: { columns: 12, rows: 12, color: '' },
          widgets: {
            0: { x: '0', y: '9', w: '3', h: '3', type: 'WidgetSubGridVideoOverlay', options: { form_content: { rows: 2 } } }
          }
        },
        null,
        2
      )
    )
    expect(readOverlayFile(text).kind).toBe('layout')
    expect(serialiseFile(makeWidgetFile(widget))).toContain('"widget": {')
  })

  it('round-trips the default layout', () => {
    const widgets = savedWidgetList(defaultLayout.widgets) as SavedWidget[]
    const text = serialiseFile(makeLayoutFile(defaultLayout.grid, widgets))
    expect(JSON.parse(text)).toEqual(defaultLayout)
  })
})

describe('jsString', () => {
  it('matches String() for JSON values', () => {
    const cases: [Parameters<typeof jsString>[0], string][] = [
      [1, '1'],
      ['a', 'a'],
      [true, 'true'],
      [null, 'null'],
      [[1, [2, 3]], '1,2,3'],
      [[null, 'x'], ',x'],
      [{}, '[object Object]']
    ]
    for (const [v, text] of cases) expect(jsString(v)).toBe(text)
  })
})
