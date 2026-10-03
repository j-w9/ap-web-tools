import { describe, expect, it } from 'vitest'
import { cropRectangle, parseStoredView } from './view.js'

describe('parseStoredView', () => {
  it('accepts a valid view and rejects anything else', () => {
    expect(parseStoredView('{"lat":47.3,"lng":8.5,"zoom":12}')).toEqual({ lat: 47.3, lng: 8.5, zoom: 12 })
    expect(parseStoredView(null)).toBeNull()
    expect(parseStoredView('nope')).toBeNull()
    expect(parseStoredView('{"lat":"1","lng":2,"zoom":3}')).toBeNull()
    expect(parseStoredView('{"lat":100,"lng":2,"zoom":3}')).toBeNull()
  })
})

describe('cropRectangle', () => {
  it('insets the view in Web Mercator, corners NE, SE, SW, NW', () => {
    const ring = cropRectangle({ south: 40, west: 10, north: 60, east: 20 }, 0.9)
    expect(ring).toHaveLength(4)
    const [ne, se, sw, nw] = ring
    expect(ne?.[0]).toBeCloseTo(19.5)
    expect(sw?.[0]).toBeCloseTo(10.5)
    expect(ne?.[1]).toBe(nw?.[1])
    expect(se?.[1]).toBe(sw?.[1])
    expect(ne?.[1]).toBeLessThan(60)
    expect(se?.[1]).toBeGreaterThan(40)
    // Mercator stretches the north, so the same on-screen inset is fewer degrees there.
    expect(60 - (ne?.[1] ?? 0)).toBeLessThan((se?.[1] ?? 0) - 40)
  })

  it('is the full view at inset 1', () => {
    const ring = cropRectangle({ south: -10, west: -5, north: 10, east: 5 }, 1)
    expect(ring[0]?.[1]).toBeCloseTo(10, 9)
    expect(ring[2]?.[1]).toBeCloseTo(-10, 9)
  })
})
