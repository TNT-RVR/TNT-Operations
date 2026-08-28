/**
 * The two copies of the travel geometry must agree.
 *
 * `src/domain/travelTimes.ts` is what the app uses; the Netlify function
 * carries its own copy because nothing in `netlify/functions` reaches into
 * `src` (same reason `push.mjs` repeats the badge cap). A duplicate is fine as
 * long as it cannot drift, so this runs BOTH over the same inputs and compares
 * the answers — behaviour, not text, because a textual check would pass while
 * one of them quietly returned a different number.
 *
 * The failure it guards against is the worst kind here: the function would
 * write plausible-looking kilometres that the app prices real money off.
 */
import { describe, expect, it } from 'vitest'
import { fieldLocation, readDistanceMatrix, toLatLng } from './travelTimes'
// The function is plain JS with no types, which is the point — it is the copy
// that ships to Netlify. Imported for its BEHAVIOUR, not its shape.
import {
  fieldLocation as fnFieldLocation,
  readDistanceMatrix as fnReadDistanceMatrix,
  toLatLng as fnToLatLng,
// @ts-expect-error — a .mjs Netlify function has no declaration file
} from '../../netlify/functions/travel-times.mjs'

const FIELDS = [
  // A real one, with a parking pin.
  {
    id: 'a',
    name: 'Giesbricht NW 35-10-16',
    parking_pin: [49.872671886713825, -112.08010722388144],
    PP_Latitude: '49.8693968',
    PP_Longitude: '-112.0761114',
  },
  // A real one with no parking pin — falls back to the pivot.
  { id: 'b', name: 'BASF 1st Test Plot', PP_Latitude: '49.6852885', PP_Longitude: '-112.7535736' },
  // The blank-string case that would otherwise route to [0, 0].
  { id: 'c', name: 'No pins', PP_Latitude: '', PP_Longitude: '' },
  { id: 'd', name: 'Nothing at all' },
  { id: 'e', name: 'Off Earth', parking_pin: [999, 0] },
]

describe('travel geometry parity', () => {
  it('picks the same location for every shape of field', () => {
    for (const f of FIELDS) {
      expect(fnFieldLocation(f), f.name).toEqual(fieldLocation(f))
    }
  })

  it('writes coordinates the same way', () => {
    for (const c of [
      [49.87, -111.74],
      [0, 0],
      [-33.9, 151.2],
    ] as Array<[number, number]>) {
      expect(fnToLatLng(c)).toEqual(toLatLng(c))
    }
  })

  it('reads the same km and minutes out of a matrix', () => {
    const dests = FIELDS.map((f) => fieldLocation(f)).filter((d) => d !== null)
    const response = {
      status: 'OK',
      rows: [
        {
          elements: [
            { status: 'OK', distance: { value: 31455 }, duration: { value: 1458 } },
            { status: 'OK', distance: { value: 36538 }, duration: { value: 1518 } },
          ],
        },
      ],
    }
    expect(fnReadDistanceMatrix(response, dests)).toEqual(readDistanceMatrix(response, dests))
  })

  it('agrees about what is unroutable', () => {
    const dests = FIELDS.map((f) => fieldLocation(f)).filter((d) => d !== null)
    for (const response of [
      { status: 'OK', rows: [{ elements: [{ status: 'ZERO_RESULTS' }] }] },
      { status: 'OK', rows: [{ elements: [{ status: 'OK', distance: { value: 0 }, duration: { value: 0 } }] }] },
      { status: 'OK' },
      {},
    ]) {
      expect(fnReadDistanceMatrix(response, dests)).toEqual(readDistanceMatrix(response, dests))
    }
  })
})
