import { describe, expect, it } from 'vitest'
import { formatDistance, formatFlightTime, formatSize, formatStartTime } from './format.js'

describe('format', () => {
  it('sizes with binary units', () => {
    expect(formatSize(0)).toBe('0.00 B')
    expect(formatSize(1023)).toBe('1023.00 B')
    expect(formatSize(1536)).toBe('1.50 kB')
    expect(formatSize(5 * 1024 ** 3)).toBe('5.00 GB')
    // Upstream indexes past its unit list.
    expect(formatSize(2 * 1024 ** 5)).toBe('2.00 undefined')
  })

  it('distances switch to km at 2 km', () => {
    expect(formatDistance(undefined)).toBe('-')
    expect(formatDistance(1999.999)).toBe('2000.00 m')
    expect(formatDistance(2500)).toBe('2.50 km')
  })

  it('flight time through luxon toHuman (default locale)', () => {
    expect(formatFlightTime(undefined)).toBe('Unknown')
    expect(formatFlightTime(0)).toBe('-')
    expect(formatFlightTime(45)).toBe('45 sec')
    expect(formatFlightTime(3725)).toBe('1 hr, 2 min, 5 sec')
    expect(formatFlightTime(8 * 86400)).toBe('1 wk, 1 day')
  })

  it('start time in local dd/MM/yyyy hh:mm:ss a', () => {
    expect(formatStartTime(undefined)).toBe('No GPS')
    expect(formatStartTime(new Date(2024, 0, 5, 0, 7, 9))).toBe('05/01/2024 12:07:09 AM')
    expect(formatStartTime(new Date(2024, 11, 25, 13, 0, 0))).toBe('25/12/2024 01:00:00 PM')
  })
})
