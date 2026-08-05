/** Shared domain types for TNT Operations. Backend-agnostic. */
import type { GrantStatus } from '@/domain/grants'

export type { GrantStatus }

export type ShapeType = 'pivot' | 'polygon'

/**
 * Full field-authoring definition (pivot/boundary, bay layout, tracks, shelter
 * mode…) — the raw dict the shelter-grid engine `getTentPositions` consumes.
 * Loosely typed on purpose; it mirrors the old app's field JSON and is stored in
 * the Supabase `fields.data` jsonb column.
 */
export type FieldGeometry = Record<string, unknown>

/** A pollination field with placed bee-shelter positions (Shelter Maps section). */
export interface Field {
  id: string
  name: string
  client: string
  region: string
  shapeType: ShapeType
  shelterCount: number
  /** ISO UTC. */
  updatedAt: string
  /** Full authoring geometry for map rendering; absent until a field is drawn/imported. */
  geometry?: FieldGeometry
}

export type IncubatorStatus = 'active' | 'idle'

/** A leafcutter-bee incubator (Incubation section). */
export interface Incubator {
  id: string
  name: string
  location: string
  status: IncubatorStatus
  /** ISO UTC when the current incubation batch started (null when idle). */
  startedAt: string | null
  tempTargetC: number
  humidityTargetPct: number
  // ── Live-DB fields (present in supabase mode; optional so mock stays simple) ──
  /** Temperature mode: 'off' | 'cool_storage' | 'incubation' | 'holding'. */
  tempMode?: string | null
  humidityMin?: number | null
  humidityMax?: number | null
  /** Date the incubation run started (date-only from the old app). */
  incubationStart?: string | null
  capacity?: number | null
}

/** Time-of-day slot for a routine inspection (matches the old app's schema). */
export type InspectionPeriod = 'morning' | 'evening' | 'manual'

export interface Inspection {
  id: string
  incubatorId: string
  /** ISO UTC. */
  at: string
  inspector: string
  /** 0–100 subjective health score. Legacy/optional — the real checklist below
   *  is the operational record; imported rows carry 0 here. */
  healthScore: number
  notes: string
  // ── Rich checklist (ported from the original bee-incubation app) ─────────────
  /** morning / evening routine, or an ad-hoc `manual` check. */
  period?: InspectionPeriod
  /** Hand thermometer reading (°C) taken during the inspection. */
  thermometerTempC?: number | null
  /** The Govee sensor's reading (°C) at inspection time, for comparison. */
  goveeTempC?: number | null
  /** thermometer − govee (°C); surfaces sensor drift. */
  tempDiffC?: number | null
  /** Set when the thermometer/Govee gap is large enough to flag. */
  tempAlert?: boolean
  heatPumpsOk?: boolean
  parasitesEmerging?: boolean
  beesEmerging?: boolean
  fansOk?: boolean
  blackLightsOk?: boolean
  /** Optional link to an incubation batch. */
  batchId?: string | null
}

/** A raw bee sample (lot) with x-ray grading and derived tray math. */
export interface Sample {
  id: string
  name: string
  source: string
  lotNumber: string
  xrayLivePct: number | null
  xrayParasitePct: number | null
  xrayDeadPct: number | null
  totalVolumeGal: number | null
  totalWeightLbs: number | null
  totalWeightKg: number | null
  liveBeesPerLb: number | null
  liveBeesPerKg: number | null
  parasites: number | null
  chalkbrood: number | null
  totalTrays: number | null
  incubatorSpace: number | null
  /** Pounds of raw sample per 2-gal tray — the per-tray weight the scan flow
   *  stamps onto a tray. Stored (not derived): no sample carries xrayLivePct. */
  lbsPer2Gal: number | null
  kgPer2Gal: number | null
  notes: string
  importDate: string | null
}

/** A single incubation tray (mostly historical/released in the current data). */
export interface Tray {
  id: string
  trayNumber: string
  sampleId: string | null
  incubationBatchId: string | null
  incubatorId: string | null
  weightLbs: number | null
  liveCount: number | null
  parasiteLevelPct: number | null
  volumeGal: number | null
  inDate: string | null
  outDate: string | null
  coolDate: string | null
  status: string
  notes: string
}

/** An incubation batch (run) with its timeline milestones. */
export interface IncubationBatch {
  id: string
  incubatorId: string | null
  sampleId: string | null
  name: string
  startDate: string | null
  vaponaIn: string | null
  vaponaOut: string | null
  airOut: string | null
  male10pctEmergence: string | null
  earliestCool: string | null
  estimatedRelease: string | null
  latestRelease: string | null
  status: string
  notes: string
}

// ── Bee lineage (spec Part 1.3): blocks → shelters → trays → incubators ──────

/** A physically placed shelter in a field (QR + GPS), as scanned by a crew. */
export interface PlacedShelter {
  id: string
  fieldId: string | null
  qrCode: string | null
  /** Computed grid pin this placement corresponds to (null = manual/extra). */
  gridIdx: number | null
  lat: number | null
  lng: number | null
  /** ISO UTC. */
  placedAt: string
  placedBy: string
  status: string
  notes: string
}

/** A tray scanned into a placed shelter (the tray↔shelter lineage link). */
export interface ShelterTrayLink {
  id: string
  shelterId: string
  trayId: string
  /** ISO UTC. */
  scannedAt: string
  scannedBy: string
}

/** A nesting block (where the bees actually live), tied to its shelter. */
export interface NestingBlock {
  id: string
  qrCode: string | null
  shelterId: string | null
  notes: string
  /** ISO UTC. */
  createdAt: string
}

// ── Nesting blocks (place → retrieve → strip; see migration 0012) ────────────

/**
 * A physical nesting block, identified by the QR label printed on it.
 * Permanent and reused every season — the per-season record is BlockPlacement.
 *
 * Distinct from `NestingBlock` above, which is the unused 0008 stub (no
 * location, no weights, hung off a shelter) kept only for LineageHome.
 */
export interface Block {
  id: string
  /** What the QR encodes; the block's permanent identity. */
  label: string
  notes: string
  /** ISO UTC. */
  createdAt: string
}

/** How far through the place → retrieve → strip cycle a placement has got. */
export type BlockStage = 'placed' | 'retrieved' | 'stripped'

/**
 * One season's use of one block, built up by three scans in the field:
 * placed (field + GPS), retrieved (gross weight), stripped (empty weight).
 */
export interface BlockPlacement {
  id: string
  blockId: string
  /** Calendar year — one placement per block per season. */
  season: number
  fieldId: string | null
  /** Reserved for placing blocks into a specific shelter later. */
  shelterId: string | null
  lat: number | null
  lng: number | null
  /** ISO UTC. */
  placedAt: string | null
  placedBy: string
  /** ISO UTC. */
  retrievedAt: string | null
  /** Weighed with the bee material still in it. */
  grossWeightLbs: number | null
  retrievedBy: string
  /** ISO UTC. */
  strippedAt: string | null
  /** Weighed after the bee material was removed. */
  strippedWeightLbs: number | null
  strippedBy: string
  notes: string
}

// ── Season analysis (ported from the Leaf Bee Insights Base44 app) ──────────

/**
 * One field's record for one season, for after-harvest analysis.
 *
 * NOTE the naming. Every other type here is camelCase, mapped from snake_case
 * columns. This one keeps the database's own column names, on purpose:
 *
 * The analysis screens never write `row.livePrepupae`. They iterate the metric
 * registry in `src/domain/analysisMetrics.ts` and read `row[metric.key]`,
 * because "which metric" is a runtime choice made by the person looking at the
 * chart. Renaming the columns would mean carrying a 40-entry translation table
 * between the registry, the SQL and the CSV headers, and every one of those
 * three would be a place for a typo to silently produce an empty chart.
 *
 * So: a wide statistical record addressed by column key, not a domain object.
 * `field_analysis` rows are read-only in the app — they arrive by import.
 */
export interface FieldAnalysis {
  id: string

  // Identity
  field_name: string
  year: string
  company: string
  crop: string
  /** The seed company's own field number, not ours. */
  field_id: string
  variety_code: string
  farmer_name: string
  /** Set where a season row could be matched to an operational field. */
  shelter_field_id: string | null

  // Field & planting layout
  acres: number | null
  lat: number | null
  lng: number | null
  planting_pattern: string
  male_row_spacing: number | null
  female_row_spacing: number | null
  male_rows: number | null
  female_rows: number | null
  shelters_per_acre: number | null
  num_structures: number | null
  blocks_per_shelter: number | null
  sprayer_width: number | null
  seeding_angle: number | null

  // Bee logistics
  gallons_put_out: number | null
  gallons_returned: number | null
  gals_per_acre: number | null
  pounds: number | null
  percent_return: number | null
  live_count: number | null

  // X-ray grading — percent units (0–100). These 11 sum to ~100; see
  // src/domain/analysisRelations.ts for why that matters when correlating.
  live_prepupae: number | null
  immature_larvae: number | null
  dead_prepupae: number | null
  dead_larvae: number | null
  pollen_balls: number | null
  second_generation: number | null
  predators_and_pests: number | null
  parasites: number | null
  chalkbrood_sporulating: number | null
  chalkbrood_non_sporulating: number | null
  machine_damage: number | null
  sex_ratio_test_viability: number | null
  percent_female: number | null
  percent_male: number | null

  // Timeline (ISO dates, no time component)
  seeding_date: string | null
  predicted_flower_date: string | null
  actual_bee_release: string | null
  bees_brought_back_in: string | null

  // Outcome — recorded on only about a fifth of rows.
  clean_weight_yield: number | null
  yield_per_acre: number | null
  avg_for_variety: number | null

  // Excluded from analysis by default via the settings toggles.
  hail_damage: boolean
  bad_recording: boolean
  experimental: boolean

  notes: string
}

/** Season weather for one field, derived from the cached Open-Meteo response. */
export interface FieldWeather {
  /** `${lat_key},${lng_key},${year}` — matches how the cache is keyed. */
  key: string
  year: string
  avgTemp: number | null
  maxTemp: number | null
  minTemp: number | null
  totalPrecip: number | null
  avgWind: number | null
  growingDegreeDays: number | null
  rainDays: number | null
  /** Days warm, dry and calm enough for leafcutters to work. */
  flightHours: number | null
}

// ── Grants (funding pipeline; mirrors the RVR Management App) ────────────────

/** A funding opportunity we're tracking through the application workflow. */
export interface Grant {
  id: string
  title: string
  funder: string | null
  url: string | null
  status: GrantStatus
  amountMin: number | null
  amountMax: number | null
  eligibilitySummary: string | null
  summary: string | null
  /** Our notes (markdown-ish free text). */
  notesMd: string | null
  opensOn: string | null
  closesOn: string | null
  region: string | null
  categories: string[]
  assignedTo: string | null
  /** 'manual' (added by hand) | 'auto' (weekly Claude web-search pull). */
  source: string
  /** ISO UTC. */
  createdAt: string
}

/** An assignable work item / subtask on a grant application. */
export interface GrantTask {
  id: string
  grantId: string
  title: string
  /** 'open' | 'done'. */
  status: string
  assignedTo: string | null
  /** ISO UTC. */
  createdAt: string
}

export type NotificationSeverity = 'info' | 'warning' | 'critical'

/** An alert shown in the notification view (integration health, thresholds, …). */
/**
 * An incubation alert raised by the monitoring rules (temp/humidity out of
 * band, inspection thermometer drift, Vapona sensor offline…).
 *
 * Distinct from `AppNotification`: this is the incubation-domain alert history
 * carried over from the original bee-incubation app (`public.alerts`), whereas
 * AppNotification is the app-wide inbox behind the bell.
 */
export interface IncubatorAlert {
  id: string
  alertType: string
  severity: NotificationSeverity
  incubatorId: string | null
  trayId: string | null
  batchId: string | null
  message: string
  /** ISO UTC. */
  triggeredAt: string
  acknowledged: boolean
  /** ISO UTC when acknowledged, or null. */
  acknowledgedAt: string | null
  notified: boolean
}

export interface AppNotification {
  id: string
  category: string
  type: string
  severity: NotificationSeverity
  title: string
  body: string
  source: string
  /** ISO UTC. */
  createdAt: string
  /** ISO UTC when read, or null if unread. */
  readAt: string | null
}

/**
 * One tray examined during an incubator inspection: where it was pulled from,
 * how many cells were opened, and the developmental stage seen inside.
 * Belongs to a parent `Inspection` via `inspectionId`.
 */
export interface TrayInspection {
  id: string
  inspectionId: string | null
  trayId: string | null
  /** Denormalised on the row, so a reading survives a missing tray link. */
  trayNumber: string | null
  incubatorId: string | null
  /** ISO UTC. */
  at: string | null
  /** Top | Middle | Bottom. */
  stackPosition: string | null
  /** Front | Middle | Back. */
  depthPosition: string | null
  cellsOpened: number | null
  /** One of DEV_STAGES — the label is the stored value. */
  devStage: string | null
  notes: string
}

export type SensorSource = 'govee' | 'esp32'

export interface SensorReading {
  id: string
  incubatorId: string
  /** ISO UTC. */
  at: string
  tempC: number
  humidityPct: number
  source: SensorSource
}
