/** Shared domain types for TNT Operations. Backend-agnostic. */

export type ShapeType = 'pivot' | 'polygon'

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
