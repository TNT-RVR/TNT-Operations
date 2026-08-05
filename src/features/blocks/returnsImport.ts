/**
 * Ad-hoc import of block weights for the returns map.
 *
 * Deliberately NOT a database import. This reads a spreadsheet straight into
 * the map so a past season can be checked against a QGIS output that's already
 * trusted, without writing anything or inventing block records. Once the map is
 * believed, a real importer can persist the same rows.
 *
 * Column names vary between years and people, so headers are guessed and then
 * shown for correction rather than demanded in a fixed format.
 */
import { parseCsv, parseNumber, normalizeHeader } from '@/features/incubation/xrayImport'
import type { SamplePoint } from '@/domain/returnsMap'

export interface SheetTable {
  headers: string[]
  rows: unknown[][]
}

/** Read a picked .csv/.xlsx into a raw table. First row is treated as headers. */
export async function readSheet(file: File): Promise<SheetTable> {
  const isXlsx = /\.xlsx?$/i.test(file.name) || file.type.includes('sheet') || file.type.includes('excel')
  let rows: unknown[][]
  if (isXlsx) {
    const { default: readXlsxFile } = await import('read-excel-file/browser')
    rows = (await readXlsxFile(file)) as unknown as unknown[][]
  } else {
    rows = parseCsv(await file.text())
  }
  rows = rows.filter((r) => Array.isArray(r) && r.some((c) => String(c ?? '').trim() !== ''))
  if (rows.length === 0) return { headers: [], rows: [] }
  return { headers: rows[0].map((h) => String(h ?? '').trim()), rows: rows.slice(1) }
}

/** Candidate header names per field, in preference order. */
const GUESSES: Record<'lat' | 'lng' | 'value' | 'label', string[]> = {
  lat: ['lat', 'latitude', 'y', 'ycoord', 'ypos', 'northing'],
  lng: ['lng', 'lon', 'long', 'longitude', 'x', 'xcoord', 'xpos', 'easting'],
  value: [
    'return',
    'returnlbs',
    'beereturn',
    'beereturnlbs',
    'netlbs',
    'net',
    'yield',
    'weight',
    'weightlbs',
    'lbs',
    'value',
    'z',
  ],
  label: ['block', 'blocklabel', 'label', 'id', 'blockid', 'name', 'qr'],
}

/**
 * Best guess at which column is which.
 *
 * Exact normalised matches win over partial ones, so a sheet with both
 * `weight` and `net_weight` doesn't pick whichever happened to come first.
 * Returns -1 for anything it can't find.
 */
export function guessColumns(headers: string[]): Record<'lat' | 'lng' | 'value' | 'label', number> {
  const norm = headers.map((h) => normalizeHeader(h))
  const pick = (candidates: string[]): number => {
    for (const c of candidates) {
      const exact = norm.indexOf(c)
      if (exact >= 0) return exact
    }
    for (const c of candidates) {
      const partial = norm.findIndex((h) => h.includes(c))
      if (partial >= 0) return partial
    }
    return -1
  }
  return { lat: pick(GUESSES.lat), lng: pick(GUESSES.lng), value: pick(GUESSES.value), label: pick(GUESSES.label) }
}

export interface ImportResult {
  samples: SamplePoint[]
  /** Rows dropped, with why — surfaced so a bad import isn't silently partial. */
  skipped: number
  reasons: string[]
}

/** Plausible-on-Earth check; also catches lat/lng columns being swapped. */
const validLat = (v: number) => v >= -90 && v <= 90
const validLng = (v: number) => v >= -180 && v <= 180

/**
 * Turn the chosen columns into map samples.
 *
 * Rows missing a coordinate or a value are dropped rather than defaulted: a
 * block at 0,0 or worth 0 lbs would quietly distort the whole surface.
 */
export function toSamples(
  table: SheetTable,
  cols: Record<'lat' | 'lng' | 'value' | 'label', number>,
): ImportResult {
  const samples: SamplePoint[] = []
  const reasons: string[] = []
  let skipped = 0
  let badCoord = 0
  let badValue = 0

  for (const row of table.rows) {
    const lat = parseNumber(cols.lat >= 0 ? row[cols.lat] : null)
    const lng = parseNumber(cols.lng >= 0 ? row[cols.lng] : null)
    const value = parseNumber(cols.value >= 0 ? row[cols.value] : null)
    if (lat == null || lng == null || !validLat(lat) || !validLng(lng)) {
      skipped++
      badCoord++
      continue
    }
    if (value == null) {
      skipped++
      badValue++
      continue
    }
    const label = cols.label >= 0 ? String(row[cols.label] ?? '').trim() : undefined
    samples.push({ lat, lng, value, label: label || undefined })
  }

  if (badCoord) reasons.push(`${badCoord} row${badCoord === 1 ? '' : 's'} with a missing or impossible coordinate`)
  if (badValue) reasons.push(`${badValue} row${badValue === 1 ? '' : 's'} with no weight`)
  return { samples, skipped, reasons }
}

/**
 * Rough centre of the imported points, for jumping the map there — imported
 * data won't usually sit in whichever field happens to be selected.
 */
export function samplesCentre(samples: SamplePoint[]): { lat: number; lng: number } | null {
  if (!samples.length) return null
  let lat = 0
  let lng = 0
  for (const s of samples) {
    lat += s.lat
    lng += s.lng
  }
  return { lat: lat / samples.length, lng: lng / samples.length }
}
