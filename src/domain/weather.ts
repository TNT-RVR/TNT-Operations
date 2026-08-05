/**
 * Season weather metrics, derived from a cached Open-Meteo archive response.
 *
 * The Base44 original fetched this inside the render path — once per field, per
 * panel, on every mount — and then averaged `temperature_2m_max` and called the
 * result "Avg Temperature". Six panels each did their own slightly different
 * version of that reduction, so the same field could report two different
 * average temperatures depending on which tab you were looking at.
 *
 * Here the fetch is cached server-side (table `weather_cache`, migration 0014)
 * and the reduction happens once, in one pure function.
 *
 * The season window is April 1 – September 30, matching the original: seeding
 * through bee return for southern Alberta.
 */

import type { FieldWeather } from '@/data/types'

/** The `daily` block of an Open-Meteo archive response, as stored in the cache. */
export interface OpenMeteoDaily {
  time: string[]
  temperature_2m_max?: (number | null)[]
  temperature_2m_min?: (number | null)[]
  temperature_2m_mean?: (number | null)[]
  precipitation_sum?: (number | null)[]
  wind_speed_10m_max?: (number | null)[]
}

/** Base temperature for growing-degree-day accumulation, °C. */
export const GDD_BASE_C = 10

/** A day counts as rain at or above this much precipitation, mm. */
export const RAIN_DAY_MM = 1

/**
 * Conditions under which leafcutter bees actually forage. Below about 20 °C
 * they stay in the shelter, and they don't fly in rain or strong wind — so a
 * season's raw average temperature says much less than its count of workable
 * days. This is the one weather metric that maps to something operational.
 */
export const FLIGHT_MIN_TEMP_C = 20
export const FLIGHT_MAX_PRECIP_MM = 1
export const FLIGHT_MAX_WIND_KMH = 25

/** Mean of the entries that are actually present. Null if none are. */
function meanOf(values: (number | null | undefined)[] | undefined): number | null {
  if (!values) return null
  let sum = 0
  let n = 0
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      sum += v
      n++
    }
  }
  return n === 0 ? null : sum / n
}

/** Sum of the entries that are present. Null if none are. */
function sumOf(values: (number | null | undefined)[] | undefined): number | null {
  if (!values) return null
  let sum = 0
  let n = 0
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      sum += v
      n++
    }
  }
  return n === 0 ? null : sum
}

/**
 * Reduce a season of daily readings to the metrics the analysis screens plot.
 *
 * A missing day is skipped rather than treated as zero — Open-Meteo does return
 * nulls, and counting a gap as 0 mm of rain or 0 °C would drag every average.
 */
export function summariseWeather(daily: OpenMeteoDaily, key: string, year: string): FieldWeather {
  const maxT = daily.temperature_2m_max ?? []
  const minT = daily.temperature_2m_min ?? []
  const precip = daily.precipitation_sum ?? []
  const wind = daily.wind_speed_10m_max ?? []

  // Prefer the daily mean where the source provides it; otherwise the midpoint
  // of max and min, which is the standard definition — NOT the average of the
  // daily maxima, which is what the original reported as "Avg Temperature".
  let avgTemp = meanOf(daily.temperature_2m_mean)
  if (avgTemp === null) {
    const mids: number[] = []
    for (let i = 0; i < daily.time.length; i++) {
      const hi = maxT[i]
      const lo = minT[i]
      if (typeof hi === 'number' && typeof lo === 'number') mids.push((hi + lo) / 2)
    }
    avgTemp = mids.length ? meanOf(mids) : null
  }

  let gdd = 0
  let gddDays = 0
  let rainDays = 0
  let flightDays = 0

  for (let i = 0; i < daily.time.length; i++) {
    const hi = maxT[i]
    const lo = minT[i]
    const mm = precip[i]
    const kmh = wind[i]

    if (typeof hi === 'number' && typeof lo === 'number') {
      // Standard GDD: the day's mean above the base, never negative.
      gdd += Math.max(0, (hi + lo) / 2 - GDD_BASE_C)
      gddDays++
    }
    if (typeof mm === 'number' && mm >= RAIN_DAY_MM) rainDays++

    // A flight day needs all three readings — an unknown wind speed is not a
    // calm day, so an incomplete record does not get counted as workable.
    if (
      typeof hi === 'number' &&
      typeof mm === 'number' &&
      typeof kmh === 'number' &&
      hi >= FLIGHT_MIN_TEMP_C &&
      mm < FLIGHT_MAX_PRECIP_MM &&
      kmh < FLIGHT_MAX_WIND_KMH
    ) {
      flightDays++
    }
  }

  return {
    key,
    year,
    avgTemp,
    maxTemp: maxT.length ? meanOf(maxT) : null,
    minTemp: minT.length ? meanOf(minT) : null,
    totalPrecip: sumOf(precip),
    avgWind: meanOf(wind),
    growingDegreeDays: gddDays ? gdd : null,
    rainDays: precip.length ? rainDays : null,
    flightHours: daily.time.length ? flightDays : null,
  }
}

/** Round coordinates to the cache's grid (~110 m). Keep in step with 0014. */
export function weatherKey(lat: number, lng: number, year: string): string {
  return `${lat.toFixed(3)},${lng.toFixed(3)},${year}`
}

/** The season window the analysis uses, for a given year. */
export function seasonWindow(year: string): { start: string; end: string } {
  return { start: `${year}-04-01`, end: `${year}-09-30` }
}
