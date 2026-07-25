/** Shared domain types for TNT Operations. Backend-agnostic. */

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
