import type { Field, Incubator, IncubationBatch, IncubatorAlert, Inspection, TrayInspection, Sample, SensorReading, Tray, AppNotification, Grant, Block, BlockPlacement, FieldAnalysis } from './types'

/** Deterministic demo data for mock mode. No Date.now() so it's stable/testable. */

// Southern-Alberta demo location for the polygon field's boundary.
const BOW_LAT = 49.86
const BOW_LON = -111.52
const BOW_DLAT = 0.0036 // ~ ±400 m
const BOW_DLON = 0.0056

/**
 * Real field boundaries, when someone has pulled them down locally.
 *
 * `scripts/fetch_local_fields.py` writes src/data/localFields.json from the
 * live database; that file is git-excluded because it holds real client names
 * and coordinates. When it is absent — the normal case, and always in CI —
 * this resolves to nothing and only the demo fields are used.
 *
 * Loaded via import.meta.glob precisely BECAUSE it may not exist: a plain
 * import of a missing module fails the build.
 */
const localFieldModules = import.meta.glob<{ default: Field[] }>('./localFields.json', { eager: true })
const localFields: Field[] = Object.values(localFieldModules)[0]?.default ?? []

/** The two demo fields. Kept alongside any real ones, because the seeded
 *  blocks below are placed in them — dropping them would orphan that data. */
const demoFields: Field[] = [
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
      // Stamps the demo fields as this season so the dashboard's field map
      // has something to draw in mock mode, the way real imported fields do.
      year: '2026',
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
      // Stamps the demo fields as this season so the dashboard's field map
      // has something to draw in mock mode, the way real imported fields do.
      year: '2026',
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

/**
 * Demo fields first so the seeded blocks (placed in f1/f2) still resolve, then
 * any real boundaries pulled down locally.
 */
export const seedFields: Field[] = [...demoFields, ...localFields]

export const seedIncubators: Incubator[] = [
  { id: 'i1', name: 'Incubator A', location: 'Shop — north wall', status: 'active', startedAt: '2026-07-10T06:00:00Z', tempTargetC: 30, humidityTargetPct: 55, tempMode: 'incubation', humidityMin: 55, humidityMax: 75, incubationStart: '2026-07-10', goveeLinked: true, sensorOnline: true, sensorCheckedAt: '2026-08-14T11:50:00Z', sensorSeenAt: '2026-08-14T11:50:00Z', sensiboDeviceId: 'MOCKPOD1' },
  { id: 'i2', name: 'Incubator B', location: 'Shop — south wall', status: 'active', startedAt: '2026-07-14T06:00:00Z', tempTargetC: 30, humidityTargetPct: 55, tempMode: 'incubation', humidityMin: 55, humidityMax: 75, incubationStart: '2026-07-14', goveeLinked: true, sensorOnline: false, sensorCheckedAt: '2026-08-14T11:50:00Z', sensorSeenAt: '2026-08-13T09:00:00Z' },
  { id: 'i3', name: 'Incubator C', location: 'Trailer', status: 'idle', startedAt: null, tempTargetC: 30, humidityTargetPct: 55, tempMode: 'off', humidityMin: 55, humidityMax: 75, incubationStart: null, goveeLinked: true, sensorOnline: null },
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
  fieldId: null, harvestSeason: null,
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
// Positions matter here: these drive the interpolated returns map, so each
// block sits inside ITS OWN field. Grassy Lake (f1) is a 400 m pivot centred on
// (49.83, -111.6); Bow Island (f2) is an ~800 m square around (49.86, -111.52).

export const seedBlocks: Block[] = [
  { id: 'blk1', label: 'BLK0101', notes: '', createdAt: '2026-05-01T12:00:00Z' },
  { id: 'blk2', label: 'BLK0102', notes: '', createdAt: '2026-05-01T12:00:00Z' },
  { id: 'blk3', label: 'BLK0103', notes: '', createdAt: '2026-05-01T12:00:00Z' },
  { id: 'blk4', label: 'BLK0104', notes: '', createdAt: '2026-05-01T12:00:00Z' },
  { id: 'blk5', label: 'BLK0105', notes: '', createdAt: '2026-05-01T12:00:00Z' },
  { id: 'blk6', label: 'BLK0106', notes: '', createdAt: '2025-05-01T12:00:00Z' },
  { id: 'blk7', label: 'BLK0107', notes: '', createdAt: '2026-05-01T12:00:00Z' },
  { id: 'blk8', label: 'BLK0108', notes: '', createdAt: '2026-05-01T12:00:00Z' },
  { id: 'blk9', label: 'BLK0109', notes: '', createdAt: '2026-05-01T12:00:00Z' },
]

const placement = (over: Partial<BlockPlacement> & { id: string; blockId: string }): BlockPlacement => ({
  season: 2026,
  fieldId: 'f1',
  shelterId: null,
  lat: 49.83,
  lng: -111.6,
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

/** Weighed block: full and empty, so it yields a bee return. */
const weighed = (
  id: string,
  blockId: string,
  lat: number,
  lng: number,
  gross: number,
  stripped: number,
  over: Partial<BlockPlacement> = {},
): BlockPlacement =>
  placement({
    id,
    blockId,
    lat,
    lng,
    retrievedAt: '2026-07-28T15:00:00Z',
    grossWeightLbs: gross,
    retrievedBy: 'demo',
    strippedAt: '2026-08-01T15:00:00Z',
    strippedWeightLbs: stripped,
    strippedBy: 'demo',
    ...over,
  })

export const seedBlockPlacements: BlockPlacement[] = [
  // Grassy Lake pivot — six weighed blocks spread across the circle, with the
  // north-west side deliberately stronger so the map shows a real gradient
  // rather than uniform colour.
  weighed('bp1', 'blk1', 49.8318, -111.6032, 12.6, 4.5), // NW  8.1
  weighed('bp2', 'blk2', 49.8312, -111.5968, 11.9, 4.5), // NE  7.4
  weighed('bp3', 'blk3', 49.8300, -111.6041, 11.2, 4.5), // W   6.7
  weighed('bp7', 'blk7', 49.8299, -111.5960, 9.1, 4.5), //  E   4.6
  weighed('bp8', 'blk8', 49.8283, -111.6028, 8.4, 4.5), //  SW  3.9
  weighed('bp9', 'blk9', 49.8281, -111.5972, 7.6, 4.5), //  SE  3.1

  // Bow Island square — two blocks still out in the field, so the Register
  // shows the "in field" stage and this field has no map yet.
  placement({ id: 'bp4', blockId: 'blk4', fieldId: 'f2', lat: 49.862, lng: -111.524 }),
  placement({ id: 'bp5', blockId: 'blk5', fieldId: 'f2', lat: 49.8585, lng: -111.516 }),

  // Last season's run of a block that is out again this year — proves the
  // history survives reuse.
  placement({
    id: 'bp6', blockId: 'blk6', season: 2025, lat: 49.8305, lng: -111.6001,
    placedAt: '2025-06-03T14:00:00Z',
    retrievedAt: '2025-07-29T15:00:00Z', grossWeightLbs: 10.4, retrievedBy: 'demo',
    strippedAt: '2025-08-02T15:00:00Z', strippedWeightLbs: 4.4, strippedBy: 'demo',
  }),
]

// ── Season analysis (mock mode) ──────────────────────────────────────────────
// Fourteen synthetic field-seasons across three years. Synthetic rather than a
// slice of the real export: mock mode is what `npm run dev` runs on with no
// backend, and a committed seed file is the wrong home for real grower names,
// coordinates and yields.
//
// The numbers carry deliberate scatter. An earlier draft made every metric a
// clean function of one underlying "quality", which produced r = 1.000 between
// unrelated columns — the one thing demo data must not do is make the screening
// UI look broken. Here return tracks live prepupae loosely (the real lead is
// r = +0.582 over 122 field-seasons), live count is driven mostly by field
// size, and field size is deliberately NOT aligned with quality.
//
// Two further properties are load-bearing for the screens:
//   • the 11 grading percentages sum to 100 on every row, so the compositional
//     warning in analysisRelations.ts actually fires,
//   • yield is present on only 3 of 14 rows, mirroring the real sparsity that
//     makes every yield correlation fragile.

const analysisRow = (
  over: Partial<FieldAnalysis> & { id: string; field_name: string; year: string },
): FieldAnalysis => ({
  company: 'Corteva',
  crop: 'Seed Canola',
  field_id: '',
  variety_code: '',
  farmer_name: 'Demo Grower',
  shelter_field_id: null,
  acres: 65,
  lat: 49.86,
  lng: -111.96,
  planting_pattern: 'Row',
  male_row_spacing: 22,
  female_row_spacing: 22,
  male_rows: 2,
  female_rows: 8,
  shelters_per_acre: 2,
  num_structures: 130,
  blocks_per_shelter: 3,
  sprayer_width: 120,
  seeding_angle: 0,
  gallons_put_out: 219,
  gallons_returned: 76,
  gals_per_acre: 3,
  pounds: 199.7,
  percent_return: 35,
  live_count: 3828,
  live_prepupae: 69.5,
  immature_larvae: 0,
  dead_prepupae: 0,
  dead_larvae: 4.1,
  pollen_balls: 20.9,
  second_generation: 0,
  predators_and_pests: 0,
  parasites: 1.9,
  chalkbrood_sporulating: 0.2,
  chalkbrood_non_sporulating: 0,
  machine_damage: 3.4,
  sex_ratio_test_viability: null,
  percent_female: null,
  percent_male: null,
  seeding_date: null,
  predicted_flower_date: null,
  actual_bee_release: null,
  bees_brought_back_in: null,
  clean_weight_yield: null,
  yield_per_acre: null,
  avg_for_variety: null,
  hail_damage: false,
  bad_recording: false,
  experimental: false,
  notes: '',
  ...over,
})

export const seedFieldAnalysis: FieldAnalysis[] = [
  // 2026.
  analysisRow({ id: 'fa1', field_name: 'Bow Island NW 12-9-12', farmer_name: 'David Torrie', year: '2026', live_prepupae: 74.2, pollen_balls: 14.1, dead_larvae: 4.8, parasites: 2.1, machine_damage: 4.3, chalkbrood_sporulating: 0.5, percent_return: 41, live_count: 3280, acres: 54, gallons_put_out: 178, gallons_returned: 73, num_structures: 108, shelters_per_acre: 2, blocks_per_shelter: 3, lat: 49.874, lng: -111.938 }),
  // No coordinates — mirrors the 9 of 157 real rows the spreadsheet never had,
  // so the map's "fix missing coordinates" flow has something to work on.
  analysisRow({ id: 'fa2', field_name: 'Bow Island SE 12-9-12', farmer_name: 'David Torrie', year: '2026', live_prepupae: 71.8, pollen_balls: 18.4, dead_larvae: 3.9, parasites: 1.6, machine_damage: 3.8, chalkbrood_sporulating: 0.5, percent_return: 33, live_count: 3620, acres: 68, gallons_put_out: 225, gallons_returned: 74, num_structures: 132, shelters_per_acre: 1.9, blocks_per_shelter: 3, lat: null, lng: null }),
  analysisRow({ id: 'fa3', field_name: 'Taber W half NE 4-10-16', farmer_name: 'Marcel Boehm', year: '2026', live_prepupae: 66.0, pollen_balls: 21.7, dead_larvae: 5.6, parasites: 2.9, machine_damage: 3.4, chalkbrood_sporulating: 0.4, percent_return: 36, live_count: 3510, acres: 60, gallons_put_out: 198, gallons_returned: 71, num_structures: 118, shelters_per_acre: 2, blocks_per_shelter: 4, company: 'BASF', lat: 49.795, lng: -112.142 }),
  analysisRow({ id: 'fa4', field_name: 'Taber E half NE 4-10-16', farmer_name: 'Marcel Boehm', year: '2026', live_prepupae: 63.4, pollen_balls: 24.2, dead_larvae: 6.1, parasites: 2.4, machine_damage: 3.6, chalkbrood_sporulating: 0.3, percent_return: 28, live_count: 3910, acres: 76, gallons_put_out: 250, gallons_returned: 70, num_structures: 152, shelters_per_acre: 2, blocks_per_shelter: 4, company: 'BASF', lat: 49.798, lng: -112.128 }),
  analysisRow({ id: 'fa5', field_name: 'Grassy Lake S 22-10-13', farmer_name: 'Sandra Wiebe', year: '2026', live_prepupae: 77.1, pollen_balls: 12.5, dead_larvae: 4.2, parasites: 1.8, machine_damage: 3.9, chalkbrood_sporulating: 0.5, percent_return: 42, live_count: 4980, acres: 80, gallons_put_out: 262, gallons_returned: 110, num_structures: 168, shelters_per_acre: 2.1, blocks_per_shelter: 3, crop: 'Alfalfa', lat: 49.822, lng: -111.607 }),
  // A hailed-out season — excluded from the default view.
  analysisRow({ id: 'fa6', field_name: 'Purple Springs N 8-11-14', farmer_name: 'Ellen Redcrow', year: '2026', live_prepupae: 41.2, pollen_balls: 44.8, dead_larvae: 7.3, parasites: 3.1, machine_damage: 3.0, chalkbrood_sporulating: 0.6, percent_return: 12, live_count: 1980, acres: 65, gallons_put_out: 214, gallons_returned: 26, num_structures: 128, shelters_per_acre: 2, blocks_per_shelter: 3, hail_damage: true, notes: 'Hail 12 July, near-total loss of bloom.', lat: 49.884, lng: -112.021 }),

  // 2025 — the year yield was recorded on some fields.
  analysisRow({ id: 'fa7', field_name: 'Bow Island NW 12-9-12', farmer_name: 'David Torrie', year: '2025', live_prepupae: 72.5, pollen_balls: 16.9, dead_larvae: 5.1, parasites: 1.9, machine_damage: 3.2, chalkbrood_sporulating: 0.4, percent_return: 44, live_count: 3540, acres: 56, gallons_put_out: 184, gallons_returned: 81, num_structures: 112, shelters_per_acre: 1.9, blocks_per_shelter: 3, clean_weight_yield: 1430, yield_per_acre: 25.6, lat: 49.874, lng: -111.938 }),
  analysisRow({ id: 'fa8', field_name: 'Taber W half NE 4-10-16', farmer_name: 'Marcel Boehm', year: '2025', live_prepupae: 64.8, pollen_balls: 23.1, dead_larvae: 5.9, parasites: 2.6, machine_damage: 3.2, chalkbrood_sporulating: 0.4, percent_return: 29, live_count: 3040, acres: 60, gallons_put_out: 201, gallons_returned: 58, num_structures: 122, shelters_per_acre: 2, blocks_per_shelter: 4, company: 'BASF', clean_weight_yield: 1310, yield_per_acre: 21.8, lat: 49.795, lng: -112.142 }),
  analysisRow({ id: 'fa9', field_name: 'Grassy Lake S 22-10-13', farmer_name: 'Sandra Wiebe', year: '2025', live_prepupae: 75.9, pollen_balls: 13.8, dead_larvae: 4.6, parasites: 1.7, machine_damage: 3.6, chalkbrood_sporulating: 0.4, percent_return: 38, live_count: 4410, acres: 80, gallons_put_out: 258, gallons_returned: 98, num_structures: 160, shelters_per_acre: 2, blocks_per_shelter: 3, crop: 'Alfalfa', clean_weight_yield: 2120, yield_per_acre: 26.5, lat: 49.822, lng: -111.607 }),
  analysisRow({ id: 'fa10', field_name: 'Vauxhall E 30-12-15', farmer_name: 'Ken Dyck', year: '2025', live_prepupae: 68.7, pollen_balls: 20.0, dead_larvae: 5.3, parasites: 2.2, machine_damage: 3.4, chalkbrood_sporulating: 0.4, percent_return: 34, live_count: 3660, acres: 64, gallons_put_out: 210, gallons_returned: 71, num_structures: 126, shelters_per_acre: 2, blocks_per_shelter: 4, company: 'Northstar', lat: 50.061, lng: -112.113 }),
  // Deliberately non-standard spacing trial.
  analysisRow({ id: 'fa11', field_name: 'Vauxhall W 30-12-15', farmer_name: 'Ken Dyck', year: '2025', live_prepupae: 70.1, pollen_balls: 18.6, dead_larvae: 5.0, parasites: 2.3, machine_damage: 3.6, chalkbrood_sporulating: 0.4, percent_return: 31, live_count: 3380, acres: 66, gallons_put_out: 218, gallons_returned: 68, num_structures: 130, shelters_per_acre: 2, blocks_per_shelter: 3, male_row_spacing: 30, female_row_spacing: 30, experimental: true, company: 'Northstar', notes: 'Wide-row spacing trial.', lat: 50.058, lng: -112.131 }),

  // 2024.
  analysisRow({ id: 'fa12', field_name: 'Bow Island NW 12-9-12', farmer_name: 'David Torrie', year: '2024', live_prepupae: 70.9, pollen_balls: 18.1, dead_larvae: 5.4, parasites: 2.0, machine_damage: 3.2, chalkbrood_sporulating: 0.4, percent_return: 39, live_count: 4290, acres: 72, gallons_put_out: 244, gallons_returned: 95, num_structures: 146, shelters_per_acre: 2, blocks_per_shelter: 3, lat: 49.874, lng: -111.938 }),
  analysisRow({ id: 'fa13', field_name: 'Taber E half NE 4-10-16', farmer_name: 'Marcel Boehm', year: '2024', live_prepupae: 61.5, pollen_balls: 26.4, dead_larvae: 6.3, parasites: 2.5, machine_damage: 2.9, chalkbrood_sporulating: 0.4, percent_return: 30, live_count: 3820, acres: 74, gallons_put_out: 244, gallons_returned: 73, num_structures: 148, shelters_per_acre: 2, blocks_per_shelter: 4, company: 'BASF', lat: 49.798, lng: -112.128 }),
  analysisRow({ id: 'fa14', field_name: 'Grassy Lake S 22-10-13', farmer_name: 'Sandra Wiebe', year: '2024', live_prepupae: 76.4, pollen_balls: 13.2, dead_larvae: 4.4, parasites: 2.0, machine_damage: 3.6, chalkbrood_sporulating: 0.4, percent_return: 40, live_count: 4830, acres: 80, gallons_put_out: 266, gallons_returned: 106, num_structures: 164, shelters_per_acre: 2.1, blocks_per_shelter: 3, crop: 'Alfalfa', lat: 49.822, lng: -111.607 }),
]
