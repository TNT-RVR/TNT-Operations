/**
 * Pure row → app-type mappers for the Supabase backend. Kept separate from the
 * provider so they can be unit-tested without a live database.
 *
 * PostgREST serialises `numeric` columns as JSON numbers, but can also hand them
 * back as strings depending on config — so every numeric field is coerced with
 * `Number()` here to be safe. snake_case columns → camelCase app fields.
 */
import type {
  Field,
  Incubator,
  Inspection,
  InspectionPeriod,
  SensorReading,
  ShapeType,
  IncubatorStatus,
  SensorSource,
} from './types'

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
  period?: string
  thermometer_temp_c?: number | string | null
  govee_temp_c?: number | string | null
  temp_diff_c?: number | string | null
  temp_alert?: boolean
  heat_pumps_ok?: boolean
  parasites_emerging?: boolean
  bees_emerging?: boolean
  fans_ok?: boolean
  black_lights_ok?: boolean
  batch_id?: string | null
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
    period: (row.period as InspectionPeriod | undefined) ?? undefined,
    thermometerTempC: numOrNull(row.thermometer_temp_c),
    goveeTempC: numOrNull(row.govee_temp_c),
    tempDiffC: numOrNull(row.temp_diff_c),
    tempAlert: row.temp_alert ?? undefined,
    heatPumpsOk: row.heat_pumps_ok ?? undefined,
    parasitesEmerging: row.parasites_emerging ?? undefined,
    beesEmerging: row.bees_emerging ?? undefined,
    fansOk: row.fans_ok ?? undefined,
    blackLightsOk: row.black_lights_ok ?? undefined,
    batchId: row.batch_id ?? null,
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

/**
 * App inspection (sans id) → the row shape for an insert. Rich checklist fields
 * are only included when provided, so the DB defaults (period='manual', booleans
 * false, etc.) apply for a bare insert.
 */
export function inspectionInsert(input: Omit<Inspection, 'id'>): Record<string, unknown> {
  const row: Record<string, unknown> = {
    incubator_id: input.incubatorId,
    at: input.at,
    inspector: input.inspector,
    health_score: input.healthScore,
    notes: input.notes,
  }
  if (input.period !== undefined) row.period = input.period
  if (input.thermometerTempC !== undefined) row.thermometer_temp_c = input.thermometerTempC
  if (input.goveeTempC !== undefined) row.govee_temp_c = input.goveeTempC
  if (input.tempDiffC !== undefined) row.temp_diff_c = input.tempDiffC
  if (input.tempAlert !== undefined) row.temp_alert = input.tempAlert
  if (input.heatPumpsOk !== undefined) row.heat_pumps_ok = input.heatPumpsOk
  if (input.parasitesEmerging !== undefined) row.parasites_emerging = input.parasitesEmerging
  if (input.beesEmerging !== undefined) row.bees_emerging = input.beesEmerging
  if (input.fansOk !== undefined) row.fans_ok = input.fansOk
  if (input.blackLightsOk !== undefined) row.black_lights_ok = input.blackLightsOk
  if (input.batchId != null) row.batch_id = input.batchId
  return row
}
