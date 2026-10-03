import { describe, expect, it } from 'vitest'
import { nominatimSearchUrl, parseNominatimResponse } from './places.js'

describe('Nominatim', () => {
  it('builds the search URL', () => {
    expect(nominatimSearchUrl('Lake Zurich')).toBe(
      'https://nominatim.openstreetmap.org/search?q=Lake+Zurich&limit=5&format=json&addressdetails=1'
    )
  })

  it('parses results and skips malformed ones', () => {
    const places = parseNominatimResponse([
      { display_name: 'Zürichsee, Schweiz', boundingbox: ['47.16', '47.37', '8.53', '8.98'], lat: '47.2', lon: '8.7' },
      { display_name: 'Broken', boundingbox: ['x'] },
      { boundingbox: ['1', '2', '3', '4'] }
    ])
    expect(places).toEqual([{ name: 'Zürichsee, Schweiz', bounds: { south: 47.16, north: 47.37, west: 8.53, east: 8.98 } }])
    expect(parseNominatimResponse({ error: 'x' })).toEqual([])
  })
})
