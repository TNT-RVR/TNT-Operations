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
import { parseNumber, normalizeHeader } from '@/features/incubation/xrayImport'
import type { SamplePoint } from '@/domain/returnsMap'

export interface SheetTable {
  headers: string[]
  rows: unknown[][]
  /** What the reader actually found, surfaced so a bad read is visible. */
  delimiter?: string
  sourceRows?: number
}

/**
 * Work out a delimited file's separator from its first few lines.
 *
 * Exports are not always comma-separated — Excel writes semicolons under many
 * locales and QGIS will happily emit tabs. Parsing those as commas collapses
 * everything into one column, which presents as "the file won't load".
 */
export function sniffDelimiter(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .slice(0, 5)
  if (lines.length === 0) return ','

  let best = ','
  let bestScore = -1
  for (const d of [',', ';', '\t', '|']) {
    const counts = lines.map((line) => {
      // Count only outside quotes, so commas inside a quoted field don't win.
      let n = 0
      let inQuotes = false
      for (const c of line) {
        if (c === '"') inQuotes = !inQuotes
        else if (c === d && !inQuotes) n++
      }
      return n
    })
    // A real delimiter shows up on EVERY line, at least once.
    const min = Math.min(...counts)
    if (min >= 1 && min > bestScore) {
      bestScore = min
      best = d
    }
  }
  return best
}

/** Split delimited text, honouring quoted fields and doubled quotes. */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  const s = text.replace(/^﻿/, '') // Excel writes a BOM

  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"'
          i++
        } else inQuotes = false
      } else cell += c
    } else if (c === '"') {
      inQuotes = true
    } else if (c === delimiter) {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += c
    }
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ''))
}

/** Read a picked .csv/.xlsx into a raw table. First row is treated as headers. */
export async function readSheet(file: File): Promise<SheetTable> {
  const isXlsx = /\.xlsx?$/i.test(file.name) || file.type.includes('sheet') || file.type.includes('excel')
  let rows: unknown[][]
  let delimiter: string | undefined
  if (isXlsx) {
    const { default: readXlsxFile } = await import('read-excel-file/browser')
    rows = (await readXlsxFile(file)) as unknown as unknown[][]
  } else {
    const text = await file.text()
    delimiter = sniffDelimiter(text)
    rows = parseDelimited(text, delimiter)
  }
  rows = rows.filter((r) => Array.isArray(r) && r.some((c) => String(c ?? '').trim() !== ''))
  if (rows.length === 0) return { headers: [], rows: [], delimiter, sourceRows: 0 }
  return {
    headers: rows[0].map((h) => String(h ?? '').trim()),
    rows: rows.slice(1),
    delimiter,
    sourceRows: rows.length - 1,
  }
}

/** The columns we try to identify in an imported sheet. */
export type ColKey = 'lat' | 'lng' | 'value' | 'label' | 'group'
export type ColMap = Record<ColKey, number>

/** Candidate header names per column, in preference order. */
const GUESSES: Record<ColKey, string[]> = {
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
  label: ['blocklabel', 'blockid', 'block', 'label', 'qr'],
  // The grouping column — usually the field/site a block was placed in. A
  // season's export normally covers many fields, and interpolating across all
  // of them at once produces one huge meaningless extent.
  group: ['field', 'fieldname', 'site', 'location', 'farm', 'quarter', 'grower', 'client'],
}

/**
 * Best guess at which column is which.
 *
 * Exact normalised matches win over partial ones, so a sheet with both
 * `weight` and `net_weight` doesn't pick whichever happened to come first.
 * Returns -1 for anything it can't find.
 */
export function guessColumns(headers: string[]): ColMap {
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
  return {
    lat: pick(GUESSES.lat),
    lng: pick(GUESSES.lng),
    value: pick(GUESSES.value),
    label: pick(GUESSES.label),
    group: pick(GUESSES.group),
  }
}

/**
 * Distinct values in the grouping column, with how many rows each has.
 * Sorted by name so the list is stable between loads.
 */
export function groupValues(table: SheetTable, col: number): Array<{ value: string; rows: number }> {
  if (col < 0) return []
  const counts = new Map<string, number>()
  for (const row of table.rows) {
    const v = String(row[col] ?? '').trim()
    if (!v) continue
    counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([value, rows]) => ({ value, rows }))
    .sort((a, b) => a.value.localeCompare(b.value))
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
export function toSamples(table: SheetTable, cols: ColMap, groupFilter?: string | null): ImportResult {
  const samples: SamplePoint[] = []
  const reasons: string[] = []
  let skipped = 0
  let badCoord = 0
  let badValue = 0

  for (const row of table.rows) {
    // Restrict to one field before anything else — a sheet covering several
    // fields must not be interpolated as a single surface.
    if (groupFilter != null && cols.group >= 0) {
      if (String(row[cols.group] ?? '').trim() !== groupFilter) continue
    }
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
