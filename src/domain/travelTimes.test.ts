import { describe, expect, it } from 'vitest'
import { fieldLocation, hasTravel, readMatrix, toOrsCoord } from './travelTimes'

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

// Getting this backwards routes every field to the Gulf of Guinea, and the
// numbers would still look plausible.
describe('toOrsCoord', () => {
  it('flips lat,lon into the lon,lat ORS wants', () => {
    expect(toOrsCoord([49.87, -111.74])).toEqual([-111.74, 49.87])
  })
})

describe('readMatrix', () => {
  const dests = [
    { id: 'a', name: 'Stolk', at: [49.9, -112.0] as [number, number], source: 'parking' as const },
    { id: 'b', name: 'Giesbricht', at: [49.8, -112.1] as [number, number], source: 'pivot' as const },
  ]

  it('turns one row of the matrix into km and minutes', () => {
    const { results } = readMatrix(
      { distances: [[31.455, 36.538]], durations: [[1458, 1518]] },
      dests,
    )
    expect(results).toHaveLength(2)
    expect(results[0]).toMatchObject({ id: 'a', km: 31.455, min: 24.3, source: 'parking' })
    expect(results[1]).toMatchObject({ id: 'b', km: 36.538, min: 25.3, source: 'pivot' })
  })

  /*
   * A pin with no road near it comes back null. Writing 0 would be worse than
   * leaving it: zero is exactly what the estimator already wrongly believes,
   * so it would make the gap permanent AND invisible.
   */
  it('leaves an unroutable field out rather than writing a zero', () => {
    const { results, unroutable } = readMatrix(
      { distances: [[null, 36.538]], durations: [[null, 1518]] },
      dests,
    )
    expect(results.map((r) => r.id)).toEqual(['b'])
    expect(unroutable).toEqual(['Stolk'])
  })

  it('treats a zero-distance answer as unroutable too', () => {
    const { results, unroutable } = readMatrix({ distances: [[0, 0]], durations: [[0, 0]] }, dests)
    expect(results).toEqual([])
    expect(unroutable).toEqual(['Stolk', 'Giesbricht'])
  })

  it('copes with a response that has no matrices at all', () => {
    const { results, unroutable } = readMatrix({}, dests)
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
