/** Network side of the Open-Meteo ground-temperature lookup (upstream `fetch_ground_temp`). */
import { nearestHourTemperature, openMeteoUrl } from '../analysis/weather.js'

const TIMEOUT_MS = 5000

/**
 * 2 m air temperature (deg C) at a location and UTC time, or null on any failure (offline, no
 * data, timeout) so the caller keeps its fallback.
 */
export async function fetchGroundTemperature(lat: number, lng: number, when: Date): Promise<number | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(openMeteoUrl(lat, lng, when, Date.now()), { signal: controller.signal })
    if (!response.ok) return null
    const json: unknown = await response.json()
    return nearestHourTemperature(json, when)
  } catch (e) {
    console.warn(`weather lookup failed: ${String(e)}`)
    return null
  } finally {
    clearTimeout(timer)
  }
}
