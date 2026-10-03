import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { classifyDashboardFile, fileText, storedLayout, storedWidgetFile, type StoredWidget } from './layout.js'
import { gridSettings, widgetPlacement } from './loader.js'
import { prop } from './json.js'

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

  it('reads the default layout with its nested sub grid', () => {
    const file = classifyDashboardFile(read(resolve(APP, 'src/assets/Default_Layout.json')))
    if (file.kind !== 'layout') throw new Error(file.kind)
    expect(gridSettings(file.grid)).toEqual({ columns: 12, rows: 12, color: 'rgb(255, 255, 255)' })
    const widgets = Object.values(file.widgets ?? {})
    expect(widgets.map((w) => prop(w, 'type'))).toEqual([
      'WidgetMenu',
      'WidgetSandBox',
      'WidgetSandBox',
      'WidgetSandBox',
      'WidgetSubGrid',
      'WidgetSandBox',
      'WidgetSandBox'
    ])
    // The menu has no stored width: auto-sized like upstream.
    expect(widgetPlacement(widgets[0])).toEqual({ x: 11, y: 0, w: null, h: 3 })
    expect(prop(prop(widgets[4], 'options'), 'form_content')).toEqual({
      rows: 2,
      columns: 2,
      borderColor: '#c8c8c8',
      backgroundColor: '#ffffff'
    })
  })

  it('classifies every bundled sandbox widget and example as a single-widget file', () => {
    for (const [ours] of BUNDLED.slice(1)) {
      const file = classifyDashboardFile(read(resolve(APP, ours)))
      if (file.kind !== 'widget') throw new Error(`${ours}: ${file.kind}`)
      expect(['WidgetSandBox', 'WidgetCustomHTML']).toContain(prop(file.widget, 'type'))
    }
  })
})

describe('reading files', () => {
  it('classifies files like load_file, throwing where its `in` threw', () => {
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
    expect(() => classifyDashboardFile('5')).toThrow(new TypeError("Cannot use 'in' operator to search for 'widgets' in 5"))
    expect(() => classifyDashboardFile('null')).toThrow(new TypeError("Cannot use 'in' operator to search for 'widgets' in null"))
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
    expect(file.widget).toEqual(widget)
    expect(widgetPlacement(file.widget)).toEqual({ x: 0, y: 1, w: null, h: 2 })
  })

  it('drops options members that are undefined (a form not yet loaded), as JSON.stringify did', () => {
    const text = fileText(storedWidgetFile({ ...widget, options: { form: undefined, form_content: {} } }))
    expect(JSON.parse(text)).toEqual({ header: { version: 1 }, widget: { ...widget, options: { form_content: {} } } })
  })
})
