import { describe, expect, it } from 'vitest'
import { cropCornersPx, parseStoredView } from './view.js'
import { loadUpstream } from '../test-utils/upstream.js'

describe('parseStoredView', () => {
  it('accepts a valid view and rejects anything else', () => {
    expect(parseStoredView('{"lat":47.3,"lng":8.5,"zoom":12}')).toEqual({ lat: 47.3, lng: 8.5, zoom: 12 })
    expect(parseStoredView(null)).toBeNull()
    expect(parseStoredView('nope')).toBeNull()
    expect(parseStoredView('{"lat":"1","lng":2,"zoom":3}')).toBeNull()
    expect(parseStoredView('{"lat":100,"lng":2,"zoom":3}')).toBeNull()
  })
})

/** Leaflet's EPSG:3857 projection at a zoom, written out (Leaflet itself needs a DOM to load). */
function webMercator(zoom: number) {
  const R = 6378137
  const scale = (256 * 2 ** zoom) / (2 * Math.PI * R)
  return (ll: { lat: number; lng: number }) => {
    const sin = Math.sin((ll.lat * Math.PI) / 180)
    const x = R * ((ll.lng * Math.PI) / 180)
    const y = (R * Math.log((1 + sin) / (1 - sin))) / 2
    return { x: scale * x + 0.5 * 256 * 2 ** zoom, y: -scale * y + 0.5 * 256 * 2 ** zoom }
  }
}

describe('cropCornersPx matches upstream add_crop', () => {
  it.each([
    [{ south: 47.25, west: 8.45, north: 47.35, east: 8.6 }, 12],
    [{ south: -33.9, west: 151.1, north: -33.8, east: 151.3 }, 13],
    [{ south: 69.5, west: 18.0, north: 69.7, east: 18.4 }, 11]
  ])('view %o at zoom %i', (bounds, zoom) => {
    const project = webMercator(zoom)
    const upstream = loadUpstream()
    const theirs = upstream.addCrop(bounds, project, [])
    const ne = project({ lat: bounds.north, lng: bounds.east })
    const sw = project({ lat: bounds.south, lng: bounds.west })
    expect(cropCornersPx(ne, sw)).toEqual(theirs)
  })

  it('insets the top to 70% and the other edges to 95% of the half-size', () => {
    const [rt, rb, lb, lt] = cropCornersPx({ x: 200, y: 0 }, { x: 0, y: 100 })
    expect(rt).toEqual([195, 15])
    expect(rb).toEqual([195, 97.5])
    expect(lb).toEqual([5, 97.5])
    expect(lt).toEqual([5, 15])
  })
})
