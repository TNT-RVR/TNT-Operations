import { describe, it, expect } from 'vitest'
import type { FeatureCollection } from 'geojson'
import { parsePathsFromGeoJson, parseActualSheltersCsv } from './importPaths'

// Two short sprayer passes near Grassy Lake, AB, as [lon,lat] — GeoJSON order.
const PASS_A: [number, number][] = [
  [-111.6, 49.83],
  [-111.6, 49.836],
]
const PASS_B: [number, number][] = [
  [-111.598, 49.83],
  [-111.598, 49.836],
  [-111.596, 49.836],
]

const fc = (...geoms: object[]): FeatureCollection =>
  ({
    type: 'FeatureCollection',
    features: geoms.map((geometry) => ({ type: 'Feature', properties: {}, geometry })),
  }) as FeatureCollection

describe('parsePathsFromGeoJson', () => {
  it('collects every LineString in a FeatureCollection', () => {
    const paths = parsePathsFromGeoJson(
      fc({ type: 'LineString', coordinates: PASS_A }, { type: 'LineString', coordinates: PASS_B }),
    )
    expect(paths).toHaveLength(2)
    expect(paths[0]).toHaveLength(2)
    expect(paths[1]).toHaveLength(3)
  })

  it('flips [lon,lat] → stored [lat,lon]', () => {
    const [path] = parsePathsFromGeoJson({ type: 'LineString', coordinates: PASS_A })
    expect(path[0]).toEqual([49.83, -111.6])
    expect(path[1]).toEqual([49.836, -111.6])
  })

  it('expands a MultiLineString into several paths', () => {
    const paths = parsePathsFromGeoJson(fc({ type: 'MultiLineString', coordinates: [PASS_A, PASS_B] }))
    expect(paths).toHaveLength(2)
    expect(paths[0][0]).toEqual([49.83, -111.6])
    expect(paths[1][2]).toEqual([49.836, -111.596])
  })

  it('takes a Polygon outer ring (thin-polygon exports)', () => {
    const ring: [number, number][] = [...PASS_A, [-111.5999, 49.836], [-111.5999, 49.83], [-111.6, 49.83]]
    const paths = parsePathsFromGeoJson(fc({ type: 'Polygon', coordinates: [ring, [[-111.599, 49.831]]] }))
    expect(paths).toHaveLength(1)
    expect(paths[0]).toHaveLength(ring.length) // outer ring only, kept closed
    expect(paths[0][0]).toEqual([49.83, -111.6])
  })

  it('digs through a bare geometry, a Feature and a GeometryCollection', () => {
    expect(parsePathsFromGeoJson({ type: 'LineString', coordinates: PASS_A })).toHaveLength(1)
    expect(
      parsePathsFromGeoJson({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: PASS_A } }),
    ).toHaveLength(1)
    expect(
      parsePathsFromGeoJson({
        type: 'GeometryCollection',
        geometries: [
          { type: 'Point', coordinates: [-111.6, 49.83] },
          { type: 'LineString', coordinates: PASS_B },
        ],
      }),
    ).toHaveLength(1)
  })

  it('drops lines with fewer than 2 finite points', () => {
    expect(parsePathsFromGeoJson(fc({ type: 'LineString', coordinates: [[-111.6, 49.83]] }))).toEqual([])
    expect(
      parsePathsFromGeoJson(fc({ type: 'LineString', coordinates: [[-111.6, 49.83], ['x', null]] })),
    ).toEqual([])
  })

  it('returns [] for null / garbage input instead of throwing', () => {
    expect(parsePathsFromGeoJson(null)).toEqual([])
    expect(parsePathsFromGeoJson(undefined)).toEqual([])
    expect(parsePathsFromGeoJson('not geojson')).toEqual([])
    expect(parsePathsFromGeoJson({ type: 'Point', coordinates: [-111.6, 49.83] })).toEqual([])
    expect(parsePathsFromGeoJson({ type: 'FeatureCollection', features: 'nope' })).toEqual([])
  })
})

describe('parseActualSheltersCsv — header variants', () => {
  it('reads lat,lon', () => {
    const r = parseActualSheltersCsv('lat,lon\n49.83,-111.6\n49.836,-111.598\n')
    expect(r.skipped).toBe(0)
    expect(r.pins).toEqual([
      { lat: 49.83, lng: -111.6 },
      { lat: 49.836, lng: -111.598 },
    ])
  })

  it('reads Latitude,Longitude case-insensitively', () => {
    const r = parseActualSheltersCsv('Latitude,Longitude\n49.83,-111.6\n')
    expect(r.pins).toEqual([{ lat: 49.83, lng: -111.6 }])
  })

  it('reads shelter,lat,lon and keeps the label', () => {
    const r = parseActualSheltersCsv('shelter,lat,lon\n12,49.83,-111.6\n13,49.836,-111.598\n')
    expect(r.skipped).toBe(0)
    expect(r.pins).toEqual([
      { lat: 49.83, lng: -111.6, label: '12' },
      { lat: 49.836, lng: -111.598, label: '13' },
    ])
  })

  it('reads name,y,x', () => {
    const r = parseActualSheltersCsv('name,y,x\nNorth corner,49.83,-111.6\n')
    expect(r.pins).toEqual([{ lat: 49.83, lng: -111.6, label: 'North corner' }])
  })

  it('reads columns in any order (lon before lat)', () => {
    const r = parseActualSheltersCsv('Longitude,Latitude,Shelter #\n-111.6,49.83,7\n')
    expect(r.pins).toEqual([{ lat: 49.83, lng: -111.6, label: '7' }])
  })
})

describe('parseActualSheltersCsv — headerless positional', () => {
  it('handles a bare lat,lon file', () => {
    const r = parseActualSheltersCsv('49.83,-111.6\n49.836,-111.598\n')
    expect(r.skipped).toBe(0)
    expect(r.pins).toEqual([
      { lat: 49.83, lng: -111.6 },
      { lat: 49.836, lng: -111.598 },
    ])
  })

  it('picks the right pair out of shelter,lat,lon', () => {
    const r = parseActualSheltersCsv('1,49.83,-111.6\n2,49.836,-111.598\n')
    expect(r.pins).toEqual([
      { lat: 49.83, lng: -111.6, label: '1' },
      { lat: 49.836, lng: -111.598, label: '2' },
    ])
  })
})

describe('parseActualSheltersCsv — messy real-world files', () => {
  it('survives CRLF, a UTF-8 BOM, quoted fields and blank lines', () => {
    const text = '﻿"Name","Latitude","Longitude"\r\n\r\n"Shelter, north",49.83,-111.6\r\n\r\n"S2",49.836,-111.598\r\n'
    const r = parseActualSheltersCsv(text)
    expect(r.skipped).toBe(0)
    expect(r.pins).toEqual([
      { lat: 49.83, lng: -111.6, label: 'Shelter, north' },
      { lat: 49.836, lng: -111.598, label: 'S2' },
    ])
  })

  it('strips a BOM sitting on the first coordinate of a headerless file', () => {
    const r = parseActualSheltersCsv('﻿49.83,-111.6\r\n49.836,-111.598\r\n')
    expect(r.skipped).toBe(0)
    expect(r.pins).toEqual([
      { lat: 49.83, lng: -111.6 },
      { lat: 49.836, lng: -111.598 },
    ])
  })

  it('accepts semicolon-delimited exports', () => {
    const r = parseActualSheltersCsv('Shelter;Lat;Lon\n4;49.83;-111.6\n')
    expect(r.pins).toEqual([{ lat: 49.83, lng: -111.6, label: '4' }])
  })

  it('counts out-of-range and non-numeric rows as skipped instead of emitting them', () => {
    const text = ['lat,lon', '49.83,-111.6', '91.2,-111.6', '49.83,-200.1', 'n/a,-111.6', '49.836,', ''].join('\n')
    const r = parseActualSheltersCsv(text)
    expect(r.pins).toEqual([{ lat: 49.83, lng: -111.6 }])
    expect(r.skipped).toBe(4)
  })

  it('returns no pins and never throws on unparseable input', () => {
    expect(parseActualSheltersCsv('')).toEqual({ pins: [], skipped: 0 })
    expect(parseActualSheltersCsv('   \n\n')).toEqual({ pins: [], skipped: 0 })
    const junk = parseActualSheltersCsv('Field report\nnothing here\nat all\n')
    expect(junk.pins).toEqual([])
    expect(junk.skipped).toBe(3)
  })

  it('round-trips a realistic 5-row crew export exactly', () => {
    const text = [
      'Shelter,Latitude,Longitude',
      '1,49.685294,-112.753568',
      '2,49.684752,-112.756100',
      '3,49.684249,-112.755714',
      '4,49.683808,-112.754947',
      '5,49.683572,-112.753643',
      '',
    ].join('\r\n')
    const r = parseActualSheltersCsv(text)
    expect(r.skipped).toBe(0)
    expect(r.pins).toEqual([
      { lat: 49.685294, lng: -112.753568, label: '1' },
      { lat: 49.684752, lng: -112.7561, label: '2' },
      { lat: 49.684249, lng: -112.755714, label: '3' },
      { lat: 49.683808, lng: -112.754947, label: '4' },
      { lat: 49.683572, lng: -112.753643, label: '5' },
    ])
  })
})
