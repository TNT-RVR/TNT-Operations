import { describe, it, expect } from 'vitest'
import { blocksOutsideFields, type FieldLike, type PlacementLike } from './outsideFields'

/**
 * A square-ish field around a pivot, big enough to be unambiguous: roughly
 * 400 m each way from the pivot at 49.9 N.
 */
const squareField = (id: string, lat: number, lng: number): FieldLike => ({
  id,
  name: id,
  geometry: {
    PP_Latitude: lat,
    PP_Longitude: lng,
    boundary_polygon: [
      [lat - 0.0036, lng - 0.0055],
      [lat - 0.0036, lng + 0.0055],
      [lat + 0.0036, lng + 0.0055],
      [lat + 0.0036, lng - 0.0055],
    ],
  },
})

const place = (over: Partial<PlacementLike> = {}): PlacementLike => ({
  id: 'p1',
  blockId: 'b1',
  fieldId: 'f1',
  lat: 49.9,
  lng: -111.5,
  season: 2026,
  ...over,
})

const F1 = squareField('f1', 49.9, -111.5)

describe('blocksOutsideFields', () => {
  it('says nothing about a block inside its field', () => {
    const r = blocksOutsideFields([F1], [place()], 2026)
    expect(r.points).toEqual([])
    expect(r.located).toBe(1)
  })

  it('finds a block filed under a field it does not sit in', () => {
    // A quarter section away — the shape of a boundary that was never traced.
    const r = blocksOutsideFields([F1], [place({ lat: 49.93, lng: -111.55 })], 2026)
    expect(r.points).toHaveLength(1)
    expect(r.points[0].filedUnder).toBe('f1')
  })

  it('accepts a block that sits in SOME other field', () => {
    // Filed wrong but physically inside a real boundary: not a missing
    // boundary, so not this report's problem.
    const F2 = squareField('f2', 49.93, -111.55)
    const r = blocksOutsideFields([F1, F2], [place({ lat: 49.93, lng: -111.55 })], 2026)
    expect(r.points).toEqual([])
  })

  it('counts by the field it was filed under, biggest first', () => {
    const far = { lat: 49.93, lng: -111.55 }
    const r = blocksOutsideFields(
      [F1],
      [
        place({ id: 'a', fieldId: 'f9', ...far }),
        place({ id: 'b', fieldId: 'f9', ...far }),
        place({ id: 'c', fieldId: 'f8', ...far }),
      ],
      2026,
    )
    expect(r.byFiledField).toEqual([
      { fieldId: 'f9', count: 2 },
      { fieldId: 'f8', count: 1 },
    ])
  })

  it('keeps blocks with no field recorded in their own bucket', () => {
    const r = blocksOutsideFields(
      [F1],
      [place({ fieldId: null, lat: 49.93, lng: -111.55 })],
      2026,
    )
    expect(r.byFiledField).toEqual([{ fieldId: null, count: 1 }])
  })

  it('ignores placements with no location at all', () => {
    // Nothing to test and nothing to draw — a weigh-in, not a placement.
    const r = blocksOutsideFields([F1], [place({ lat: null, lng: null })], 2026)
    expect(r.located).toBe(0)
    expect(r.points).toEqual([])
  })

  it('only looks at the season asked for', () => {
    const far = { lat: 49.93, lng: -111.55 }
    const rows = [place({ id: 'old', season: 2025, ...far }), place({ id: 'new', ...far })]
    expect(blocksOutsideFields([F1], rows, 2026).points.map((p) => p.placementId)).toEqual(['new'])
    expect(blocksOutsideFields([F1], rows).points).toHaveLength(2)
  })

  it('names the fields that cannot answer the question', () => {
    // No pivot, no frame. Reported rather than silently containing nothing:
    // the fix is to trace the field, not to re-scan the blocks.
    const blank: FieldLike = { id: 'f-blank', name: 'Untraced', geometry: {} }
    const r = blocksOutsideFields([F1, blank], [place()], 2026)
    expect(r.fieldsWithoutBoundary).toEqual(['f-blank'])
  })
})
