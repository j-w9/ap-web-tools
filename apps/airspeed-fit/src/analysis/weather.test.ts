import { describe, expect, it } from 'vitest'
import { nearestHourTemperature, openMeteoUrl } from './weather.js'

describe('openMeteoUrl', () => {
  const when = new Date('2024-07-08T14:20:00Z')
  it('uses the forecast API for recent flights', () => {
    const url = openMeteoUrl(-35.36326, 149.16524, when, when.getTime() + 2.5 * 86400000)
    expect(url).toBe(
      'https://api.open-meteo.com/v1/forecast?latitude=-35.3633&longitude=149.1652&hourly=temperature_2m&temperature_unit=celsius&timezone=GMT&past_days=4&forecast_days=1'
    )
  })
  it('uses the archive for old flights', () => {
    const url = openMeteoUrl(10, 20, when, when.getTime() + 200 * 86400000)
    expect(url).toBe(
      'https://archive-api.open-meteo.com/v1/archive?latitude=10.0000&longitude=20.0000&hourly=temperature_2m&temperature_unit=celsius&timezone=GMT&start_date=2024-07-08&end_date=2024-07-08'
    )
  })
})

describe('nearestHourTemperature', () => {
  const when = new Date('2024-07-08T14:20:00Z')
  it('picks the nearest hour with data', () => {
    const json = {
      hourly: { time: ['2024-07-08T13:00', '2024-07-08T14:00', '2024-07-08T15:00'], temperature_2m: [10, null, 12] }
    }
    expect(nearestHourTemperature(json, when)).toBe(12)
  })
  it('returns null for malformed answers', () => {
    expect(nearestHourTemperature(null, when)).toBeNull()
    expect(nearestHourTemperature({ hourly: { time: [], temperature_2m: [] } }, when)).toBeNull()
    expect(nearestHourTemperature({ hourly: { time: ['x'], temperature_2m: ['warm'] } }, when)).toBeNull()
  })
})
