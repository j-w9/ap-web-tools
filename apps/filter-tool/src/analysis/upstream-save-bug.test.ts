// Pins the upstream bug this port deliberately fixes (see docs/porting-policy.md, "Deliberate fixes"):
// FilterTool/index.html never loads Libraries/Param_Helpers.js, so save_parameters cannot save.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { runInContext, createContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const toolDir = resolve(__dirname, '../../../../upstream/FilterTool')

describe('upstream FilterTool save_parameters', () => {
  it('throws because the page never loads param_to_string', () => {
    const html = readFileSync(resolve(toolDir, 'index.html'), 'utf8')
    const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1] ?? '').filter((s) => !s.startsWith('http'))
    expect(scripts).not.toContain('../Libraries/Param_Helpers.js')

    const input = { id: 'INS_GYRO_FILTER', value: '20' }
    const saved: string[] = []
    const context = createContext({
      Blob: function Blob() {},
      saveAs: (_blob: unknown, name: string) => saved.push(name),
      document: { forms: { params: { getElementsByTagName: (tag: string) => (tag === 'input' ? [input] : []) } } },
      window: {}
    })
    for (const script of scripts) {
      try {
        runInContext(readFileSync(resolve(dirname(resolve(toolDir, 'index.html')), script), 'utf8'), context)
      } catch {
        // Page set-up code that needs a full DOM is irrelevant here.
      }
    }
    expect(() => runInContext('save_parameters()', context)).toThrow(/param_to_string is not defined/)
    expect(saved).toEqual([])
  })
})
