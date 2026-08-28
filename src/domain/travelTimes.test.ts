import { describe, expect, it } from 'vitest'
import { fieldLocation, hasTravel, readDistanceMatrix, toLatLng } from './travelTimes'

describe('fieldLocation', () => {
  it('routes to the parking pin when there is one', () => {
    const loc = fieldLocation({
      id: 'f1',
      name: 'Giesbricht NW 35-10-16',
      parking_pin: [49.872671886713825, -112.08010722388144],
      PP_Latitude: '49.8693968',
      PP_Longitude: '-112.0761114',
    })
    expect(loc).toEqual({
      id: 'f1',
      name: 'Giesbricht NW 35-10-16',
      at: [49.872671886713825, -112.08010722388144],
      source: 'parking',
    })
  })

  /*
   * 4 of 15 real fields have no parking pin. Over 30 km of road the difference
   * between the pivot and where the truck stops is noise, so falling back is
   * better than leaving the field uncosted — but it is recorded.
   */
  it('falls back to the pivot, and says that is what it did', () => {
    const loc = fieldLocation({
      id: 'f2',
      name: 'BASF 1st Test Plot',
      PP_Latitude: '49.6852885',
      PP_Longitude: '-112.7535736',
    })
    expect(loc?.source).toBe('pivot')
    expect(loc?.at).toEqual([49.6852885, -112.7535736])
  })

  it('gives up on a field with no location at all', () => {
    expect(fieldLocation({ id: 'f3', name: 'nowhere' })).toBeNull()
    expect(fieldLocation({ id: 'f4', PP_Latitude: '', PP_Longitude: '' })).toBeNull()
  })

  it('rejects coordinates that are not on Earth', () => {
    expect(fieldLocation({ id: 'f5', parking_pin: [999, 0] })).toBeNull()
  })
})

// The previous router wanted lon,lat. Google wants lat,lng — a silent flip
// routes every field into the Gulf of Guinea and still returns confident km.
describe('toLatLng', () => {
  it('writes lat,lng the way Google reads it', () => {
    expect(toLatLng([49.87, -111.74])).toBe('49.87,-111.74')
  })
})

describe('readDistanceMatrix', () => {
  const dests = [
    { id: 'a', name: 'Stolk', at: [49.9, -112.0] as [number, number], source: 'parking' as const },
    { id: 'b', name: 'Giesbricht', at: [49.8, -112.1] as [number, number], source: 'pivot' as const },
  ]
  const ok = (metres: number, seconds: number) => ({
    status: 'OK',
    distance: { value: metres },
    duration: { value: seconds },
  })

  /*
   * Metres and seconds regardless of `units` — that only changes the localised
   * `text`. Reading `text` would mean parsing "31.5 km" back into a number.
   * These are the real Google figures already on file for these two fields.
   */
  it('turns metres and seconds into km and minutes', () => {
    const { results } = readDistanceMatrix(
      { status: 'OK', rows: [{ elements: [ok(31455, 1458), ok(36538, 1518)] }] },
      dests,
    )
    expect(results[0]).toMatchObject({ id: 'a', km: 31.455, min: 24.3, source: 'parking' })
    expect(results[1]).toMatchObject({ id: 'b', km: 36.538, min: 25.3, source: 'pivot' })
  })

  // No road near the pin. Writing 0 would be worse than leaving it: zero is
  // what the estimator already wrongly believes.
  it('leaves a ZERO_RESULTS field out rather than writing a zero', () => {
    const { results, unroutable } = readDistanceMatrix(
      { status: 'OK', rows: [{ elements: [{ status: 'ZERO_RESULTS' }, ok(36538, 1518)] }] },
      dests,
    )
    expect(results.map((r) => r.id)).toEqual(['b'])
    expect(unroutable).toEqual(['Stolk'])
  })

  it('does not trust an element that says OK with nothing in it', () => {
    const { results, unroutable } = readDistanceMatrix(
      { status: 'OK', rows: [{ elements: [{ status: 'OK' }, ok(0, 0)] }] },
      dests,
    )
    expect(results).toEqual([])
    expect(unroutable).toEqual(['Stolk', 'Giesbricht'])
  })

  it('copes with a response that has no rows at all', () => {
    const { results, unroutable } = readDistanceMatrix({ status: 'OK' }, dests)
    expect(results).toEqual([])
    expect(unroutable).toHaveLength(2)
  })
})

describe('hasTravel', () => {
  it('is true only when both figures are real', () => {
    expect(hasTravel({ home_to_parking_km: 31.455, home_to_parking_min: 24.3 })).toBe(true)
  })

  // The state 12 of 15 fields are in: the key is simply absent.
  it('is false for a field that has never been fetched', () => {
    expect(hasTravel({})).toBe(false)
    expect(hasTravel({ home_to_parking_km: 0, home_to_parking_min: 0 })).toBe(false)
    expect(hasTravel({ home_to_parking_km: 31.4 })).toBe(false)
  })
})
