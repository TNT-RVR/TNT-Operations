/**
 * Pure row → app-type mappers for the Supabase backend. Kept separate from the
 * provider so they can be unit-tested without a live database.
 *
 * PostgREST serialises `numeric` columns as JSON numbers, but can also hand them
 * back as strings depending on config — so every numeric field is coerced with
 * `Number()` here to be safe. snake_case columns → camelCase app fields.
 */
import type { Field, Incubator, Inspection, SensorReading, ShapeType, IncubatorStatus, SensorSource } from './types'

export interface FieldRow {
  id: string
  name: string
  client: string
  region: string
  shape_type: string
  shelter_count: number | string
  data?: unknown
  updated_at: string
}

export interface IncubatorRow {
  id: string
  name: string
  location: string
  status: string
  started_at: string | null
  temp_target_c: number | string
  humidity_target_pct: number | string
  temp_mode?: string | null
  humidity_min?: number | string | null
  humidity_max?: number | string | null
  incubation_start?: string | null
  capacity?: number | string | null
}

export interface InspectionRow {
  id: string
  incubator_id: string
  at: string
  inspector: string
  health_score: number | string
  notes: string
}

export interface SensorReadingRow {
  id: string
  incubator_id: string
  at: string
  temp_c: number | string
  humidity_pct: number | string
  source: string
}

export function toField(row: FieldRow): Field {
  // `data` jsonb defaults to '{}' — treat an empty object as "no geometry yet".
  const geometry =
    row.data && typeof row.data === 'object' && Object.keys(row.data as object).length > 0
      ? (row.data as Field['geometry'])
      : undefined
  return {
    id: row.id,
    name: row.name,
    client: row.client,
    region: row.region,
    shapeType: row.shape_type as ShapeType,
    shelterCount: Number(row.shelter_count),
    updatedAt: row.updated_at,
    geometry,
  }
}

/** numeric column that may be null → number | null (PostgREST may send strings). */
const numOrNull = (v: number | string | null | undefined): number | null =>
  v === null || v === undefined || v === '' ? null : Number(v)

export function toIncubator(row: IncubatorRow): Incubator {
  return {
    id: row.id,
    name: row.name,
    location: row.location,
    status: row.status as IncubatorStatus,
    startedAt: row.started_at,
    tempTargetC: Number(row.temp_target_c),
    humidityTargetPct: Number(row.humidity_target_pct),
    tempMode: row.temp_mode ?? null,
    humidityMin: numOrNull(row.humidity_min),
    humidityMax: numOrNull(row.humidity_max),
    incubationStart: row.incubation_start ?? null,
    capacity: numOrNull(row.capacity),
  }
}

export function toInspection(row: InspectionRow): Inspection {
  return {
    id: row.id,
    incubatorId: row.incubator_id,
    at: row.at,
    inspector: row.inspector,
    healthScore: Number(row.health_score),
    notes: row.notes,
  }
}

export function toSensorReading(row: SensorReadingRow): SensorReading {
  return {
    id: row.id,
    incubatorId: row.incubator_id,
    at: row.at,
    tempC: Number(row.temp_c),
    humidityPct: Number(row.humidity_pct),
    source: row.source as SensorSource,
  }
}

/** App inspection (sans id) → the row shape for an insert. */
export function inspectionInsert(input: Omit<Inspection, 'id'>): Omit<InspectionRow, 'id'> {
  return {
    incubator_id: input.incubatorId,
    at: input.at,
    inspector: input.inspector,
    health_score: input.healthScore,
    notes: input.notes,
  }
}
