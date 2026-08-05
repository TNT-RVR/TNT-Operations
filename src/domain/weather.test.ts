import { describe, expect, it } from 'vitest'
import { seasonWindow, summariseWeather, weatherKey, type OpenMeteoDaily } from './weather'

/** Build a daily block from parallel arrays, padding `time` to match. */
function daily(part: Omit<OpenMeteoDaily, 'time'> & { days?: number }): OpenMeteoDaily {
  const n =
    part.days ??
    Math.max(
      part.temperature_2m_max?.length ?? 0,
      part.temperature_2m_min?.length ?? 0,
      part.precipitation_sum?.length ?? 0,
      part.wind_speed_10m_max?.length ?? 0,
      part.temperature_2m_mean?.length ?? 0,
    )
  return {
    time: Array.from({ length: n }, (_, i) => `2025-04-${String(i + 1).padStart(2, '0')}`),
    ...part,
  }
}

describe('summariseWeather', () => {
  it('uses the daily mean when the source provides it', () => {
    const w = summariseWeather(
      daily({ temperature_2m_mean: [10, 20, 30] }),
      'k',
      '2025',
    )
    expect(w.avgTemp).toBe(20)
  })

  it('falls back to the midpoint of max and min, not the mean of the maxima', () => {
    // The Base44 original averaged temperature_2m_max and labelled it "Avg
    // Temperature" — which for this input would read 30, not 20.
    const w = summariseWeather(
      daily({ temperature_2m_max: [20, 30, 40], temperature_2m_min: [0, 10, 20] }),
      'k',
      '2025',
    )
    expect(w.avgTemp).toBe(20)
    expect(w.maxTemp).toBe(30)
    expect(w.minTemp).toBe(10)
  })

  it('accumulates growing degree days above the 10 °C base', () => {
    // Midpoints 15, 5, 25 → contributions 5, 0 (never negative), 15.
    const w = summariseWeather(
      daily({ temperature_2m_max: [20, 10, 30], temperature_2m_min: [10, 0, 20] }),
      'k',
      '2025',
    )
    expect(w.growingDegreeDays).toBe(20)
  })

  it('counts a rain day at 1 mm or more', () => {
    const w = summariseWeather(
      daily({ precipitation_sum: [0, 0.9, 1, 5, 0.99] }),
      'k',
      '2025',
    )
    expect(w.rainDays).toBe(2)
    expect(w.totalPrecip).toBeCloseTo(7.89, 6)
  })

  it('counts a flight day only when warm, dry and calm together', () => {
    const w = summariseWeather(
      daily({
        //     ok   cold  wet   windy  ok
        temperature_2m_max: [25, 15, 25, 25, 30],
        temperature_2m_min: [10, 5, 10, 10, 15],
        precipitation_sum: [0, 0, 5, 0, 0.5],
        wind_speed_10m_max: [10, 10, 10, 40, 20],
      }),
      'k',
      '2025',
    )
    expect(w.flightHours).toBe(2)
  })

  it('does not count a day with a missing wind reading as calm', () => {
    const w = summariseWeather(
      daily({
        temperature_2m_max: [25, 25],
        temperature_2m_min: [10, 10],
        precipitation_sum: [0, 0],
        wind_speed_10m_max: [10, null],
      }),
      'k',
      '2025',
    )
    expect(w.flightHours).toBe(1)
  })

  it('skips null days rather than treating them as zero', () => {
    // A gap must not drag the average toward 0 °C or add 0 mm of rain.
    const w = summariseWeather(
      daily({ temperature_2m_mean: [20, null, 20], precipitation_sum: [5, null, 5] }),
      'k',
      '2025',
    )
    expect(w.avgTemp).toBe(20)
    expect(w.totalPrecip).toBe(10)
  })

  it('returns nulls for an empty response rather than zeros', () => {
    const w = summariseWeather({ time: [] }, 'k', '2025')
    expect(w.avgTemp).toBeNull()
    expect(w.totalPrecip).toBeNull()
    expect(w.rainDays).toBeNull()
    expect(w.flightHours).toBeNull()
    expect(w.growingDegreeDays).toBeNull()
  })

  it('carries its cache key and year through', () => {
    const w = summariseWeather(daily({ temperature_2m_mean: [12] }), '49.863,-111.963,2025', '2025')
    expect(w.key).toBe('49.863,-111.963,2025')
    expect(w.year).toBe('2025')
  })
})

describe('weatherKey', () => {
  it('rounds to the cache grid so nearby fields share an entry', () => {
    // ~110 m apart in the last decimal — the same Open-Meteo grid cell.
    expect(weatherKey(49.86350894672768, -111.9630002975464, '2025')).toBe('49.864,-111.963,2025')
    expect(weatherKey(49.8635, -111.96301, '2025')).toBe('49.864,-111.963,2025')
  })

  it('separates different years', () => {
    expect(weatherKey(49.8635, -111.963, '2024')).not.toBe(weatherKey(49.8635, -111.963, '2025'))
  })
})

describe('seasonWindow', () => {
  it('is April through September', () => {
    expect(seasonWindow('2025')).toEqual({ start: '2025-04-01', end: '2025-09-30' })
  })
})
