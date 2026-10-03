import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  LayoutError,
  classifyDashboardFile,
  fileText,
  parseLayout,
  parseWidget,
  storedLayout,
  storedWidgetFile,
  type StoredWidget
} from './layout.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const APP = resolve(HERE, '../..')
const UPSTREAM = resolve(APP, '../../upstream/TelemetryDashboard')

function read(path: string): string {
  return readFileSync(path, 'utf8')
}

const BUNDLED: readonly (readonly [ours: string, theirs: string])[] = [
  ['src/assets/Default_Layout.json', 'Default_Layout.json'],
  ...readdirSync(resolve(UPSTREAM, 'SandBoxWidgets')).map(
    (f) => [`src/assets/SandBoxWidgets/${f}`, `SandBoxWidgets/${f}`] as const
  ),
  ...readdirSync(resolve(UPSTREAM, 'Examples')).map((f) => [`examples/${f}`, `Examples/${f}`] as const)
]

describe('bundled layouts and widgets', () => {
  it('are the upstream files, content unchanged (only reformatted)', () => {
    for (const [ours, theirs] of BUNDLED) {
      expect(JSON.parse(read(resolve(APP, ours))), ours).toEqual(JSON.parse(read(resolve(UPSTREAM, theirs))))
    }
  })

  it('parses the default layout with its nested sub grid', () => {
    const file = classifyDashboardFile(read(resolve(APP, 'src/assets/Default_Layout.json')))
    if (file.kind !== 'layout') throw new Error(file.kind)
    const layout = parseLayout(file.grid, file.widgets)
    expect(layout.grid).toEqual({ columns: 12, rows: 12, color: 'rgb(255, 255, 255)' })
    expect(layout.widgets.map((w) => w.type)).toEqual([
      'WidgetMenu',
      'WidgetSandBox',
      'WidgetSandBox',
      'WidgetSandBox',
      'WidgetSubGrid',
      'WidgetSandBox',
      'WidgetSandBox'
    ])
    // The menu has no stored width: auto-sized like upstream.
    expect(layout.widgets[0]).toMatchObject({ x: 11, y: 0, w: null, h: 3 })
    const sub = layout.widgets[4]!
    expect(sub.options.form_content).toEqual({ rows: 2, columns: 2, borderColor: '#c8c8c8', backgroundColor: '#ffffff' })
  })

  it('parses every bundled sandbox widget and example as a single-widget file', () => {
    for (const [ours] of BUNDLED.slice(1)) {
      const file = classifyDashboardFile(read(resolve(APP, ours)))
      if (file.kind !== 'widget') throw new Error(`${ours}: ${file.kind}`)
      const widget = parseWidget(file.widget)
      expect(['WidgetSandBox', 'WidgetCustomHTML']).toContain(widget.type)
    }
  })
})

describe('layout validation', () => {
  it('parses positions like parseInt and keeps missing ones null', () => {
    expect(parseWidget({ type: 'WidgetSandBox', x: '3', y: 4, w: '2px', h: null })).toEqual({
      type: 'WidgetSandBox',
      x: 3,
      y: 4,
      w: 2,
      h: null,
      options: {}
    })
    expect(parseWidget({ type: 'WidgetSandBox', x: 'left' }).x).toBeNaN()
  })

  it('accepts widgets as an array as well as an object', () => {
    const grid = { columns: '6', rows: 4, color: '#000' }
    expect(parseLayout(grid, [{ type: 'WidgetSubGrid' }]).widgets).toHaveLength(1)
    expect(parseLayout(grid, { 0: { type: 'WidgetSubGrid' } }).grid).toEqual({ columns: 6, rows: 4, color: '#000' })
    expect(parseLayout(grid, 5).widgets).toEqual([])
  })

  it('treats a non-string colour as "keep the current background"', () => {
    expect(parseLayout({ columns: 2, rows: 2, color: 7 }, {}).grid.color).toBeNull()
  })

  it('rejects what made the original fail, with the original message for unknown widgets', () => {
    expect(() => parseWidget({ type: 'WidgetClock' })).toThrow(new LayoutError('Unknown widget type: WidgetClock'))
    expect(() => parseWidget({})).toThrow('Unknown widget type: undefined')
    expect(() => parseWidget(null)).toThrow(LayoutError)
    expect(() => parseLayout(undefined, {})).toThrow('Layout has no grid settings')
    expect(() => parseLayout({ columns: 2, rows: 2 }, null)).toThrow('Layout has no widgets')
    expect(() => parseLayout({ columns: 2, rows: 2 }, 'ab')).toThrow('Unknown widget type: undefined')
    expect(() => parseWidget({ type: 'WidgetSandBox', options: 'x' })).toThrow('WidgetSandBox options must be an object')
    expect(() => parseWidget({ type: 'WidgetSubGrid', options: { form_content: 3 } })).toThrow(
      'options.form_content must be an object'
    )
  })

  it('classifies files like load_file', () => {
    expect(classifyDashboardFile('{"widgets": {}, "grid": {"columns": 2}}')).toEqual({
      kind: 'layout',
      widgets: {},
      grid: { columns: 2 }
    })
    expect(classifyDashboardFile('{"widget": {"type": "WidgetSandBox"}}')).toEqual({
      kind: 'widget',
      widget: { type: 'WidgetSandBox' }
    })
    expect(classifyDashboardFile('{"other": 1}')).toEqual({ kind: 'unrecognised' })
    expect(classifyDashboardFile('[]')).toEqual({ kind: 'unrecognised' })
    expect(() => classifyDashboardFile('{')).toThrow(SyntaxError)
    expect(() => classifyDashboardFile('5')).toThrow(LayoutError)
  })
})

describe('saving', () => {
  const widget: StoredWidget = { x: '0', y: '1', w: null, h: '2', type: 'WidgetSandBox', options: { sandbox: '' } }

  it('writes layouts with a version header and index-keyed widgets, indented by two spaces', () => {
    const text = fileText(storedLayout({ columns: 12, rows: 12, color: 'rgb(255, 255, 255)' }, [widget, widget]))
    expect(JSON.parse(text)).toEqual({
      header: { version: 1 },
      grid: { columns: 12, rows: 12, color: 'rgb(255, 255, 255)' },
      widgets: { 0: widget, 1: widget }
    })
    expect(text.startsWith('{\n  "header": {\n    "version": 1\n  },')).toBe(true)
  })

  it('writes single widgets and reads them back', () => {
    const file = classifyDashboardFile(fileText(storedWidgetFile(widget)))
    if (file.kind !== 'widget') throw new Error(file.kind)
    expect(parseWidget(file.widget)).toEqual({ type: 'WidgetSandBox', x: 0, y: 1, w: null, h: 2, options: { sandbox: '' } })
  })
})
