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
 * Reads .csv and .xlsx, matching the desktop app (which uses openpyxl).
 */

import { LBS_PER_KG } from '@/domain/incubation'

export type SamplePatch = Partial<Omit<Sample, 'id'>> & { name: string }

/** Kilograms from a sheet, as pounds — the unit the app stores. */
const kgToLbs = (kg: number): number => kg / LBS_PER_KG

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

/**
 * The desktop app also treats `incubator_space` as text, but the column is
 * numeric in Postgres and every live value is a fraction (0.00, 0.01, 0.11…),
 * so it's parsed as a number here.
 */
const TEXT_FIELDS = new Set<keyof Sample>(['name', 'notes'])

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
  return mapSheetRows(parseCsv(csvText))
}

/**
 * Map already-split sheet rows (header row first) onto sample patches. Shared
 * by the CSV and .xlsx paths so both honour the same headers and coercions.
 */
export function mapSheetRows(rows: unknown[][]): XrayImportResult {
  if (rows.length < 2) return { samples: [], ignoredHeaders: [], skipped: 0 }

  const headers = rows[0].map((h) => normalizeHeader(h == null ? '' : String(h)))
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

    // Kilograms are pounds times a constant, so only the pounds are kept. A
    // sheet that carries BOTH has been seen to disagree with itself — the
    // imported data had every kg 2.2x too large, multiplied where it should
    // have been divided — and storing the second copy is what let that sit
    // unnoticed. A kg-only sheet is converted rather than refused.
    // Keyed on the COLUMN existing, not the cell having a value: a sheet with
    // a kg column and a blank cell is saying "no weight for this row", which
    // has to come through as null rather than as an absent field.
    if ('totalWeightKg' in patch) {
      const kg = patch.totalWeightKg as number | null
      if (patch.totalWeightLbs == null) {
        patch.totalWeightLbs = kg == null ? null : kgToLbs(kg)
      }
      delete patch.totalWeightKg
    }

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

/**
 * Read an x-ray sheet from a picked file — .xlsx (first worksheet, like the
 * desktop app's `wb.active`) or .csv. The xlsx parser is imported lazily so its
 * weight only lands on the bundle when someone actually imports one.
 */
export async function readXrayFile(file: File): Promise<XrayImportResult> {
  const isXlsx = /\.xlsx?$/i.test(file.name) || file.type.includes('sheet') || file.type.includes('excel')
  if (!isXlsx) return parseXraySheet(await file.text())

  const { default: readXlsxFile } = await import('read-excel-file/browser')
  // Cells come back typed (numbers, Dates); mapSheetRows coerces from there.
  const rows = (await readXlsxFile(file)) as unknown as unknown[][]
  return mapSheetRows(rows)
}
