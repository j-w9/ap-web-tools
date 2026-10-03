import { OVERPASS_URL, featuresFromXml, overpassRemark, overpassRequestBody } from '../analysis/overpass.js'
import type { OsmFeature } from '../analysis/features.js'
import type { Bounds } from '../analysis/geo.js'

/** What a search returned: the features upstream would load, and anything worth telling the user. */
export interface OverpassResponse {
  readonly features: OsmFeature[]
  /** HTTP status or Overpass remark, shown as a note; it does not change the features. */
  readonly notice: string | null
}

/**
 * Search the Overpass API for water bodies inside `bounds` (upstream `request()`): the same POST
 * body, no extra headers, the body read as text and parsed as XML whatever the status. A network
 * failure throws, as upstream's `fetch` does.
 */
export async function fetchWaterFeatures(bounds: Bounds): Promise<OverpassResponse> {
  let response: Response
  try {
    response = await fetch(OVERPASS_URL, { method: 'POST', body: overpassRequestBody(bounds) })
  } catch {
    throw new Error('Could not reach the Overpass API. Check your internet connection and try again.')
  }
  const text = await response.text()
  const xml = new DOMParser().parseFromString(text, 'text/xml')
  const features = featuresFromXml(xml)
  const remark = overpassRemark(xml)
  let notice: string | null = null
  if (!response.ok) notice = `The Overpass API answered with HTTP ${String(response.status)}; try again in a moment or zoom in.`
  else if (remark !== null) notice = `The Overpass API reported: ${remark}`
  return { features, notice }
}
