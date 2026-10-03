import { describe, expect, it } from 'vitest'
import type { FftKey } from '../analysis/keys.js'
import { toggleGroup } from './SpectrumControls.js'

describe('signal group toggle (upstream legend double-click)', () => {
  const components: FftKey[] = ['P', 'I', 'D', 'FF', 'DFF']
  const enabled = new Set<FftKey>(['Tar', 'Act', 'P', 'I', 'D', 'FF'])

  it('ticks the whole group when fewer than half of its enabled chips are ticked', () => {
    const next = toggleGroup(components, enabled, new Set<FftKey>(['Tar', 'P']))
    expect([...next].sort()).toEqual(['D', 'DFF', 'FF', 'I', 'P', 'Tar'])
  })

  it('unticks the whole group otherwise, leaving other groups alone', () => {
    const next = toggleGroup(components, enabled, new Set<FftKey>(['Tar', 'P', 'I']))
    expect([...next]).toEqual(['Tar'])
  })
})
