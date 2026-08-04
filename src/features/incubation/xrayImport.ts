import type { Sample } from '@/data/types'

/**
 * X-ray spreadsheet import — the field sample sheet that carries the grading
 * figures (weights, live bees, parasites, and the per-tray "Kg for 2 gal").
 *
 * Ported from the desktop app's `_parse_xray_spreadsheet`, including its header
 * map and lenient parsing, so the SAME sheet imports into both apps. Rows match
 * an existing sample BY NAME and update it (keeping tray links); an unknown
 * name creates a sample.
 *
 * CSV only for now — the desktop app also reads .xlsx via openpyxl. Save the
 * sheet as CSV, or ask for xlsx support.
 */

export type SamplePatch = Partial<Omit<Sample, 'id'>> & { name: string }

/** Spreadsheet header (normalised) → sample field. Mirrors _SAMPLE_HEADER_MAP. */
const HEADER_MAP: Record<string, keyof Sample> = {
  'sample name': 'name',
  'total pounds': 'totalWeightLbs',
  'total kgs': 'totalWeightKg',
  'live bees per pound': 'liveBeesPerLb',
  parasites: 'parasites',
  chalkbrood: 'chalkbrood',
  'total gal bees': 'totalVolumeGal',
  'live bees per kg': 'liveBeesPerKg',
  'total kg for 2gal': 'kgPer2Gal',
  'total lbs for 2gal': 'lbsPer2Gal',
  'total trays': 'totalTrays',
  'expected trays': 'totalTrays',
  'incubator space': 'incubatorSpace',
  notes: 'notes',
}

const TEXT_FIELDS = new Set<keyof Sample>(['name', 'incubatorSpace', 'notes'])

/** Lowercase, drop '?', collapse whitespace — matches the desktop's _norm. */
export function normalizeHeader(h: string): string {
  return String(h ?? '')
    .trim()
    .toLowerCase()
    .replace(/\?/g, '')
    .split(/\s+/)
    .join(' ')
}

/** Tolerant number parse: strips commas, %, $; blank → null. Matches _num. */
export function parseNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const s = String(v).replace(/[,%$]/g, '').trim()
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/**
 * Split CSV text into rows of cells, honouring quoted fields (which can contain
 * commas and newlines) and doubled quotes as an escaped quote.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  // Strip a UTF-8 BOM — Excel writes one, and it would corrupt the first header.
  const s = text.replace(/^﻿/, '')

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
    } else if (c === ',') {
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

export interface XrayImportResult {
  /** One patch per usable row, keyed for matching by name. */
  samples: SamplePatch[]
  /** Headers that matched nothing — surfaced so a renamed column isn't silent. */
  ignoredHeaders: string[]
  /** Rows skipped because they had no sample name. */
  skipped: number
}

/** Parse an x-ray sheet's CSV text into sample patches. */
export function parseXraySheet(csvText: string): XrayImportResult {
  const rows = parseCsv(csvText)
  if (rows.length < 2) return { samples: [], ignoredHeaders: [], skipped: 0 }

  const headers = rows[0].map(normalizeHeader)
  const ignoredHeaders = headers.filter((h) => h !== '' && !HEADER_MAP[h])

  const samples: SamplePatch[] = []
  let skipped = 0

  for (const raw of rows.slice(1)) {
    const patch: Record<string, unknown> = {}
    headers.forEach((h, i) => {
      const field = HEADER_MAP[h]
      if (!field) return
      const value = raw[i]
      patch[field] = TEXT_FIELDS.has(field)
        ? value == null
          ? null
          : String(value).trim()
        : parseNumber(value)
    })

    const name = typeof patch.name === 'string' ? patch.name.trim() : ''
    if (!name) {
      skipped++
      continue
    }
    patch.name = name
    samples.push(patch as SamplePatch)
  }

  return { samples, ignoredHeaders, skipped }
}
