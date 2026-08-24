import { describe, expect, it } from 'vitest'
import type { Field, FieldSeason, PollinationField } from '@/data/types'
import { canReceiveScans, seasonAsField, seasonFields } from './seasonFields'

const place = (over: Partial<PollinationField> = {}): PollinationField => ({
  id: 'pf1',
  name: 'SE 14-9-15',
  grower: 'Marcel Boehm',
  region: 'Taber',
  lld: 'SE-14-9-15-W4',
  boundary: { PP_Latitude: '49.83', PP_Longitude: '-111.6', Radius: '400' },
  notes: '',
  archivedAt: null,
  ...over,
})

const season = (over: Partial<FieldSeason> = {}): FieldSeason => ({
  id: 'fs1',
  fieldId: 'pf1',
  year: '2027',
  company: 'Proven Seeds',
  crop: 'Canola',
  acres: 124,
  plannedShelters: 24,
  status: 'planned',
  geometry: { num_female_rows: '8', num_male_rows: '2' },
  copiedFrom: null,
  shelterFieldId: 'sf1',
  notes: '',
  field: place(),
  ...over,
})

const mapField = (over: Partial<Field> = {}): Field => ({
  id: 'sf9',
  name: 'Old Map Field',
  client: 'Demo',
  region: '',
  shapeType: 'pivot',
  shelterCount: 12,
  updatedAt: '2026-01-01T00:00:00Z',
  geometry: { year: '2026', Radius: '300' },
  ...over,
})

describe('seasonAsField', () => {
  it('puts the field boundary and the season layout back together', () => {
    const f = seasonAsField(season())!
    expect(f.geometry).toMatchObject({
      Radius: '400', // the field's boundary
      num_female_rows: '8', // the season's layout
      year: '2027',
      company: 'Proven Seeds',
      acres: '124',
    })
  })

  // A crew scanning a block must land on the field the office sees, and every
  // scan table's foreign key points at shelter_fields.
  it('keeps the map row id when there is one', () => {
    expect(seasonAsField(season())!.id).toBe('sf1')
  })

  it('falls back to its own id when the field has no map row', () => {
    expect(seasonAsField(season({ shelterFieldId: null }))!.id).toBe('fs1')
  })

  // A season copied forward carries the whole of last year's dict, boundary
  // keys included. The field's real outline has to win, and it has to win the
  // same way `layoutDict` decides it — or the layout preview and Field Mode
  // would draw two different shapes for one field.
  it('lets the field boundary win over a stale one left in the layout', () => {
    const f = seasonAsField(season({ geometry: { Radius: '250', num_female_rows: '8' } }))!
    expect(f.geometry?.Radius).toBe('400')
    expect(f.geometry?.num_female_rows).toBe('8')
  })

  it('is nothing without its field', () => {
    expect(seasonAsField(season({ field: undefined }))).toBeNull()
  })
})

describe('seasonFields', () => {
  it('uses the season when it has been set up', () => {
    const out = seasonFields('2027', [season()], [mapField()])
    expect(out.map((f) => f.name)).toEqual(['SE 14-9-15'])
  })

  // The migration strategy in one assertion: a season nobody has set up still
  // works, off the map, exactly as before.
  it('falls back to the map for a season with no setup', () => {
    const out = seasonFields('2026', [season()], [mapField()])
    expect(out.map((f) => f.name)).toEqual(['Old Map Field'])
  })

  it('keeps unstamped map fields rather than hiding somebody unfinished work', () => {
    const out = seasonFields('2028', [], [mapField({ geometry: {} })])
    expect(out).toHaveLength(1)
  })

  it('sorts by name, so the crew list does not reshuffle', () => {
    const out = seasonFields(
      '2027',
      [season({ id: 'a', field: place({ name: 'Zed' }) }), season({ id: 'b', fieldId: 'pf2', field: place({ id: 'pf2', name: 'Alpha' }) })],
      [],
    )
    expect(out.map((f) => f.name)).toEqual(['Alpha', 'Zed'])
  })
})

describe('canReceiveScans', () => {
  it('is true only once the field has a map row to key scans to', () => {
    expect(canReceiveScans(season())).toBe(true)
    expect(canReceiveScans(season({ shelterFieldId: null }))).toBe(false)
  })
})
