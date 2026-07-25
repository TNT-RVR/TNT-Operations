import type { Field, Incubator, Inspection, SensorReading, AppNotification } from './types'

/** Deterministic demo data for mock mode. No Date.now() so it's stable/testable. */

// Southern-Alberta demo location for the polygon field's boundary.
const BOW_LAT = 49.86
const BOW_LON = -111.52
const BOW_DLAT = 0.0036 // ~ ±400 m
const BOW_DLON = 0.0056

export const seedFields: Field[] = [
  {
    id: 'f1',
    name: 'Grassy Lake NW Pivot',
    client: 'Demo Seed Co.',
    region: 'Grassy Lake, AB',
    shapeType: 'pivot',
    shelterCount: 24,
    updatedAt: '2026-07-18T15:00:00Z',
    // 400 m radius centre-pivot, 8F/2M bays, 24 shelters. Synthetic demo geometry.
    geometry: {
      PP_Longitude: '-111.6',
      PP_Latitude: '49.83',
      Radius: '400',
      Sprayer_width: '120',
      num_female_rows: '8',
      num_male_rows: '2',
      row_spacing_in: '22',
      total_rows: '10',
      row_layout: 'centered',
      custom_row_mask: '',
      use_bays: true,
      shelter_mode: 'total',
      num_structures: '24',
      Planting_angle: '0',
      shelters_in_outside_pass: 'Yes',
      pivot_tracks: [],
      track_exclusion_ft: '10',
      pass_edge_buffer_ft: '25',
    },
  },
  {
    id: 'f2',
    name: 'Bow Island Quarter',
    client: 'Demo Seed Co.',
    region: 'Bow Island, AB',
    shapeType: 'polygon',
    shelterCount: 16,
    updatedAt: '2026-07-19T18:30:00Z',
    // ~800 m square boundary, green-compliant (no shelters in the outside pass).
    geometry: {
      PP_Longitude: String(BOW_LON),
      PP_Latitude: String(BOW_LAT),
      boundary_polygon: [
        [BOW_LAT - BOW_DLAT, BOW_LON - BOW_DLON],
        [BOW_LAT - BOW_DLAT, BOW_LON + BOW_DLON],
        [BOW_LAT + BOW_DLAT, BOW_LON + BOW_DLON],
        [BOW_LAT + BOW_DLAT, BOW_LON - BOW_DLON],
      ],
      Sprayer_width: '120',
      num_female_rows: '8',
      num_male_rows: '2',
      row_spacing_in: '22',
      total_rows: '10',
      row_layout: 'centered',
      custom_row_mask: '',
      use_bays: true,
      shelter_mode: 'total',
      num_structures: '16',
      Planting_angle: '0',
      shelters_in_outside_pass: 'No',
      pivot_tracks: [],
      track_exclusion_ft: '10',
      pass_edge_buffer_ft: '25',
    },
  },
  // Summary-only field (no geometry yet) — the map shows an "import needed" state.
  { id: 'f3', name: 'Taber South Pivot', client: 'Demo Seed Co.', region: 'Taber, AB', shapeType: 'pivot', shelterCount: 30, updatedAt: '2026-07-20T13:10:00Z' },
]

export const seedIncubators: Incubator[] = [
  { id: 'i1', name: 'Incubator A', location: 'Shop — north wall', status: 'active', startedAt: '2026-07-10T06:00:00Z', tempTargetC: 30, humidityTargetPct: 55, tempMode: 'incubation', humidityMin: 55, humidityMax: 75, incubationStart: '2026-07-10' },
  { id: 'i2', name: 'Incubator B', location: 'Shop — south wall', status: 'active', startedAt: '2026-07-14T06:00:00Z', tempTargetC: 30, humidityTargetPct: 55, tempMode: 'incubation', humidityMin: 55, humidityMax: 75, incubationStart: '2026-07-14' },
  { id: 'i3', name: 'Incubator C', location: 'Trailer', status: 'idle', startedAt: null, tempTargetC: 30, humidityTargetPct: 55, tempMode: 'off', humidityMin: 55, humidityMax: 75, incubationStart: null },
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

export const seedNotifications: AppNotification[] = [
  {
    id: 'n1',
    category: 'integration',
    type: 'sensor_feed_stale',
    severity: 'critical',
    title: 'Govee feed has gone quiet',
    body: 'No new sensor reading in 22 minutes — the cloud poller may have stalled.',
    source: 'govee_poller',
    createdAt: '2026-07-24T15:40:00Z',
    readAt: null,
  },
  {
    id: 'n2',
    category: 'incubation',
    type: 'temp_out_of_range',
    severity: 'warning',
    title: 'Incubator B above target',
    body: 'Latest temperature 34.8°C is outside the incubation band (25–35°C).',
    source: 'incubation',
    createdAt: '2026-07-24T14:05:00Z',
    readAt: null,
  },
  {
    id: 'n3',
    category: 'system',
    type: 'welcome',
    severity: 'info',
    title: 'Welcome to TNT Operations',
    body: 'Alerts about your integrations and incubators will show up here.',
    source: 'system',
    createdAt: '2026-07-23T09:00:00Z',
    readAt: '2026-07-23T09:05:00Z',
  },
]
