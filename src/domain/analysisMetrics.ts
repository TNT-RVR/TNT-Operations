/**
 * The metric registry for the season Analysis section — the single list of
 * what can be plotted, correlated and compared.
 *
 * In the Base44 original this list existed FOUR times (Analysis.jsx's METRICS,
 * AllCorrelationsPanel's ALL_METRICS, and two partial copies in the weather
 * panels), which had already drifted: the all-pairs screen offered nine weather
 * metrics the scatter plots did not, and the scatter list carried a label the
 * matrix spelled differently. One list, one spelling.
 *
 * `group` drives the pickers; `unit` drives axis and tooltip formatting;
 * `higherIsBetter` is only a display hint (which end of a diverging scale reads
 * as good) and is deliberately left undefined where the answer is genuinely
 * "it depends" — more acres is neither good nor bad.
 */

export type MetricGroup =
  | 'grading' // x-ray composition of the returned cocoons
  | 'logistics' // bees put out and brought back
  | 'field' // the physical field and its planting layout
  | 'outcome' // what the season produced
  | 'weather' // derived from Open-Meteo, not stored on the row

export type MetricUnit = 'percent' | 'count' | 'acres' | 'gallons' | 'pounds' | 'kg' | 'inches' | 'feet' | 'degrees' | 'celsius' | 'mm' | 'kmh' | 'hours' | 'ratio'

export interface MetricDef {
  /** Column on `field_analysis`, or a derived weather key. */
  key: string
  label: string
  group: MetricGroup
  unit: MetricUnit
  /**
   * Weather metrics are computed from the cached Open-Meteo response and
   * joined on at read time — they are not columns on the row.
   */
  derived?: boolean
  /** Display hint for diverging scales. Undefined where direction is neutral. */
  higherIsBetter?: boolean
  /** Shown in the metric picker where the name alone is not self-explanatory. */
  description?: string
}

export const METRICS: readonly MetricDef[] = [
  // ── X-ray grading (percent of the sample) ────────────────────────────────
  {
    key: 'live_prepupae',
    label: 'Live Prepupae',
    group: 'grading',
    unit: 'percent',
    higherIsBetter: true,
    description: 'The healthy fraction of the returned cocoons — the headline quality number.',
  },
  { key: 'immature_larvae', label: 'Immature Larvae', group: 'grading', unit: 'percent', higherIsBetter: false },
  { key: 'dead_prepupae', label: 'Dead Prepupae', group: 'grading', unit: 'percent', higherIsBetter: false },
  { key: 'dead_larvae', label: 'Dead Larvae', group: 'grading', unit: 'percent', higherIsBetter: false },
  {
    key: 'pollen_balls',
    label: 'Pollen Balls',
    group: 'grading',
    unit: 'percent',
    higherIsBetter: false,
    description: 'Provisioned cells where the egg failed — often read as a stress signal.',
  },
  { key: 'second_generation', label: '2nd Generation', group: 'grading', unit: 'percent' },
  { key: 'predators_and_pests', label: 'Predators & Pests', group: 'grading', unit: 'percent', higherIsBetter: false },
  { key: 'parasites', label: 'Parasites', group: 'grading', unit: 'percent', higherIsBetter: false },
  { key: 'chalkbrood_sporulating', label: 'Chalkbrood (Sporulating)', group: 'grading', unit: 'percent', higherIsBetter: false },
  { key: 'chalkbrood_non_sporulating', label: 'Chalkbrood (Non-Sporulating)', group: 'grading', unit: 'percent', higherIsBetter: false },
  { key: 'machine_damage', label: 'Machine Damage', group: 'grading', unit: 'percent', higherIsBetter: false },
  { key: 'sex_ratio_test_viability', label: 'Sex Ratio Viability', group: 'grading', unit: 'percent', higherIsBetter: true },
  { key: 'percent_female', label: 'Female', group: 'grading', unit: 'percent', higherIsBetter: true },
  { key: 'percent_male', label: 'Male', group: 'grading', unit: 'percent' },

  // ── Bee logistics ────────────────────────────────────────────────────────
  {
    key: 'percent_return',
    label: 'Return',
    group: 'logistics',
    unit: 'percent',
    higherIsBetter: true,
    description: 'Gallons back over gallons out — how much of the bee stock came home.',
  },
  { key: 'live_count', label: 'Live Count', group: 'logistics', unit: 'count', higherIsBetter: true },
  { key: 'gallons_put_out', label: 'Gallons Put Out', group: 'logistics', unit: 'gallons' },
  { key: 'gallons_returned', label: 'Gallons Returned', group: 'logistics', unit: 'gallons', higherIsBetter: true },
  { key: 'gals_per_acre', label: 'Gallons per Acre', group: 'logistics', unit: 'gallons' },
  { key: 'pounds', label: 'Pounds', group: 'logistics', unit: 'pounds' },

  // ── Field & planting layout ──────────────────────────────────────────────
  { key: 'acres', label: 'Acres', group: 'field', unit: 'acres' },
  { key: 'shelters_per_acre', label: 'Shelters per Acre', group: 'field', unit: 'ratio' },
  { key: 'num_structures', label: 'Shelters', group: 'field', unit: 'count' },
  { key: 'blocks_per_shelter', label: 'Blocks per Shelter', group: 'field', unit: 'count' },
  { key: 'male_rows', label: 'Male Rows', group: 'field', unit: 'count' },
  { key: 'female_rows', label: 'Female Rows', group: 'field', unit: 'count' },
  { key: 'male_row_spacing', label: 'Male Row Spacing', group: 'field', unit: 'inches' },
  { key: 'female_row_spacing', label: 'Female Row Spacing', group: 'field', unit: 'inches' },
  { key: 'sprayer_width', label: 'Sprayer Width', group: 'field', unit: 'feet' },
  { key: 'seeding_angle', label: 'Seeding Angle', group: 'field', unit: 'degrees' },

  // ── Outcome ──────────────────────────────────────────────────────────────
  // Sparse: recorded on 33 of 157 field-seasons. Correlations against these
  // run on a fifth of the table, which is why n is always displayed.
  {
    key: 'yield_per_acre',
    label: 'Yield per Acre',
    group: 'outcome',
    unit: 'kg',
    higherIsBetter: true,
    description: 'Recorded for about a fifth of field-seasons — read alongside n.',
  },
  {
    key: 'clean_weight_yield',
    label: 'Clean Weight Yield',
    group: 'outcome',
    unit: 'kg',
    higherIsBetter: true,
    description: 'Recorded for about a fifth of field-seasons — read alongside n.',
  },
  { key: 'avg_for_variety', label: 'Variety Average', group: 'outcome', unit: 'kg' },

  // ── Weather (derived from cached Open-Meteo, Apr 1 – Sep 30) ─────────────
  { key: 'avgTemp', label: 'Average Temperature', group: 'weather', unit: 'celsius', derived: true },
  { key: 'maxTemp', label: 'Average Daily High', group: 'weather', unit: 'celsius', derived: true },
  { key: 'minTemp', label: 'Average Daily Low', group: 'weather', unit: 'celsius', derived: true },
  { key: 'totalPrecip', label: 'Total Precipitation', group: 'weather', unit: 'mm', derived: true },
  { key: 'avgWind', label: 'Average Wind Speed', group: 'weather', unit: 'kmh', derived: true },
  { key: 'growingDegreeDays', label: 'Growing Degree Days', group: 'weather', unit: 'count', derived: true, description: 'Accumulated heat above a 10 °C base over the season window.' },
  { key: 'rainDays', label: 'Rain Days', group: 'weather', unit: 'count', derived: true, description: 'Days with at least 1 mm of precipitation.' },
  {
    key: 'flightHours',
    label: 'Bee Flight Days',
    group: 'weather',
    unit: 'count',
    derived: true,
    higherIsBetter: true,
    description: 'Days warm, dry and calm enough for leafcutters to work — above 20 °C, under 1 mm rain, under 25 km/h wind.',
  },
] as const

/** Lookup by column key. */
export const METRIC_BY_KEY: Readonly<Record<string, MetricDef>> = Object.fromEntries(
  METRICS.map((m) => [m.key, m]),
)

export const METRIC_GROUP_LABELS: Readonly<Record<MetricGroup, string>> = {
  grading: 'X-Ray Grading',
  logistics: 'Bee Logistics',
  field: 'Field & Planting',
  outcome: 'Outcome',
  weather: 'Weather',
}

/** Metrics stored on the row (everything the DB can correlate without a fetch). */
export const STORED_METRICS: readonly MetricDef[] = METRICS.filter((m) => !m.derived)

/** Metrics computed from the weather cache. */
export const WEATHER_METRICS: readonly MetricDef[] = METRICS.filter((m) => m.derived)

/**
 * Which pairs a screen should test.
 *
 *  - `stored`          every pair of the recorded columns. No weather.
 *  - `weather-outcome` exactly one weather metric against one recorded column.
 */
export type PairScope = 'stored' | 'weather-outcome'

/**
 * Build the list of metric pairs for a screen.
 *
 * This is not just a display filter — it defines the FAMILY OF TESTS that the
 * Holm correction is applied over, so what goes in here changes whether a
 * result is called significant. Weather against weather is deliberately absent
 * from `weather-outcome`:
 *
 *  • It answers nothing. Average temperature against growing degree days is
 *    near-tautological — GDD is accumulated from the same daily temperatures.
 *    Rain days against total precipitation is the same measurement twice.
 *
 *  • Worse, including it makes the correction stricter for no reason. The eight
 *    weather metrics contribute 28 weather-vs-weather pairs; carrying those
 *    through Holm raises the bar every genuine weather-vs-outcome result has to
 *    clear, so a real finding can be rejected because of tests nobody cared
 *    about.
 */
export function metricPairs(scope: PairScope): Array<[MetricDef, MetricDef]> {
  const pairs: Array<[MetricDef, MetricDef]> = []

  if (scope === 'weather-outcome') {
    for (const w of WEATHER_METRICS) {
      for (const s of STORED_METRICS) pairs.push([w, s])
    }
    return pairs
  }

  for (let i = 0; i < STORED_METRICS.length; i++) {
    for (let j = i + 1; j < STORED_METRICS.length; j++) {
      pairs.push([STORED_METRICS[i], STORED_METRICS[j]])
    }
  }
  return pairs
}

/** Short unit suffix for axes and tooltips. Empty where a bare number reads better. */
export function unitSuffix(unit: MetricUnit): string {
  switch (unit) {
    case 'percent':
      return '%'
    case 'acres':
      return ' ac'
    case 'gallons':
      return ' gal'
    case 'pounds':
      return ' lb'
    case 'kg':
      return ' kg'
    case 'inches':
      return '"'
    case 'feet':
      return ' ft'
    case 'degrees':
      return '°'
    case 'celsius':
      return ' °C'
    case 'mm':
      return ' mm'
    case 'kmh':
      return ' km/h'
    case 'hours':
      return ' h'
    default:
      return ''
  }
}

/** Format a metric value for display. Null renders as an em dash, never 0. */
export function formatMetric(value: number | null | undefined, key: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const def = METRIC_BY_KEY[key]
  const unit = def?.unit ?? 'ratio'
  const decimals = unit === 'count' ? 0 : Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : 2
  return value.toFixed(decimals) + unitSuffix(unit)
}
