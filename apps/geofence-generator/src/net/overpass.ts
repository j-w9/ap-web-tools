import { OVERPASS_URL, overpassRequestBody, parseOverpassResponse } from '../analysis/overpass.js'
import type { WaterFeature } from '../analysis/features.js'
import type { Bounds } from '../analysis/geo.js'
import { fetchJson } from './http.js'

function statusHint(status: number): string | null {
  if (status === 429) return 'Too many requests from this address: wait a minute and search again.'
  if (status === 504) return 'The server is busy or the search timed out: try again, or zoom in to a smaller area.'
  if (status === 400) return 'The search area was rejected: zoom in and try again.'
  return null
}

/** Search the Overpass API for water bodies inside `bounds` (upstream `request()`). */
export async function fetchWaterFeatures(bounds: Bounds): Promise<WaterFeature[]> {
  const json = await fetchJson(
    'The Overpass API',
    OVERPASS_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: overpassRequestBody(bounds)
    },
    statusHint
  )
  const result = parseOverpassResponse(json)
  if (!result.ok) throw new Error(result.error)
  return result.features
}
