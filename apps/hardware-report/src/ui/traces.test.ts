import { describe, expect, it } from 'vitest'
import { offsetLayout, offsetTraces, uartTraces } from './traces.js'

describe('trace builders', () => {
  it('adds a baud limit line spanning the log', () => {
    const time = Float64Array.from([1, 2, 3])
    const traces = uartTraces({ instance: 0, title: 'x', time, rx: time, tx: time, limit: 5760 })
    expect(traces.map((t) => t.name)).toEqual(['Receive', 'Transmit', 'Baud limit'])
    expect(traces[2]).toMatchObject({ x: [1, 3], y: [5760, 5760] })
  })

  it('draws sensor points plus the CG and three axis arrows', () => {
    const traces = offsetTraces({ points: [{ name: 'IMU 1', pos: [0.1, 0, 0] }], maxOffset: 0.1 })
    expect(traces).toHaveLength(2 + 6)
    expect(traces[1]).toMatchObject({ name: 'IMU 1', x: [0.1] })
    expect(offsetLayout(0.1).scene?.yaxis?.range).toEqual([0.1, -0.1])
  })
})
