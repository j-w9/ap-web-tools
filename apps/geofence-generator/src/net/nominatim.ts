import { nominatimSearchUrl, parseNominatimResponse, type Place } from '../analysis/places.js'
import { fetchJson } from './http.js'

/** Look up places by name with Nominatim. */
export async function searchPlaces(query: string): Promise<Place[]> {
  const json = await fetchJson(
    'The Nominatim place search',
    nominatimSearchUrl(query),
    { headers: { Accept: 'application/json' } },
    (status) => (status === 429 ? 'Too many searches: wait a minute and try again.' : null)
  )
  return parseNominatimResponse(json)
}
