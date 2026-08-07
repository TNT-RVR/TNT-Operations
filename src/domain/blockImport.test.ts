import { describe, it, expect } from 'vitest'
import { planBlockImport, fieldForPoint, fieldByName, type ImportRow } from './blockImport'
import type { Block, BlockPlacement } from '@/data/types'

const PIVOT = {
  id: 'f_pivot',
  name: 'Grassy Lake NW Pivot',
  geometry: { PP_Longitude: '-111.6', PP_Latitude: '49.83', Radius: '400', use_bays: false },
}
const SQUARE = {
  id: 'f_square',
  name: 'Bow Island Quarter',
  geometry: {
    PP_Longitude: '-111.52',
    PP_Latitude: '49.86',
    use_bays: false,
    boundary_polygon: [
      [49.8564, -111.5256],
      [49.8636, -111.5256],
      [49.8636, -111.5144],
      [49.8564, -111.5144],
    ],
  },
}
const FIELDS = [PIVOT, SQUARE]

const block = (id: string, label: string): Block => ({ id, label, notes: '', createdAt: '' })

const placement = (id: string, blockId: string, season = 2026): BlockPlacement => ({
  id,
  blockId,
  season,
  fieldId: 'f_pivot',
  shelterId: null,
  lat: 49.83,
  lng: -111.6,
  placedAt: '2026-06-01T12:00:00Z',
  placedBy: '',
  retrievedAt: null,
  grossWeightLbs: null,
  retrievedBy: '',
  strippedAt: null,
  strippedWeightLbs: null,
  strippedBy: '',
  notes: '',
})

const row = (over: Partial<ImportRow> = {}): ImportRow => ({
  label: 'BLK0101',
  lat: 49.831,
  lng: -111.601,
  ...over,
})

const plan = (rows: ImportRow[], blocks: Block[] = [], placements: BlockPlacement[] = []) =>
  planBlockImport(rows, { blocks, placements, fields: FIELDS, season: 2026 })

describe('fieldForPoint', () => {
  it('finds the field a point sits inside', () => {
    expect(fieldForPoint(FIELDS, 49.831, -111.601)).toBe('f_pivot')
    expect(fieldForPoint(FIELDS, 49.86, -111.52)).toBe('f_square')
  })

  it('returns null for a point in no field', () => {
    expect(fieldForPoint(FIELDS, 50.5, -110.0)).toBeNull()
  })

  it('ignores fields with no geometry', () => {
    expect(fieldForPoint([{ id: 'x', name: 'No geometry' }], 49.83, -111.6)).toBeNull()
  })
})

describe('fieldByName', () => {
  it('matches exactly, ignoring case and spacing', () => {
    expect(fieldByName(FIELDS, '  grassy lake nw pivot ')).toBe('f_pivot')
  })

  it('accepts a partial match only when it is unambiguous', () => {
    expect(fieldByName(FIELDS, 'Bow Island')).toBe('f_square')
    // 'Field' would match nothing here; two candidates would return null.
    expect(fieldByName([...FIELDS, { id: 'f3', name: 'Bow Island South' }], 'Bow Island')).toBeNull()
  })

  it('returns null for an empty or unknown name', () => {
    expect(fieldByName(FIELDS, '')).toBeNull()
    expect(fieldByName(FIELDS, 'Nowhere')).toBeNull()
  })
})

describe('planBlockImport', () => {
  it('plans a create for a new block', () => {
    const p = plan([row()])
    expect(p.create).toHaveLength(1)
    expect(p.update).toHaveLength(0)
    expect(p.create[0].newBlock).toBe(true)
    expect(p.newBlockLabels).toEqual(['blk0101'])
  })

  it('resolves the field from the coordinates', () => {
    const p = plan([row()])
    expect(p.create[0].fieldId).toBe('f_pivot')
    expect(p.create[0].fieldSource).toBe('geometry')
  })

  it('falls back to the field name when the point is outside every boundary', () => {
    const p = plan([row({ lat: 50.5, lng: -110.0, fieldName: 'Bow Island Quarter' })])
    expect(p.create[0].fieldId).toBe('f_square')
    expect(p.create[0].fieldSource).toBe('name')
  })

  it('prefers geometry over a name that disagrees with it', () => {
    // The coordinates are in the pivot; the sheet says otherwise. Trust the
    // position — a name is whatever somebody typed.
    const p = plan([row({ fieldName: 'Bow Island Quarter' })])
    expect(p.create[0].fieldId).toBe('f_pivot')
    expect(p.create[0].fieldSource).toBe('geometry')
  })

  it('UPDATES a block already placed this season rather than duplicating it', () => {
    // The (block_id, season) identity — the same rule the scanner follows.
    const blocks = [block('b1', 'BLK0101')]
    const placements = [placement('p1', 'b1')]
    const p = plan([row()], blocks, placements)
    expect(p.create).toHaveLength(0)
    expect(p.update).toHaveLength(1)
    expect(p.update[0].existingPlacementId).toBe('p1')
    expect(p.update[0].newBlock).toBe(false)
  })

  it('treats last season as a separate placement, not a clash', () => {
    const blocks = [block('b1', 'BLK0101')]
    const placements = [placement('p_old', 'b1', 2025)]
    const p = plan([row()], blocks, placements)
    expect(p.create).toHaveLength(1) // a new 2026 placement
    expect(p.update).toHaveLength(0)
  })

  it('is idempotent: importing the same file twice changes nothing new', () => {
    const blocks = [block('b1', 'BLK0101')]
    const placements = [placement('p1', 'b1')]
    const first = plan([row()], blocks, placements)
    const second = plan([row()], blocks, placements)
    expect(first.create.length).toBe(second.create.length)
    expect(first.update.length).toBe(second.update.length)
  })

  it('skips rows with nothing usable, and says why', () => {
    const p = plan([
      row({ label: '   ' }),
      row({ lat: null }),
      row({ lat: 999 }),
      row({ lat: 0, lng: 0 }),
    ])
    expect(p.create).toHaveLength(0)
    expect(p.skipped.map((s) => s.reason)).toEqual([
      'no block label',
      'no coordinates',
      'coordinates out of range',
      'sitting at 0,0 (missing coordinates)',
    ])
  })

  it('skips a block listed twice in one file', () => {
    // Otherwise the same block is planned twice and the second write silently
    // overwrites the first.
    const p = plan([row(), row({ lat: 49.832 })])
    expect(p.create).toHaveLength(1)
    expect(p.skipped[0].reason).toMatch(/appears earlier/)
  })

  it('counts rows whose field could not be resolved', () => {
    const p = plan([row({ lat: 50.5, lng: -110.0 })])
    expect(p.unresolvedFields).toBe(1)
    expect(p.create[0].fieldId).toBeNull()
    // Still imported — the position is real even if the field is unknown.
    expect(p.create).toHaveLength(1)
  })

  it('reports each new label once, however many rows use it', () => {
    const p = plan([row(), row({ label: 'BLK0102', lat: 49.8295 })])
    expect(p.newBlockLabels.sort()).toEqual(['blk0101', 'blk0102'])
  })
})
