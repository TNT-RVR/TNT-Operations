/**
 * Planning a bulk import of block placements.
 *
 * Distinct from the returns-map spreadsheet load, which only draws a picture:
 * this WRITES. So it works out exactly what it would do first, shows that, and
 * only then acts — nobody should discover what an import did by looking at the
 * results afterwards.
 *
 * Rules match the scanner exactly, because the same season's data arrives by
 * both routes and they must agree:
 *   - an unknown label registers a new block
 *   - a block already placed this season is UPDATED, not duplicated
 *     (that's the `(block_id, season)` identity from migration 0012)
 *   - a row with no usable position is skipped and counted, never guessed at
 *
 * Pure: rows in, plan out. No database, no network.
 */
import { fieldFrame, pointInEnuRing } from './fieldFrame'
import { latlonListToEnu } from './geo'
import type { FieldDict } from './tentGrid'
import type { Block, BlockPlacement } from '@/data/types'

/** One row of the spreadsheet, already parsed into values. */
export interface ImportRow {
  label: string
  lat: number | null
  lng: number | null
  /** Field name as written in the sheet, if it has a field column. */
  fieldName?: string | null
  /** ISO date the block went out, if the sheet records one. */
  placedAt?: string | null
}

export interface PlanEntry {
  row: ImportRow
  /** Resolved field, and how we got there. */
  fieldId: string | null
  fieldSource: 'geometry' | 'name' | 'none'
  /** Existing placement this would overwrite, if any. */
  existingPlacementId: string | null
  /** True when the label isn't registered yet. */
  newBlock: boolean
}

export interface SkippedRow {
  row: ImportRow
  reason: string
}

export interface ImportPlan {
  /** Rows that would create a new placement. */
  create: PlanEntry[]
  /** Rows that would update a placement already recorded this season. */
  update: PlanEntry[]
  skipped: SkippedRow[]
  /** Distinct labels not yet on record, which the import would register. */
  newBlockLabels: string[]
  /** Rows whose field couldn't be resolved — imported, but unattributed. */
  unresolvedFields: number
}

export interface FieldLike {
  id: string
  name: string
  geometry?: unknown
}

/**
 * Which field a point falls inside.
 *
 * Geometry first and by a distance: a sheet's field names are whatever someone
 * typed, and vary between seasons and authors, while a coordinate either lies
 * within a boundary or it doesn't.
 */
export function fieldForPoint(fields: FieldLike[], lat: number, lng: number): string | null {
  for (const f of fields) {
    if (!f.geometry) continue
    const frame = fieldFrame(f.geometry as FieldDict)
    if (!frame) continue
    const [[e, n]] = latlonListToEnu([[lat, lng]], frame.pivotLon, frame.pivotLat)
    const ring = frame.boundaryEnu
    const inside =
      ring && ring.length >= 3 ? pointInEnuRing(ring, e, n) : e * e + n * n <= frame.radius * frame.radius
    if (inside) return f.id
  }
  return null
}

/** Loose name match, for sheets whose field names do line up. */
export function fieldByName(fields: FieldLike[], name: string): string | null {
  const want = name.trim().toLowerCase()
  if (!want) return null
  const exact = fields.find((f) => f.name.trim().toLowerCase() === want)
  if (exact) return exact.id
  // A sheet often writes "N Quarter" where the app has "North Quarter"; accept
  // a containment match only when exactly one field matches, never a guess
  // between several.
  const partial = fields.filter(
    (f) => f.name.trim().toLowerCase().includes(want) || want.includes(f.name.trim().toLowerCase()),
  )
  return partial.length === 1 ? partial[0].id : null
}

const validLat = (v: number) => v >= -90 && v <= 90
const validLng = (v: number) => v >= -180 && v <= 180
const isNullIsland = (lat: number, lng: number) => Math.abs(lat) < 1e-9 && Math.abs(lng) < 1e-9

/**
 * Work out what importing `rows` would do, without doing any of it.
 *
 * A row is skipped rather than guessed at when it has no label or no usable
 * coordinate: a placement with neither is a record of nothing, and one at 0,0
 * would land in the Atlantic.
 */
export function planBlockImport(
  rows: ImportRow[],
  ctx: {
    blocks: Block[]
    placements: BlockPlacement[]
    fields: FieldLike[]
    season: number
  },
): ImportPlan {
  const { blocks, placements, fields, season } = ctx
  const plan: ImportPlan = {
    create: [],
    update: [],
    skipped: [],
    newBlockLabels: [],
    unresolvedFields: 0,
  }

  const byLabel = new Map(blocks.map((b) => [b.label.trim().toLowerCase(), b]))
  const placementFor = new Map(
    placements.filter((p) => p.season === season).map((p) => [p.blockId, p]),
  )
  // Labels seen earlier in THIS import, so a sheet listing a block twice
  // doesn't plan two creates for it.
  const seenLabels = new Set<string>()
  const newLabels = new Set<string>()

  for (const row of rows) {
    const label = row.label?.trim() ?? ''
    if (!label) {
      plan.skipped.push({ row, reason: 'no block label' })
      continue
    }
    if (row.lat == null || row.lng == null) {
      plan.skipped.push({ row, reason: 'no coordinates' })
      continue
    }
    if (!validLat(row.lat) || !validLng(row.lng)) {
      plan.skipped.push({ row, reason: 'coordinates out of range' })
      continue
    }
    if (isNullIsland(row.lat, row.lng)) {
      plan.skipped.push({ row, reason: 'sitting at 0,0 (missing coordinates)' })
      continue
    }

    const key = label.toLowerCase()
    if (seenLabels.has(key)) {
      plan.skipped.push({ row, reason: 'the same block appears earlier in this file' })
      continue
    }
    seenLabels.add(key)

    // Resolve the field: where the block actually is, then what it's called.
    let fieldId = fieldForPoint(fields, row.lat, row.lng)
    let fieldSource: PlanEntry['fieldSource'] = fieldId ? 'geometry' : 'none'
    if (!fieldId && row.fieldName) {
      fieldId = fieldByName(fields, row.fieldName)
      if (fieldId) fieldSource = 'name'
    }
    if (!fieldId) plan.unresolvedFields++

    const block = byLabel.get(key)
    const newBlock = !block
    if (newBlock && !newLabels.has(key)) newLabels.add(key)

    const existing = block ? (placementFor.get(block.id) ?? null) : null
    const entry: PlanEntry = {
      row: { ...row, label },
      fieldId,
      fieldSource,
      existingPlacementId: existing?.id ?? null,
      newBlock,
    }
    if (existing) plan.update.push(entry)
    else plan.create.push(entry)
  }

  plan.newBlockLabels = [...newLabels]
  return plan
}
