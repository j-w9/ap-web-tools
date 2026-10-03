// Row: "Page never loads `Param_Helpers.js`" (already a recorded deliberate fix). Verdict:
// docs/bug-proofs/filter-tool.md.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { freshPage, thrown } from './_harness.js'

describe('Save Parameters', () => {
  it('index.html does not load Libraries/Param_Helpers.js', () => {
    const html = readFileSync(resolve(__dirname, '../../upstream/FilterTool/index.html'), 'utf8')
    const scripts = [...html.matchAll(/<script[^>]*src=['"]([^'"]+)['"]/g)].map((m) => m[1])
    expect(scripts).toEqual([
      'filters.js',
      '../Libraries/FileSaver.js',
      '../Libraries/Array_Math.js',
      '../Libraries/ParameterMetadata.js',
      '../Libraries/Plotly_helpers.js',
      '../modules/plotly.js/dist/plotly.min.js'
    ])
  })

  it('with the scripts the page loads, save_parameters throws and saves nothing', () => {
    const page = freshPage({ paramHelpers: false })
    expect(thrown(() => page.call('save_parameters'))).toEqual({
      name: 'ReferenceError',
      message: 'param_to_string is not defined'
    })
    expect(page.saved).toEqual([])
  })

  it('with Param_Helpers.js loaded, the same call saves filter.param', () => {
    const page = freshPage()
    page.call('save_parameters')
    expect(page.saved.map((s) => s.name)).toEqual(['filter.param'])
    expect(page.saved[0]!.text.split('\n')[0]).toBe('INS_GYRO_FILTER,20')
  })
})
