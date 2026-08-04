import type { Field, Incubator, IncubationBatch, IncubatorAlert, Inspection, TrayInspection, Sample, SensorReading, Tray, AppNotification, Grant, Block, BlockPlacement } from './types'

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
      // Overlay demo data: three wheel tracks, a wet zone, and site pins.
      pivot_tracks: [130, 260, 390],
      track_exclusion_ft: '10',
      pass_edge_buffer_ft: '25',
      wet_zones: [
        [
          [49.8315, -111.5945],
          [49.832, -111.5938],
          [49.8312, -111.5932],
          [49.8308, -111.594],
        ],
      ],
      parking_pin: [49.8336, -111.595],
      entrance_pin: [49.8266, -111.6],
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
  {
    id: 'in1', incubatorId: 'i1', at: '2026-07-20T16:00:00Z', inspector: 'Tyler', healthScore: 92,
    notes: 'Emergence starting, looks strong.',
    period: 'morning', thermometerTempC: 30.0, goveeTempC: 30.3, tempDiffC: 0.3, tempAlert: false,
    heatPumpsOk: true, fansOk: true, blackLightsOk: true, beesEmerging: true, parasitesEmerging: false,
  },
  {
    id: 'in2', incubatorId: 'i2', at: '2026-07-21T16:00:00Z', inspector: 'Tyler', healthScore: 88,
    notes: 'On track. Humidity a touch low.',
    period: 'evening', thermometerTempC: 29.6, goveeTempC: 29.6, tempDiffC: 0.0, tempAlert: false,
    heatPumpsOk: true, fansOk: true, blackLightsOk: true, beesEmerging: false, parasitesEmerging: false,
  },
]

/**
 * A few days of readings at the real 15-minute poll rate, so mock mode actually
 * exercises the chart (its range picker needs more than a couple of points).
 * Deterministic — a sine wiggle, not Math.random — so the mock stays stable.
 */
function seedSeries(
  incubatorId: string,
  endIso: string,
  days: number,
  targetC: number,
  /** Days of cool storage at the end of the run, as happens before release. */
  coolTailDays = 0,
): SensorReading[] {
  const stepMs = 15 * 60_000
  const n = Math.round((days * 24 * 60) / 15)
  const end = Date.parse(endIso)
  const out: SensorReading[] = []
  for (let i = 0; i < n; i++) {
    const t = end - (n - 1 - i) * stepMs
    // Slow daily swing + a faster ripple, and one dip out of band to show the band.
    const daily = Math.sin((i / 96) * Math.PI * 2) * 0.8
    const ripple = Math.sin(i / 7) * 0.25
    const excursion = i > n * 0.55 && i < n * 0.62 ? -2.6 : 0
    // The tail sits in the holding band (~14 C), so the calendar can show
    // the cooled days that slow development before release.
    const cooling = i >= n - (coolTailDays * 24 * 60) / 15 ? 14 - targetC : 0
    const tempC = Math.round((targetC + daily + ripple + excursion + cooling) * 10) / 10
    out.push({
      id: `${incubatorId}-r${i}`,
      incubatorId,
      at: new Date(t).toISOString(),
      tempC,
      humidityPct: Math.round((58 + Math.sin(i / 11) * 4) * 10) / 10,
      source: 'govee',
    })
  }
  return out
}

export const seedReadings: SensorReading[] = [
  // 35 days so the chart's 1H/6H/24H/7D/30D/ALL ranges each show something
  // different in mock mode (live mode fetches on demand via loadReadings).
  ...seedSeries('i1', '2026-07-22T13:00:00Z', 35, 30, 4),
  ...seedSeries('i2', '2026-07-22T13:00:00Z', 2, 29.5),
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

export const seedAlerts: IncubatorAlert[] = [
  {
    id: 'al1', alertType: 'temp_humidity', severity: 'warning', incubatorId: 'i2', trayId: null, batchId: null,
    message: 'Incubator B: Temp 35.4°C above maximum 35.0°C',
    triggeredAt: '2026-07-21T17:47:00Z', acknowledged: true, acknowledgedAt: '2026-07-21T18:02:00Z', notified: false,
  },
  {
    id: 'al2', alertType: 'inspection_temp', severity: 'warning', incubatorId: 'i1', trayId: null, batchId: null,
    message: 'Inspection temp alert — Incubator A: Thermometer 27.0°C vs Govee 16.0°C (Δ 11.0°C)',
    triggeredAt: '2026-07-20T10:48:00Z', acknowledged: true, acknowledgedAt: '2026-07-20T11:00:00Z', notified: false,
  },
  {
    id: 'al3', alertType: 'vapona_sensor', severity: 'warning', incubatorId: 'i2', trayId: null, batchId: null,
    message: 'Vapona sensor “Vapsens” (Incubator B) is offline — no contact for 31 min.',
    triggeredAt: '2026-07-15T14:05:00Z', acknowledged: false, acknowledgedAt: null, notified: true,
  },
]

const nullSampleStats = {
  xrayParasitePct: null, xrayDeadPct: null, totalWeightKg: null, liveBeesPerKg: null,
  parasites: null, chalkbrood: null, incubatorSpace: null, kgPer2Gal: null,
}

export const seedSamples: Sample[] = [
  {
    id: 's1', name: '26-102', source: 'King Hill', lotNumber: 'KH-26-102',
    xrayLivePct: 0.86, totalVolumeGal: 520, totalWeightLbs: 1117, liveBeesPerLb: 4475, totalTrays: 250, lbsPer2Gal: 5.66,
    notes: 'Strong lot.', importDate: '2026-06-15T00:00:00Z', ...nullSampleStats,
  },
  {
    id: 's2', name: '#4 Sanfoin', source: 'Sanfoin', lotNumber: 'SF-04',
    xrayLivePct: 0.79, totalVolumeGal: 180, totalWeightLbs: 392, liveBeesPerLb: 4100, totalTrays: 71, lbsPer2Gal: 5.12,
    notes: '', importDate: '2026-06-18T00:00:00Z', ...nullSampleStats,
  },
  {
    id: 's3', name: '#9 Phacelia', source: 'Phacelia', lotNumber: 'PH-09',
    xrayLivePct: null, totalVolumeGal: null, totalWeightLbs: null, liveBeesPerLb: null, totalTrays: null, lbsPer2Gal: null,
    notes: 'Awaiting x-ray.', importDate: '2026-06-20T00:00:00Z', ...nullSampleStats,
  },
]

let trayIdSeq = 0
const tray = (
  label: string,
  sampleId: string,
  incubatorId: string,
  outDate: string | null,
  status = 'released',
): Tray => ({
  id: `t${++trayIdSeq}`, trayNumber: label, sampleId, incubationBatchId: null, incubatorId,
  weightLbs: null, liveCount: null, parasiteLevelPct: null, volumeGal: null,
  inDate: null, outDate, coolDate: null, status, notes: '',
})

export const seedTrays: Tray[] = [
  // 2026 season
  tray('Tray0001', 's1', 'i1', '2026-07-28'),
  tray('Tray0002', 's1', 'i1', '2026-07-28'),
  tray('Tray0003', 's1', 'i2', '2026-07-29'),
  tray('Tray0004', 's2', 'i2', '2026-07-30'),
  tray('Tray0005', 's2', 'i3', '2026-07-30'),
  // 2025 season — the SAME physical labels reused with a different sample/incubator
  tray('Tray0001', 's2', 'i2', '2025-07-25'),
  tray('Tray0003', 's2', 'i3', '2025-07-26'),
]

export const seedBatches: IncubationBatch[] = [
  {
    id: 'b1', incubatorId: 'i1', sampleId: 's1', name: '26-102 · Incubator A',
    startDate: '2026-07-05', vaponaIn: '2026-07-06', vaponaOut: '2026-07-09', airOut: '2026-07-10',
    male10pctEmergence: '2026-07-24', earliestCool: '2026-07-26', estimatedRelease: '2026-07-28',
    latestRelease: '2026-07-31', status: 'active', notes: '',
  },
]

/** Demo grants so the pipeline is populated in mock mode. */
export const seedGrants: Grant[] = [
  {
    id: 'gr1',
    title: 'Sustainable CAP — On-Farm Efficiency',
    funder: 'Agriculture and Agri-Food Canada / Alberta',
    url: 'https://www.alberta.ca/sustainable-canadian-agricultural-partnership',
    status: 'reviewing',
    amountMin: 0,
    amountMax: 150000,
    eligibilitySummary: 'Alberta producers investing in equipment or practices that improve efficiency and reduce emissions.',
    summary: 'Cost-share funding for on-farm efficiency upgrades.',
    notesMd: 'Shelter trailers and incubator controls likely qualify.',
    opensOn: null,
    closesOn: '2026-09-15',
    region: 'Alberta',
    categories: ['equipment', 'sustainability'],
    assignedTo: null,
    source: 'auto',
    createdAt: '2026-07-20T15:00:00Z',
  },
  {
    id: 'gr2',
    title: 'Pollinator Health Research Fund',
    funder: 'Results Driven Agriculture Research',
    url: 'https://rdar.ca/',
    status: 'new',
    amountMin: 25000,
    amountMax: 250000,
    eligibilitySummary: 'Applied research projects improving pollinator health, survival, or management in Alberta crops.',
    summary: 'Research funding for pollinator health projects.',
    notesMd: null,
    opensOn: null,
    closesOn: '2026-08-08',
    region: 'Alberta',
    categories: ['research', 'pollination'],
    assignedTo: null,
    source: 'auto',
    createdAt: '2026-07-24T15:00:00Z',
  },
  {
    id: 'gr3',
    title: 'Canada Digital Adoption Program',
    funder: 'Innovation, Science and Economic Development Canada',
    url: 'https://ised-isde.canada.ca/',
    status: 'submitted',
    amountMin: null,
    amountMax: 15000,
    eligibilitySummary: 'Small businesses adopting digital technology; covers software and implementation planning.',
    summary: 'Grant + loan for small-business digital adoption.',
    notesMd: 'Submitted 2026-06-30. Waiting on confirmation.',
    opensOn: null,
    closesOn: null,
    region: 'Canada',
    categories: ['small business', 'technology'],
    assignedTo: null,
    source: 'manual',
    createdAt: '2026-06-30T15:00:00Z',
  },
]

export const seedTrayInspections: TrayInspection[] = [
  {
    id: 'ti1', inspectionId: 'in1', trayId: 't1', trayNumber: 'Tray0001', incubatorId: 'i1',
    at: '2026-07-20T16:00:00Z', stackPosition: 'Top', depthPosition: 'Front',
    cellsOpened: 5, devStage: 'Day 17–18 — Male emergence', notes: '',
  },
  {
    id: 'ti2', inspectionId: 'in1', trayId: 't3', trayNumber: 'Tray0003', incubatorId: 'i1',
    at: '2026-07-20T16:00:00Z', stackPosition: 'Bottom', depthPosition: 'Back',
    cellsOpened: 6, devStage: 'Day 14–15 — Male fully dark / Female darkening', notes: 'Cooler corner.',
  },
]

// ── Nesting blocks (place → retrieve → strip) ────────────────────────────────
// Six blocks across two fields, deliberately spread over the three stages so
// the screen shows a season mid-collection rather than a tidy finished one.

export const seedBlocks: Block[] = [
  { id: 'blk1', label: 'BLK0101', notes: '', createdAt: '2026-05-01T12:00:00Z' },
  { id: 'blk2', label: 'BLK0102', notes: '', createdAt: '2026-05-01T12:00:00Z' },
  { id: 'blk3', label: 'BLK0103', notes: '', createdAt: '2026-05-01T12:00:00Z' },
  { id: 'blk4', label: 'BLK0104', notes: '', createdAt: '2026-05-01T12:00:00Z' },
  { id: 'blk5', label: 'BLK0105', notes: '', createdAt: '2026-05-01T12:00:00Z' },
  { id: 'blk6', label: 'BLK0106', notes: '', createdAt: '2025-05-01T12:00:00Z' },
]

const placement = (over: Partial<BlockPlacement> & { id: string; blockId: string }): BlockPlacement => ({
  season: 2026,
  fieldId: 'f1',
  shelterId: null,
  lat: BOW_LAT,
  lng: BOW_LON,
  placedAt: '2026-06-02T14:00:00Z',
  placedBy: 'demo',
  retrievedAt: null,
  grossWeightLbs: null,
  retrievedBy: '',
  strippedAt: null,
  strippedWeightLbs: null,
  strippedBy: '',
  notes: '',
  ...over,
})

export const seedBlockPlacements: BlockPlacement[] = [
  // Fully through the cycle: 8.1 lbs and 7.4 lbs of bee material.
  placement({
    id: 'bp1', blockId: 'blk1',
    retrievedAt: '2026-07-28T15:00:00Z', grossWeightLbs: 12.6, retrievedBy: 'demo',
    strippedAt: '2026-08-01T15:00:00Z', strippedWeightLbs: 4.5, strippedBy: 'demo',
  }),
  placement({
    id: 'bp2', blockId: 'blk2', lat: BOW_LAT + 0.001,
    retrievedAt: '2026-07-28T15:20:00Z', grossWeightLbs: 11.9, retrievedBy: 'demo',
    strippedAt: '2026-08-01T15:20:00Z', strippedWeightLbs: 4.5, strippedBy: 'demo',
  }),
  // Retrieved and weighed, not yet stripped — so no return figure yet.
  placement({
    id: 'bp3', blockId: 'blk3', lat: BOW_LAT - 0.001,
    retrievedAt: '2026-07-28T15:40:00Z', grossWeightLbs: 13.2, retrievedBy: 'demo',
  }),
  // A weaker second field, still out in the field.
  placement({ id: 'bp4', blockId: 'blk4', fieldId: 'f2', lat: 49.83, lng: -111.6 }),
  placement({ id: 'bp5', blockId: 'blk5', fieldId: 'f2', lat: 49.831, lng: -111.601 }),
  // Last season's run of a block that is out again this year — proves the
  // history survives reuse.
  placement({
    id: 'bp6', blockId: 'blk6', season: 2025, placedAt: '2025-06-03T14:00:00Z',
    retrievedAt: '2025-07-29T15:00:00Z', grossWeightLbs: 10.4, retrievedBy: 'demo',
    strippedAt: '2025-08-02T15:00:00Z', strippedWeightLbs: 4.4, strippedBy: 'demo',
  }),
  placement({ id: 'bp7', blockId: 'blk6' }),
]
