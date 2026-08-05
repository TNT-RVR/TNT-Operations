/**
 * Parse an uploaded season spreadsheet row into a `field_analysis` record.
 *
 * The browser-side twin of `scripts/import_field_analysis.py`, for the Upload
 * screen. Same cleaning rules, deliberately — a row imported through the UI and
 * the same row imported through the script must land identically, or the
 * numbers on screen depend on how the data got in.
 *
 * The header map is forgiving, in the same spirit as `importPaths.ts`'s CSV
 * reader: the sheet is maintained by hand across seasons and its headers drift
 * ('Field ID#' vs 'Field ID', 'Long' vs 'Lng', stray spaces). Matching is done
 * on a normalised form rather than exactly, and an unrecognised column is
 * ignored rather than guessed at.
 */

import type { FieldAnalysis } from '@/data/types'

/** Column → the spreadsheet headers that have meant it. First match wins. */
const HEADER_ALIASES: Record<string, string[]> = {
  field_name: ['field name', 'field'],
  year: ['year'],
  company: ['company'],
  crop: ['crop'],
  field_id: ['field id#', 'field id', 'field number'],
  variety_code: ['variety code', 'variety'],
  farmer_name: ['farmer name', 'farmer', 'grower'],
  acres: ['acres'],
  lat: ['lat', 'latitude'],
  lng: ['long', 'lng', 'longitude'],
  planting_pattern: ['planting pattern', 'pattern'],
  male_row_spacing: ['male row spacing (in)', 'male row spacing'],
  female_row_spacing: ['female row spacing (in)', 'female row spacing'],
  male_rows: ['male rows'],
  female_rows: ['female rows'],
  shelters_per_acre: ['shelters/acre', 'shelters per acre'],
  num_structures: ['# of structures', 'num structures', 'structures', 'shelters'],
  blocks_per_shelter: ['blocks per shelter', 'blocks/shelter'],
  sprayer_width: ['sprayer width (ft)', 'sprayer width'],
  seeding_angle: ['seeding angle'],
  gallons_put_out: ['gallons put out', 'gallons out'],
  gallons_returned: ['gallons returned'],
  gals_per_acre: ['gals per acre', 'gallons per acre'],
  pounds: ['pounds', 'lbs'],
  percent_return: ['percent return', '% return'],
  live_count: ['live count'],
  live_prepupae: ['live prepupae'],
  immature_larvae: ['immature larvae'],
  dead_prepupae: ['dead prepupae'],
  dead_larvae: ['dead larvae'],
  pollen_balls: ['pollen balls'],
  second_generation: ['2nd generation', 'second generation'],
  predators_and_pests: ['predators and pests', 'predators/pests'],
  parasites: ['parasites'],
  chalkbrood_sporulating: ['chalkbrood sporulating'],
  chalkbrood_non_sporulating: ['chalkbrood non-sporulating', 'chalkbrood non sporulating'],
  machine_damage: ['machine damage'],
  sex_ratio_test_viability: ['sex ratio test viability', 'viability'],
  percent_female: ['% female', 'percent female'],
  percent_male: ['% male', 'percent male'],
  seeding_date: ['seeding date'],
  predicted_flower_date: ['predicted flower date'],
  actual_bee_release: ['actual bee release'],
  bees_brought_back_in: ['bees brought back in'],
  clean_weight_yield: ['clean weight yield (kgs)', 'clean weight yield'],
  yield_per_acre: ['yield per acre'],
  avg_for_variety: ['avg. for variety', 'avg for variety'],
  hail_damage: ['hail damage'],
  bad_recording: ['bad recording'],
  experimental: ['experimental'],
  notes: ['notes'],
}

const NUMERIC_COLS = new Set([
  'acres', 'lat', 'lng', 'male_row_spacing', 'female_row_spacing', 'male_rows',
  'female_rows', 'shelters_per_acre', 'num_structures', 'blocks_per_shelter',
  'sprayer_width', 'seeding_angle', 'gallons_put_out', 'gallons_returned',
  'gals_per_acre', 'pounds', 'percent_return', 'live_count', 'live_prepupae',
  'immature_larvae', 'dead_prepupae', 'dead_larvae', 'pollen_balls',
  'second_generation', 'predators_and_pests', 'parasites',
  'chalkbrood_sporulating', 'chalkbrood_non_sporulating', 'machine_damage',
  'sex_ratio_test_viability', 'percent_female', 'percent_male',
  'clean_weight_yield', 'yield_per_acre', 'avg_for_variety',
])

const DATE_COLS = new Set([
  'seeding_date', 'predicted_flower_date', 'actual_bee_release', 'bees_brought_back_in',
])

const BOOL_COLS = new Set(['hail_damage', 'bad_recording', 'experimental'])

/** Lower-cased, punctuation-light form used for header matching. */
function normaliseHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Strip a cell to its meaningful content.
 *
 * Excel prefixes text-formatted cells with an apostrophe and the Base44 export
 * carries it through, so the sheet's missing-value marker arrives as "'-" in
 * 13 columns rather than "-".
 */
export function cleanCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v).trim().replace(/^'/, '').trim()
}

export function isBlankCell(v: unknown): boolean {
  const s = cleanCell(v).toLowerCase()
  return s === '' || s === '-' || s === 'n/a'
}

/** Parse a spreadsheet number. Null for blanks — never 0. */
export function parseNumberCell(v: unknown): number | null {
  if (isBlankCell(v)) return null
  const n = parseFloat(cleanCell(v).replace(/,/g, '').replace(/\$/g, '').replace(/%$/, ''))
  return Number.isFinite(n) ? n : null
}

/** Parse the sheet's US M/D/YYYY dates to ISO. Null when unparseable. */
export function parseDateCell(v: unknown): string | null {
  if (isBlankCell(v)) return null
  const s = cleanCell(v)
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (iso) return s
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s)
  if (!us) return null
  const [, mo, day, yr] = us
  const year = yr.length === 2 ? `20${yr}` : yr
  const m = Number(mo)
  const d = Number(day)
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function parseBoolCell(v: unknown): boolean {
  if (isBlankCell(v)) return false
  return ['true', '1', 'yes', 'y'].includes(cleanCell(v).toLowerCase())
}

/**
 * Map a raw row (header → cell) onto analysis columns.
 *
 * Returns null when the row has no field name or no year — those two identify
 * the record, and a row without them cannot be upserted or filtered. The
 * caller counts it as skipped rather than importing a nameless season.
 */
export function parseAnalysisCsvRow(
  raw: Record<string, unknown>,
): (Partial<FieldAnalysis> & { field_name: string; year: string }) | null {
  // Index the row's own headers once, normalised.
  const byHeader = new Map<string, unknown>()
  for (const [k, v] of Object.entries(raw)) byHeader.set(normaliseHeader(k), v)

  const pick = (col: string): unknown => {
    // An export that already uses column names (a re-import of our own CSV)
    // matches directly; a hand-maintained sheet matches on an alias.
    if (byHeader.has(col)) return byHeader.get(col)
    for (const alias of HEADER_ALIASES[col] ?? []) {
      if (byHeader.has(alias)) return byHeader.get(alias)
    }
    return undefined
  }

  const fieldName = cleanCell(pick('field_name'))
  const year = cleanCell(pick('year'))
  if (!fieldName || !year) return null

  const out: Record<string, unknown> = { field_name: fieldName, year }

  for (const col of Object.keys(HEADER_ALIASES)) {
    if (col === 'field_name' || col === 'year') continue
    const cell = pick(col)
    if (cell === undefined) continue
    if (NUMERIC_COLS.has(col)) out[col] = parseNumberCell(cell)
    else if (DATE_COLS.has(col)) out[col] = parseDateCell(cell)
    else if (BOOL_COLS.has(col)) out[col] = parseBoolCell(cell)
    else out[col] = isBlankCell(cell) ? '' : cleanCell(cell)
  }

  return out as Partial<FieldAnalysis> & { field_name: string; year: string }
}

/**
 * Parse a coordinate pair the way someone actually supplies one.
 *
 * People fixing a missing coordinate get it from Google Maps or a handheld, so
 * this accepts what those produce: "49.8635, -111.963", tab- or space-separated,
 * a degree sign, and the `49.83°N, 111.96°W` hemisphere form the crew's scan
 * CSVs already use (see importPaths.ts, which is forgiving for the same reason).
 *
 * Returns null rather than a guess when it cannot read the input — a silently
 * mis-parsed coordinate puts a field in the wrong province and quietly pollutes
 * every weather correlation it touches.
 */
export function parseCoordinatePair(input: string): { lat: number; lng: number } | null {
  const s = input.trim()
  if (!s) return null

  // Pull out signed decimals, keeping any N/S/E/W that immediately follows.
  const parts = [...s.matchAll(/(-?\d+(?:\.\d+)?)\s*°?\s*([NSEW])?/gi)]
  if (parts.length < 2) return null

  const read = (m: RegExpMatchArray): { value: number; hemi: string | null } => ({
    value: parseFloat(m[1]),
    hemi: m[2] ? m[2].toUpperCase() : null,
  })

  const a = read(parts[0])
  const b = read(parts[1])
  if (!Number.isFinite(a.value) || !Number.isFinite(b.value)) return null

  // Hemisphere letters win over sign — "111.96°W" means -111.96 however it was
  // typed. Where they're absent, the first number is latitude.
  let lat = a.hemi === 'S' ? -Math.abs(a.value) : a.hemi === 'N' ? Math.abs(a.value) : a.value
  let lng = b.hemi === 'W' ? -Math.abs(b.value) : b.hemi === 'E' ? Math.abs(b.value) : b.value

  // Explicitly reversed input ("111.96W, 49.86N") is unambiguous — accept it.
  if ((a.hemi === 'E' || a.hemi === 'W') && (b.hemi === 'N' || b.hemi === 'S')) {
    const swapLat = b.hemi === 'S' ? -Math.abs(b.value) : Math.abs(b.value)
    const swapLng = a.hemi === 'W' ? -Math.abs(a.value) : Math.abs(a.value)
    lat = swapLat
    lng = swapLng
  }

  if (!isValidLat(lat) || !isValidLng(lng)) return null
  return { lat, lng }
}

export function isValidLat(lat: number): boolean {
  return Number.isFinite(lat) && lat >= -90 && lat <= 90
}

export function isValidLng(lng: number): boolean {
  return Number.isFinite(lng) && lng >= -180 && lng <= 180
}

/**
 * The operation runs in southern Alberta. A coordinate outside this box is
 * valid on Earth but almost certainly a typo or a swapped pair — worth warning
 * about, never worth rejecting, since the business could take work elsewhere.
 */
export const ALBERTA_BOX = { minLat: 48.9, maxLat: 60.1, minLng: -120.1, maxLng: -109.9 }

export function looksLikeAlberta(lat: number, lng: number): boolean {
  return (
    lat >= ALBERTA_BOX.minLat &&
    lat <= ALBERTA_BOX.maxLat &&
    lng >= ALBERTA_BOX.minLng &&
    lng <= ALBERTA_BOX.maxLng
  )
}

/** Percent columns, checked against the migration's 0–100 CHECK before upload. */
const PERCENT_COLS = [
  'live_prepupae', 'immature_larvae', 'dead_prepupae', 'dead_larvae',
  'pollen_balls', 'second_generation', 'predators_and_pests', 'parasites',
  'chalkbrood_sporulating', 'chalkbrood_non_sporulating', 'machine_damage',
  'sex_ratio_test_viability', 'percent_female', 'percent_male', 'percent_return',
]

/**
 * Problems worth showing the user before anything is written.
 *
 * The database CHECK would reject an out-of-range percentage anyway, but a
 * failed transaction after a 157-row upload is a worse experience than a list
 * of the four rows that need fixing.
 */
export function validateAnalysisRows(
  rows: ReadonlyArray<Partial<FieldAnalysis> & { field_name: string; year: string }>,
): string[] {
  const problems: string[] = []
  const seen = new Set<string>()

  for (const row of rows) {
    const label = `${row.field_name} (${row.year})`
    const key = `${row.field_name}|${row.year}`
    if (seen.has(key)) {
      problems.push(`${label}: appears more than once — only the last will be kept.`)
    }
    seen.add(key)

    for (const col of PERCENT_COLS) {
      const v = row[col as keyof FieldAnalysis] as number | null | undefined
      if (typeof v === 'number' && (v < 0 || v > 100)) {
        problems.push(`${label}: ${col} is ${v}, outside 0–100.`)
      }
    }
  }
  return problems
}
