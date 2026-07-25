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
  IncubationBatch,
  Inspection,
  InspectionPeriod,
  Sample,
  SensorReading,
  ShapeType,
  Tray,
  IncubatorStatus,
  SensorSource,
  AppNotification,
  NotificationSeverity,
} from './types'

type Num = number | string | null | undefined

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

export interface NotificationRow {
  id: string
  category: string
  type: string
  severity: string
  title: string
  body: string
  source: string
  created_at: string
  read_at: string | null
}

export function toNotification(row: NotificationRow): AppNotification {
  return {
    id: row.id,
    category: row.category,
    type: row.type,
    severity: row.severity as NotificationSeverity,
    title: row.title,
    body: row.body,
    source: row.source,
    createdAt: row.created_at,
    readAt: row.read_at,
  }
}

export interface SampleRow {
  id: string
  name: string
  source: string
  lot_number: string
  xray_live_pct: Num
  xray_parasite_pct: Num
  xray_dead_pct: Num
  total_volume_gal: Num
  total_weight_lbs: Num
  total_weight_kg: Num
  live_bees_per_lb: Num
  live_bees_per_kg: Num
  parasites: Num
  chalkbrood: Num
  total_trays: Num
  incubator_space: Num
  notes: string
  import_date: string | null
}

export function toSample(row: SampleRow): Sample {
  return {
    id: row.id,
    name: row.name,
    source: row.source,
    lotNumber: row.lot_number,
    xrayLivePct: numOrNull(row.xray_live_pct),
    xrayParasitePct: numOrNull(row.xray_parasite_pct),
    xrayDeadPct: numOrNull(row.xray_dead_pct),
    totalVolumeGal: numOrNull(row.total_volume_gal),
    totalWeightLbs: numOrNull(row.total_weight_lbs),
    totalWeightKg: numOrNull(row.total_weight_kg),
    liveBeesPerLb: numOrNull(row.live_bees_per_lb),
    liveBeesPerKg: numOrNull(row.live_bees_per_kg),
    parasites: numOrNull(row.parasites),
    chalkbrood: numOrNull(row.chalkbrood),
    totalTrays: numOrNull(row.total_trays),
    incubatorSpace: numOrNull(row.incubator_space),
    notes: row.notes,
    importDate: row.import_date,
  }
}

export interface TrayRow {
  id: string
  tray_number: string
  sample_id: string | null
  incubation_batch_id: string | null
  incubator_id: string | null
  weight_lbs: Num
  live_count: Num
  parasite_level_pct: Num
  volume_gal: Num
  in_date: string | null
  out_date: string | null
  cool_date: string | null
  status: string
  notes: string
}

export function toTray(row: TrayRow): Tray {
  return {
    id: row.id,
    trayNumber: row.tray_number,
    sampleId: row.sample_id,
    incubationBatchId: row.incubation_batch_id,
    incubatorId: row.incubator_id,
    weightLbs: numOrNull(row.weight_lbs),
    liveCount: numOrNull(row.live_count),
    parasiteLevelPct: numOrNull(row.parasite_level_pct),
    volumeGal: numOrNull(row.volume_gal),
    inDate: row.in_date,
    outDate: row.out_date,
    coolDate: row.cool_date,
    status: row.status,
    notes: row.notes ?? '',
  }
}

export interface BatchRow {
  id: string
  incubator_id: string | null
  sample_id: string | null
  name: string
  start_date: string | null
  vapona_in: string | null
  vapona_out: string | null
  air_out: string | null
  male_10pct_emergence: string | null
  earliest_cool: string | null
  estimated_release: string | null
  latest_release: string | null
  status: string
  notes: string
}

export function toBatch(row: BatchRow): IncubationBatch {
  return {
    id: row.id,
    incubatorId: row.incubator_id,
    sampleId: row.sample_id,
    name: row.name,
    startDate: row.start_date,
    vaponaIn: row.vapona_in,
    vaponaOut: row.vapona_out,
    airOut: row.air_out,
    male10pctEmergence: row.male_10pct_emergence,
    earliestCool: row.earliest_cool,
    estimatedRelease: row.estimated_release,
    latestRelease: row.latest_release,
    status: row.status,
    notes: row.notes,
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
