/**
 * Open-Meteo ground-temperature lookup, pure parts (upstream `fetch_ground_temp`): which endpoint
 * to ask and how to pick the hour nearest takeoff from its answer.
 */

const DAY_MS = 86400000

/**
 * Request URL for the 2 m temperature at a location around `when`. Flights within 90 days use the
 * forecast API's `past_days` (current right up to now); older flights use the reanalysis archive.
 */
export function openMeteoUrl(lat: number, lng: number, when: Date, nowMs: number): string {
  const base = `latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&hourly=temperature_2m&temperature_unit=celsius&timezone=GMT`
  const daysAgo = (nowMs - when.getTime()) / DAY_MS
  if (daysAgo <= 90) {
    const past = Math.min(92, Math.max(1, Math.ceil(daysAgo) + 1))
    return `https://api.open-meteo.com/v1/forecast?${base}&past_days=${past}&forecast_days=1`
  }
  const day = when.toISOString().slice(0, 10)
  return `https://archive-api.open-meteo.com/v1/archive?${base}&start_date=${day}&end_date=${day}`
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/**
 * Temperature of the logged hour nearest `when` in an Open-Meteo response (hours are GMT, e.g.
 * "2024-07-08T14:00"), or null when the response has none.
 */
export function nearestHourTemperature(response: unknown, when: Date): number | null {
  const hourly = isRecord(response) ? response['hourly'] : undefined
  if (!isRecord(hourly)) return null
  const times = hourly['time']
  const temps = hourly['temperature_2m']
  if (!Array.isArray(times) || !Array.isArray(temps) || temps.length === 0) return null
  const target = when.getTime()
  let best: unknown = null
  let bestDiff = Infinity
  for (let i = 0; i < times.length; i++) {
    const temp: unknown = temps[i]
    const time: unknown = times[i]
    if (temp == null || typeof time !== 'string') continue
    const d = Math.abs(Date.parse(time + ':00Z') - target)
    if (d < bestDiff) {
      bestDiff = d
      best = temp
    }
  }
  return typeof best === 'number' && isFinite(best) ? best : null
}
