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

export interface Inspection {
  id: string
  incubatorId: string
  /** ISO UTC. */
  at: string
  inspector: string
  /** 0–100 subjective health score. */
  healthScore: number
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
