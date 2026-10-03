import { describe, expect, it } from 'vitest'
import { loadPage, thrown, type Page } from './_harness'

function loadParameters(page: Page, text: string): Promise<unknown> {
  page.set('__text', text)
  return page.run('load_parameters({ text: async () => __text })') as Promise<unknown>
}

describe('Analytic Tune: .param files', () => {
  // Row: "Drop-down params lose non-option text".
  it('enables the harmonic notch for INS_HNTCH_ENABLE 0.000000', async () => {
    const page = await loadPage()
    // load_param_inputs turned the enumerated parameter into a drop-down with options "0" and "1".
    expect(page.run('document.getElementById("INS_HNTCH_ENABLE").tagName')).toBe('SELECT')
    expect(page.run('document.getElementById("INS_HNTCH_ENABLE").children.map((o) => o.attributes.get("value"))')).toEqual([
      '0',
      '1'
    ])

    await loadParameters(page, 'INS_HNTCH_ENABLE 0.000000\n')
    expect(page.value('INS_HNTCH_ENABLE')).toBe('')
    expect(page.run('get_form("INS_HNTCH_ENABLE")')).toBeNaN()
    expect(page.run('get_filters(2000)[0].enabled')).toBe(true)

    const plain = await loadPage()
    await loadParameters(plain, 'INS_HNTCH_ENABLE 0\n')
    expect(plain.value('INS_HNTCH_ENABLE')).toBe('0')
    expect(plain.run('get_filters(2000)[0].enabled')).toBe(false)
  })

  // Row: ".param lines not trimmed".
  it('ignores an indented line', async () => {
    const page = await loadPage()
    await loadParameters(page, '  ATC_RAT_RLL_P,0.5\nATC_RAT_RLL_I,0.4\n')
    expect(page.value('ATC_RAT_RLL_P')).toBe('0.288')
    expect(page.value('ATC_RAT_RLL_I')).toBe('0.4')
  })

  // Row: "File input named in a .param stops the load".
  it('rejects at a line naming the log file input; later lines not applied', async () => {
    const page = await loadPage()
    const error = await thrown(() => loadParameters(page, 'ATC_RAT_RLL_I,0.4\nfileItem,1\nATC_RAT_RLL_P,0.5\n'))
    expect(error).toBe('Error: InvalidStateError: a file input may only be set to the empty string')
    expect(page.value('ATC_RAT_RLL_I')).toBe('0.4')
    expect(page.value('ATC_RAT_RLL_P')).toBe('0.288')
  })
})
