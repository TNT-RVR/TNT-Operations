/**
 * Pure row → app-type mappers for the Supabase backend. Kept separate from the
 * provider so they can be unit-tested without a live database.
 *
 * PostgREST serialises `numeric` columns as JSON numbers, but can also hand them
 * back as strings depending on config — so every numeric field is coerced with
 * `Number()` here to be safe. snake_case columns → camelCase app fields.
 */
import type {
  FieldChecklistCell,
  Block,
  BlockPlacement,
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
  IncubatorAlert,
  IncubatorModeEvent,
  TrayInspection,
  PlacedShelter,
  ShelterTrayLink,
  NestingBlock,
  Grant,
  GrantStatus,
  GrantTask,
  FieldAnalysis,
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
  sensibo_device_id?: string | null
  govee_device_id?: string | null
  govee_sku?: string | null
  sensor_online?: boolean | null
  sensor_seen_at?: string | null
  sensor_checked_at?: string | null
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
    sensiboDeviceId: row.sensibo_device_id ?? null,
    // Both halves are needed to poll, so both are what "linked" means.
    goveeLinked: Boolean(row.govee_device_id && row.govee_sku),
    sensorOnline: row.sensor_online ?? null,
    sensorSeenAt: row.sensor_seen_at ?? null,
    sensorCheckedAt: row.sensor_checked_at ?? null,
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

export interface IncubatorModeEventRow {
  id: string
  incubator_id: string
  from_mode: string | null
  to_mode: string
  changed_at: string
  changed_by: string | null
  backfilled?: boolean | null
  note?: string | null
}

export function toIncubatorModeEvent(row: IncubatorModeEventRow): IncubatorModeEvent {
  return {
    id: row.id,
    incubatorId: row.incubator_id,
    fromMode: row.from_mode,
    toMode: row.to_mode,
    changedAt: row.changed_at,
    changedBy: row.changed_by,
    backfilled: row.backfilled ?? false,
    note: row.note ?? '',
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

export interface AlertRow {
  id: string
  alert_type: string
  severity: string
  incubator_id: string | null
  tray_id: string | null
  batch_id: string | null
  message: string
  triggered_at: string
  acknowledged: boolean
  acknowledged_at: string | null
  notified: boolean
}

export function toAlert(row: AlertRow): IncubatorAlert {
  return {
    id: row.id,
    alertType: row.alert_type,
    severity: (row.severity as NotificationSeverity) ?? 'info',
    incubatorId: row.incubator_id,
    trayId: row.tray_id,
    batchId: row.batch_id,
    message: row.message,
    triggeredAt: row.triggered_at,
    acknowledged: !!row.acknowledged,
    acknowledgedAt: row.acknowledged_at,
    notified: !!row.notified,
  }
}

export interface TrayInspectionRow {
  id: string
  inspection_id: string | null
  tray_id: string | null
  tray_number: string | null
  incubator_id: string | null
  timestamp: string | null
  stack_position: string | null
  depth_position: string | null
  cells_opened: number | string | null
  dev_stage: string | null
  notes: string | null
}

export function toTrayInspection(row: TrayInspectionRow): TrayInspection {
  return {
    id: row.id,
    inspectionId: row.inspection_id,
    trayId: row.tray_id,
    trayNumber: row.tray_number,
    incubatorId: row.incubator_id,
    at: row.timestamp,
    stackPosition: row.stack_position,
    depthPosition: row.depth_position,
    cellsOpened: numOrNull(row.cells_opened),
    devStage: row.dev_stage,
    notes: row.notes ?? '',
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
  field_id?: string | null
  harvest_season?: Num
  live_bees_per_lb: Num
  live_bees_per_kg: Num
  parasites: Num
  chalkbrood: Num
  total_trays: Num
  incubator_space: Num
  lbs_per_2gal: Num
  kg_per_2gal: Num
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
    lbsPer2Gal: numOrNull(row.lbs_per_2gal),
    kgPer2Gal: numOrNull(row.kg_per_2gal),
    notes: row.notes,
    importDate: row.import_date,
    fieldId: row.field_id ?? null,
    harvestSeason: numOrNull(row.harvest_season),
  }
}

export interface BlockRow {
  id: string
  label: string
  notes: string | null
  created_at: string
}

export function toBlock(row: BlockRow): Block {
  return {
    id: row.id,
    label: row.label,
    notes: row.notes ?? '',
    createdAt: row.created_at,
  }
}

export interface BlockPlacementRow {
  id: string
  block_id: string
  season: number
  field_id: string | null
  shelter_id: string | null
  lat: Num
  lon: Num
  placed_at: string | null
  placed_by: string | null
  retrieved_at: string | null
  gross_weight_lbs: Num
  retrieved_by: string | null
  stripped_at: string | null
  stripped_weight_lbs: Num
  stripped_by: string | null
  notes: string | null
}

export function toBlockPlacement(row: BlockPlacementRow): BlockPlacement {
  return {
    id: row.id,
    blockId: row.block_id,
    // Postgres integer arrives as a number, but a string here would poison
    // every season comparison downstream.
    season: Number(row.season),
    fieldId: row.field_id,
    shelterId: row.shelter_id,
    lat: numOrNull(row.lat),
    // DB column is `lon`; the app has used `lng` since 0008.
    lng: numOrNull(row.lon),
    placedAt: row.placed_at,
    placedBy: row.placed_by ?? '',
    retrievedAt: row.retrieved_at,
    grossWeightLbs: numOrNull(row.gross_weight_lbs),
    retrievedBy: row.retrieved_by ?? '',
    strippedAt: row.stripped_at,
    strippedWeightLbs: numOrNull(row.stripped_weight_lbs),
    strippedBy: row.stripped_by ?? '',
    notes: row.notes ?? '',
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
 * Partial app Incubator → snake_case row patch for an update. Only the keys
 * actually present are emitted, so a patch never clobbers untouched columns.
 */
export function incubatorUpdate(patch: Partial<Incubator>): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if (patch.name !== undefined) row.name = patch.name
  if (patch.location !== undefined) row.location = patch.location
  if (patch.status !== undefined) row.status = patch.status
  if (patch.startedAt !== undefined) row.started_at = patch.startedAt
  if (patch.tempTargetC !== undefined) row.temp_target_c = patch.tempTargetC
  if (patch.humidityTargetPct !== undefined) row.humidity_target_pct = patch.humidityTargetPct
  if (patch.tempMode !== undefined) row.temp_mode = patch.tempMode
  if (patch.humidityMin !== undefined) row.humidity_min = patch.humidityMin
  if (patch.humidityMax !== undefined) row.humidity_max = patch.humidityMax
  if (patch.incubationStart !== undefined) row.incubation_start = patch.incubationStart
  if (patch.capacity !== undefined) row.capacity = patch.capacity
  if (patch.sensiboDeviceId !== undefined) row.sensibo_device_id = patch.sensiboDeviceId
  return row
}

/** Partial app Sample → snake_case row patch (only the provided keys). */
export function samplePatch(patch: Partial<Sample>): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if (patch.name !== undefined) row.name = patch.name
  if (patch.source !== undefined) row.source = patch.source
  if (patch.lotNumber !== undefined) row.lot_number = patch.lotNumber
  if (patch.xrayLivePct !== undefined) row.xray_live_pct = patch.xrayLivePct
  if (patch.xrayParasitePct !== undefined) row.xray_parasite_pct = patch.xrayParasitePct
  if (patch.xrayDeadPct !== undefined) row.xray_dead_pct = patch.xrayDeadPct
  if (patch.totalVolumeGal !== undefined) row.total_volume_gal = patch.totalVolumeGal
  if (patch.totalWeightLbs !== undefined) row.total_weight_lbs = patch.totalWeightLbs
  if (patch.totalWeightKg !== undefined) row.total_weight_kg = patch.totalWeightKg
  if (patch.fieldId !== undefined) row.field_id = patch.fieldId
  if (patch.harvestSeason !== undefined) row.harvest_season = patch.harvestSeason
  if (patch.liveBeesPerLb !== undefined) row.live_bees_per_lb = patch.liveBeesPerLb
  if (patch.liveBeesPerKg !== undefined) row.live_bees_per_kg = patch.liveBeesPerKg
  if (patch.parasites !== undefined) row.parasites = patch.parasites
  if (patch.chalkbrood !== undefined) row.chalkbrood = patch.chalkbrood
  if (patch.lbsPer2Gal !== undefined) row.lbs_per_2gal = patch.lbsPer2Gal
  if (patch.kgPer2Gal !== undefined) row.kg_per_2gal = patch.kgPer2Gal
  if (patch.totalTrays !== undefined) row.total_trays = patch.totalTrays
  if (patch.incubatorSpace !== undefined) row.incubator_space = patch.incubatorSpace
  if (patch.notes !== undefined) row.notes = patch.notes
  if (patch.importDate !== undefined) row.import_date = patch.importDate
  return row
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

// ── Bee lineage rows (0008) ──────────────────────────────────────────────────

export interface PlacedShelterRow {
  id: string
  field_id: string | null
  qr_code: string | null
  grid_idx: Num
  lat: Num
  lon: Num
  placed_at: string
  placed_by: string
  status: string
  notes: string
}

export function toPlacedShelter(row: PlacedShelterRow): PlacedShelter {
  return {
    id: row.id,
    fieldId: row.field_id,
    qrCode: row.qr_code,
    gridIdx: numOrNull(row.grid_idx),
    lat: numOrNull(row.lat),
    lng: numOrNull(row.lon),
    placedAt: row.placed_at,
    placedBy: row.placed_by ?? '',
    crewId: (row as { crew_id?: string | null }).crew_id ?? null,
    status: row.status ?? 'placed',
    notes: row.notes ?? '',
  }
}

export interface ShelterTrayLinkRow {
  id: string
  shelter_id: string
  tray_id: string
  scanned_at: string
  scanned_by: string
}

export function toShelterTrayLink(row: ShelterTrayLinkRow): ShelterTrayLink {
  return {
    id: row.id,
    shelterId: row.shelter_id,
    trayId: row.tray_id,
    scannedAt: row.scanned_at,
    scannedBy: row.scanned_by ?? '',
  }
}

export interface NestingBlockRow {
  id: string
  qr_code: string | null
  shelter_id: string | null
  notes: string
  created_at: string
}

export function toNestingBlock(row: NestingBlockRow): NestingBlock {
  return {
    id: row.id,
    qrCode: row.qr_code,
    shelterId: row.shelter_id,
    notes: row.notes ?? '',
    createdAt: row.created_at,
  }
}

// ── Grants (0009) ────────────────────────────────────────────────────────────

export interface GrantRow {
  id: string
  title: string
  funder: string | null
  url: string | null
  status: string
  amount_min: Num
  amount_max: Num
  eligibility_summary: string | null
  summary: string | null
  notes_md: string | null
  opens_on: string | null
  closes_on: string | null
  region: string | null
  categories: string[] | null
  assigned_to: string | null
  source: string
  created_at: string
}

export function toGrant(row: GrantRow): Grant {
  return {
    id: row.id,
    title: row.title,
    funder: row.funder,
    url: row.url,
    status: row.status as GrantStatus,
    amountMin: numOrNull(row.amount_min),
    amountMax: numOrNull(row.amount_max),
    eligibilitySummary: row.eligibility_summary,
    summary: row.summary,
    notesMd: row.notes_md,
    opensOn: row.opens_on,
    closesOn: row.closes_on,
    region: row.region,
    categories: row.categories ?? [],
    assignedTo: row.assigned_to,
    source: row.source ?? 'manual',
    createdAt: row.created_at,
  }
}

/** App grant patch → snake_case row patch (only the provided keys). */
export function grantPatch(patch: Partial<Grant>): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if (patch.title !== undefined) row.title = patch.title
  if (patch.funder !== undefined) row.funder = patch.funder
  if (patch.url !== undefined) row.url = patch.url
  if (patch.status !== undefined) row.status = patch.status
  if (patch.amountMin !== undefined) row.amount_min = patch.amountMin
  if (patch.amountMax !== undefined) row.amount_max = patch.amountMax
  if (patch.eligibilitySummary !== undefined) row.eligibility_summary = patch.eligibilitySummary
  if (patch.summary !== undefined) row.summary = patch.summary
  if (patch.notesMd !== undefined) row.notes_md = patch.notesMd
  if (patch.opensOn !== undefined) row.opens_on = patch.opensOn
  if (patch.closesOn !== undefined) row.closes_on = patch.closesOn
  if (patch.region !== undefined) row.region = patch.region
  if (patch.categories !== undefined) row.categories = patch.categories
  if (patch.assignedTo !== undefined) row.assigned_to = patch.assignedTo
  if (patch.source !== undefined) row.source = patch.source
  return row
}

export interface GrantTaskRow {
  id: string
  grant_id: string
  title: string
  status: string
  assigned_to: string | null
  created_at: string
}

export function toGrantTask(row: GrantTaskRow): GrantTask {
  return {
    id: row.id,
    grantId: row.grant_id,
    title: row.title,
    status: row.status ?? 'open',
    assignedTo: row.assigned_to,
    createdAt: row.created_at,
  }
}

// ── Season analysis (0014) ───────────────────────────────────────────────────

/**
 * Raw `field_analysis` row. Unusually, the app type keeps these same snake_case
 * names — the analysis screens address metrics dynamically by column key rather
 * than by property, so renaming would need a 40-entry translation table. See
 * the note on `FieldAnalysis` in types.ts.
 */
export type FieldAnalysisRow = Record<string, unknown> & { id: string }

/** Every numeric column, so PostgREST's string-or-number output is coerced once. */
const ANALYSIS_NUMERIC_COLS = [
  'acres', 'lat', 'lng', 'male_row_spacing', 'female_row_spacing', 'male_rows',
  'female_rows', 'shelters_per_acre', 'num_structures', 'blocks_per_shelter',
  'sprayer_width', 'seeding_angle', 'gallons_put_out', 'gallons_returned',
  'gals_per_acre', 'pounds', 'percent_return', 'live_count', 'live_prepupae',
  'immature_larvae', 'dead_prepupae', 'dead_larvae', 'pollen_balls',
  'second_generation', 'predators_and_pests', 'parasites',
  'chalkbrood_sporulating', 'chalkbrood_non_sporulating', 'machine_damage',
  'sex_ratio_test_viability', 'percent_female', 'percent_male',
  'clean_weight_yield', 'yield_per_acre', 'avg_for_variety',
] as const

const ANALYSIS_TEXT_COLS = [
  'field_name', 'year', 'company', 'crop', 'field_id', 'variety_code',
  'farmer_name', 'planting_pattern', 'notes',
] as const

const ANALYSIS_DATE_COLS = [
  'seeding_date', 'predicted_flower_date', 'actual_bee_release',
  'bees_brought_back_in',
] as const

const ANALYSIS_BOOL_COLS = ['hail_damage', 'bad_recording', 'experimental'] as const

export function toFieldAnalysis(row: FieldAnalysisRow): FieldAnalysis {
  const out: Record<string, unknown> = {
    id: row.id,
    shelter_field_id: (row.shelter_field_id as string | null) ?? null,
  }
  for (const c of ANALYSIS_TEXT_COLS) out[c] = (row[c] as string | null) ?? ''
  for (const c of ANALYSIS_DATE_COLS) out[c] = (row[c] as string | null) ?? null
  for (const c of ANALYSIS_BOOL_COLS) out[c] = row[c] === true
  for (const c of ANALYSIS_NUMERIC_COLS) {
    out[c] = numOrNull(row[c] as number | string | null | undefined)
  }
  return out as unknown as FieldAnalysis
}

/** `field_checklist` row → the seam type (migration 0039). */
export interface FieldChecklistRow {
  id: string
  year: string
  field_name: string
  step: string
  shelter_field_id: string | null
  planned_date: string | null
  completed_date: string | null
  note: string | null
  updated_at: string
}

export function toFieldChecklistCell(r: FieldChecklistRow): FieldChecklistCell {
  return {
    id: r.id,
    year: String(r.year),
    fieldName: r.field_name,
    step: r.step,
    shelterFieldId: r.shelter_field_id,
    plannedDate: r.planned_date,
    completedDate: r.completed_date,
    note: r.note ?? '',
    updatedAt: r.updated_at,
  }
}
