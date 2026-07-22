import type { Field, Incubator, Inspection, SensorReading } from './types'

/** Deterministic demo data for mock mode. No Date.now() so it's stable/testable. */

export const seedFields: Field[] = [
  { id: 'f1', name: 'Grassy Lake NW Pivot', client: 'Corteva', region: 'Grassy Lake, AB', shapeType: 'pivot', shelterCount: 24, updatedAt: '2026-07-18T15:00:00Z' },
  { id: 'f2', name: 'Bow Island Quarter', client: 'Corteva', region: 'Bow Island, AB', shapeType: 'polygon', shelterCount: 16, updatedAt: '2026-07-19T18:30:00Z' },
  { id: 'f3', name: 'Taber South Pivot', client: 'Corteva', region: 'Taber, AB', shapeType: 'pivot', shelterCount: 30, updatedAt: '2026-07-20T13:10:00Z' },
]

export const seedIncubators: Incubator[] = [
  { id: 'i1', name: 'Incubator A', location: 'Shop — north wall', status: 'active', startedAt: '2026-07-10T06:00:00Z', tempTargetC: 30, humidityTargetPct: 55 },
  { id: 'i2', name: 'Incubator B', location: 'Shop — south wall', status: 'active', startedAt: '2026-07-14T06:00:00Z', tempTargetC: 30, humidityTargetPct: 55 },
  { id: 'i3', name: 'Incubator C', location: 'Trailer', status: 'idle', startedAt: null, tempTargetC: 30, humidityTargetPct: 55 },
]

export const seedInspections: Inspection[] = [
  { id: 'in1', incubatorId: 'i1', at: '2026-07-20T16:00:00Z', inspector: 'Tyler', healthScore: 92, notes: 'Emergence starting, looks strong.' },
  { id: 'in2', incubatorId: 'i2', at: '2026-07-21T16:00:00Z', inspector: 'Tyler', healthScore: 88, notes: 'On track. Humidity a touch low.' },
]

export const seedReadings: SensorReading[] = [
  { id: 'r1', incubatorId: 'i1', at: '2026-07-22T12:00:00Z', tempC: 30.1, humidityPct: 54, source: 'govee' },
  { id: 'r2', incubatorId: 'i1', at: '2026-07-22T13:00:00Z', tempC: 30.3, humidityPct: 53, source: 'govee' },
  { id: 'r3', incubatorId: 'i2', at: '2026-07-22T13:00:00Z', tempC: 29.6, humidityPct: 49, source: 'esp32' },
]
