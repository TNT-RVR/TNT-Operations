import type { Feature, FeatureCollection, GeoJsonObject, Position } from 'geojson'

/**
 * Path + actual-pin importers for field authoring — the other half of
 * `importBoundary.ts`. Two jobs, both fed by files an operator picks off a USB
 * stick or a JD/Trimble export:
 *
 *  - **Paths** (spec §6.3 "Import Sprayer Data", §6.4 "Import Planter Data") →
 *    the `sprayer_passes` / `planter_passes` field keys: a list of polylines,
 *    each an array of stored `[lat, lon]` points (old-app convention — GeoJSON
 *    is `[lon, lat]`, so every reader here flips).
 *  - **Actual shelter pins** (spec §6.5 "Import Actual Shelter Pins (CSV)") →
 *    `actual_shelter_pins`: where the crew ACTUALLY set the shelters, so the map
 *    can show planned-vs-actual.
 *
 * Everything is deliberately tolerant: real exports arrive with a BOM, CRLF,
 * quoted fields, a junk banner row, thin polygons standing in for lines, and
 * columns in whatever order the tractor monitor felt like. Parsing NEVER throws
 * — bad rows are counted, not fatal. Only the file-level entry points throw, and
 * only with a message an operator can act on.
 *
 * The GeoJSON/CSV helpers are pure and unit-tested; the file readers use the
 * browser (DOMParser + async unzip) and dynamic-`import()` the heavy libs so
 * shpjs/jszip stay out of the main bundle.
 */

type LatLon = [number, number]

/** One imported path: an ordered run of stored `[lat, lon]` points. */
export type Path = LatLon[]

// ---------------------------------------------------------------------------
// GeoJSON → paths
// ---------------------------------------------------------------------------

/** Guard against a self-referential / pathologically nested document. */
const MAX_DEPTH = 12

/** `[lon,lat][]` position list → a stored `[lat,lon]` path, or null if too short. */
function toPath(coords: unknown): Path | null {
  if (!Array.isArray(coords)) return null
  const out: Path = []
  for (const p of coords) {
    if (!Array.isArray(p) || p.length < 2) continue
    const lat = Number((p as Position)[1])
    const lon = Number((p as Position)[0])
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    out.push([lat, lon])
  }
  return out.length >= 2 ? out : null
}

function collect(node: unknown, out: Path[], depth: number): void {
  if (!node || typeof node !== 'object' || depth > MAX_DEPTH) return
  const n = node as { type?: unknown; features?: unknown; geometry?: unknown; geometries?: unknown; coordinates?: unknown }
  switch (n.type) {
    case 'FeatureCollection':
      if (Array.isArray(n.features)) for (const f of n.features) collect(f, out, depth + 1)
      return
    case 'Feature':
      collect(n.geometry, out, depth + 1)
      return
    case 'GeometryCollection':
      if (Array.isArray(n.geometries)) for (const g of n.geometries) collect(g, out, depth + 1)
      return
    case 'LineString': {
      const line = toPath(n.coordinates)
      if (line) out.push(line)
      return
    }
    case 'MultiLineString':
      if (Array.isArray(n.coordinates)) {
        for (const part of n.coordinates) {
          const line = toPath(part)
          if (line) out.push(line)
        }
      }
      return
    // Some JD/sprayer exports ship each pass as a very thin POLYGON rather than a
    // line. Take the outer ring — it stays closed, which is what the pass drew.
    case 'Polygon': {
      const ring = Array.isArray(n.coordinates) ? toPath(n.coordinates[0]) : null
      if (ring) out.push(ring)
      return
    }
    case 'MultiPolygon':
      if (Array.isArray(n.coordinates)) {
        for (const poly of n.coordinates) {
          const ring = Array.isArray(poly) ? toPath(poly[0]) : null
          if (ring) out.push(ring)
        }
      }
      return
    default:
      return
  }
}

/**
 * Walk ANY GeoJSON (FeatureCollection / Feature / GeometryCollection / bare
 * geometry) and collect every line as a stored `[lat,lon]` path. Polygons
 * contribute their outer ring. Lines with fewer than 2 finite points are
 * dropped. Garbage in → `[]` out; never throws.
 */
export function parsePathsFromGeoJson(gj: unknown): Path[] {
  const out: Path[] = []
  try {
    collect(gj, out, 0)
  } catch {
    return out
  }
  return out
}

// ---------------------------------------------------------------------------
// Files → paths
// ---------------------------------------------------------------------------

/** Parse a KML string (browser DOMParser) → paths. */
export async function parsePathsFromKmlText(text: string): Promise<Path[]> {
  const { kml } = await import('@tmcw/togeojson')
  const doc = new DOMParser().parseFromString(text, 'text/xml')
  return parsePathsFromGeoJson(kml(doc))
}

/** Parse a KMZ (zipped KML) ArrayBuffer → paths. */
export async function parsePathsFromKmz(buf: ArrayBuffer): Promise<Path[]> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(buf)
  const entry = Object.keys(zip.files).find((n) => n.toLowerCase().endsWith('.kml'))
  if (!entry) return []
  return parsePathsFromKmlText(await zip.files[entry].async('text'))
}

/** Parse a zipped shapefile (.zip with .shp/.dbf) ArrayBuffer → paths. */
export async function parsePathsFromShapefileZip(buf: ArrayBuffer): Promise<Path[]> {
  const shp = (await import('shpjs')).default
  const gj = (await shp(buf)) as unknown as GeoJsonObject | GeoJsonObject[]
  // Multi-layer zips resolve to an array of FeatureCollections — flatten so a
  // sprayer export with separate layers still lands as one list of passes.
  const one = Array.isArray(gj)
    ? ({ type: 'FeatureCollection', features: gj.flatMap((c) => ((c as FeatureCollection).features ?? []) as Feature[]) } as FeatureCollection)
    : gj
  return parsePathsFromGeoJson(one)
}

/**
 * Read a user-picked path file (.geojson/.json, .kml/.kmz, zipped shapefile)
 * into `sprayer_passes` / `planter_passes` shape. Throws a message written for
 * the operator when the type is unsupported or the file holds no lines.
 */
export async function pathsFromFile(file: File): Promise<Path[]> {
  const name = file.name.toLowerCase()
  let paths: Path[]
  if (name.endsWith('.geojson') || name.endsWith('.json')) {
    let gj: unknown = null
    try {
      gj = JSON.parse(await file.text())
    } catch {
      throw new Error(`Could not read ${file.name} — it isn't valid GeoJSON.`)
    }
    paths = parsePathsFromGeoJson(gj)
  } else if (name.endsWith('.kml')) {
    paths = await parsePathsFromKmlText(await file.text())
  } else if (name.endsWith('.kmz')) {
    paths = await parsePathsFromKmz(await file.arrayBuffer())
  } else if (name.endsWith('.zip') || name.endsWith('.shp')) {
    paths = await parsePathsFromShapefileZip(await file.arrayBuffer())
  } else {
    throw new Error(`Unsupported file type: ${file.name}. Use .geojson, .kml, .kmz, or a zipped shapefile (.zip).`)
  }
  if (!paths.length) throw new Error(`No paths found in ${file.name} — expected line features.`)
  return paths
}

// ---------------------------------------------------------------------------
// Actual shelter pins (CSV)
// ---------------------------------------------------------------------------

/** One scanned/surveyed shelter position, spec §6.5. */
export interface ActualShelterPin {
  lat: number
  lng: number
  /** Shelter number / name from the file, when the file carries one. */
  label?: string
}

export interface ActualSheltersResult {
  pins: ActualShelterPin[]
  /** Data rows we could not turn into a valid coordinate. Report this to the operator. */
  skipped: number
}

/** Column layout of a CSV, however we worked it out. */
interface Cols {
  lat: number
  lon: number
  label?: number
}

/** Header cell → comparable token: lowercase, punctuation stripped, `#` kept. */
function norm(cell: string): string {
  return cell.trim().toLowerCase().replace(/[^a-z0-9#]/g, '')
}

const LAT_KEYS = new Set(['lat', 'latitude', 'y', 'ycoord', 'lattitude'])
const LON_KEYS = new Set(['lon', 'lng', 'long', 'longitude', 'x', 'xcoord'])
const LABEL_KEYS = new Set(['name', 'label', 'shelter', 'id', '#', 'number', 'no', 'pin', 'point'])

const isLatKey = (k: string) => LAT_KEYS.has(k) || k.startsWith('latitude')
const isLonKey = (k: string) => LON_KEYS.has(k) || k.startsWith('longitude')
const isLabelKey = (k: string) => LABEL_KEYS.has(k) || k.startsWith('shelter') || k.startsWith('name') || k.startsWith('label')

const LAT_MAX = 90
const LON_MAX = 180

/**
 * A single coordinate cell → number. Tolerates quotes, a degree sign, and an
 * N/S/E/W hemisphere suffix (`111.6W` → `-111.6`). Returns null if it isn't a
 * plain decimal number.
 */
function parseCoord(raw: string | undefined): number | null {
  if (raw == null) return null
  const s = raw.trim().replace(/^["']|["']$/g, '').trim()
  if (!s) return null
  const m = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*°?\s*([NSEWnsew])?$/.exec(s)
  if (!m) return null
  const v = Number(m[1])
  if (!Number.isFinite(v)) return null
  const hemi = m[2]?.toUpperCase()
  if (hemi === 'S' || hemi === 'W') return -Math.abs(v)
  if (hemi === 'N' || hemi === 'E') return Math.abs(v)
  return v
}

/** True for text that looks like a decimal (`49.83`) rather than an index (`3`). */
const looksDecimal = (raw: string | undefined) => !!raw && /\d\.\d/.test(raw)

/** Delimiter sniff over the first non-empty line: comma, semicolon, or tab. */
function sniffDelimiter(text: string): string {
  const line = text.split(/\r\n|\n|\r/).find((l) => l.trim().length > 0) ?? ''
  const counts: Array<[string, number]> = [
    [',', (line.match(/,/g) ?? []).length],
    [';', (line.match(/;/g) ?? []).length],
    ['\t', (line.match(/\t/g) ?? []).length],
  ]
  counts.sort((a, b) => b[1] - a[1])
  return counts[0][1] > 0 ? counts[0][0] : ','
}

/**
 * Minimal RFC4180-ish reader: strips a UTF-8 BOM, honours quoted fields with
 * `""` escapes, accepts CRLF/CR/LF, trims cells, and drops wholly blank rows.
 */
function splitCsvRows(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, '')
  const delim = sniffDelimiter(clean)
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  const endRow = () => {
    row.push(cell.trim())
    cell = ''
    if (row.some((c) => c.length > 0)) rows.push(row)
    row = []
  }

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]
    if (quoted) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += ch
      continue
    }
    if (ch === '"') {
      quoted = true
      continue
    }
    if (ch === delim) {
      row.push(cell.trim())
      cell = ''
      continue
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++
      endRow()
      continue
    }
    cell += ch
  }
  endRow()
  return rows
}

/** Read a header row, or null when it isn't one (no recognisable lat AND lon). */
function detectHeader(cells: string[]): Cols | null {
  let lat = -1
  let lon = -1
  let label = -1
  cells.forEach((c, i) => {
    const k = norm(c)
    if (!k) return
    if (lat < 0 && isLatKey(k)) {
      lat = i
      return
    }
    if (lon < 0 && isLonKey(k)) {
      lon = i
      return
    }
    if (label < 0 && isLabelKey(k)) label = i
  })
  if (lat < 0 || lon < 0) return null
  return { lat, lon, label: label < 0 ? undefined : label }
}

/**
 * No header — work the layout out from the data. Scores every adjacent column
 * pair `(i, i+1)` by how many rows parse as a plausible lat/lon, then breaks
 * ties on evidence that the RIGHT column is really a longitude (|v| > 90, which
 * no latitude can be) and that both columns hold decimals rather than a shelter
 * index. That is what separates `lat,lon` from `shelter,lat,lon` when the
 * shelter number itself parses as a number.
 */
function guessPositionalCols(rows: string[][]): Cols | null {
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0)
  let best: (Cols & { hits: number; bonus: number }) | null = null
  for (let i = 0; i + 1 < width; i++) {
    let hits = 0
    let bigLon = 0
    let decimals = 0
    for (const r of rows) {
      const a = parseCoord(r[i])
      const b = parseCoord(r[i + 1])
      if (a === null || b === null) continue
      if (Math.abs(a) > LAT_MAX || Math.abs(b) > LON_MAX) continue
      hits++
      if (Math.abs(b) > LAT_MAX) bigLon++
      if (looksDecimal(r[i]) && looksDecimal(r[i + 1])) decimals++
    }
    if (!hits) continue
    const bonus = (bigLon > 0 ? 2 : 0) + (decimals * 2 >= hits ? 1 : 0)
    if (!best || hits > best.hits || (hits === best.hits && bonus > best.bonus)) {
      // A column immediately left of the coordinates is the shelter label.
      best = { lat: i, lon: i + 1, label: i > 0 ? i - 1 : undefined, hits, bonus }
    }
  }
  return best ? { lat: best.lat, lon: best.lon, label: best.label } : null
}

/**
 * Tolerant CSV of scanned shelter positions (spec §6.5). Detects columns by
 * header name — latitude (`lat`/`latitude`/`y`), longitude
 * (`lon`/`lng`/`long`/`longitude`/`x`), optional label
 * (`name`/`label`/`shelter`/`id`/`#`) — case-insensitively, and falls back to
 * positional parsing (`lat,lon` or `shelter,lat,lon`) when there is no header.
 * Out-of-range or non-numeric rows count toward `skipped` instead of being
 * emitted. Never throws.
 */
export function parseActualSheltersCsv(text: string): ActualSheltersResult {
  const pins: ActualShelterPin[] = []
  let skipped = 0
  try {
    const rows = splitCsvRows(text ?? '')
    if (!rows.length) return { pins, skipped }
    const header = detectHeader(rows[0])
    const body = header ? rows.slice(1) : rows
    const cols = header ?? guessPositionalCols(body)
    if (!cols) return { pins, skipped: body.length }
    for (const row of body) {
      const lat = parseCoord(row[cols.lat])
      const lon = parseCoord(row[cols.lon])
      if (lat === null || lon === null || Math.abs(lat) > LAT_MAX || Math.abs(lon) > LON_MAX) {
        skipped++
        continue
      }
      const label = cols.label != null ? (row[cols.label] ?? '').trim() : ''
      pins.push(label ? { lat, lng: lon, label } : { lat, lng: lon })
    }
  } catch {
    return { pins, skipped }
  }
  return { pins, skipped }
}

/** Read a user-picked CSV of actual shelter positions. Throws only on a file we can't read as text. */
export async function actualSheltersFromFile(file: File): Promise<ActualSheltersResult> {
  const name = file.name.toLowerCase()
  if (/\.(zip|shp|kml|kmz|xlsx|xls|pdf)$/.test(name)) {
    throw new Error(`Unsupported file type: ${file.name}. Actual shelter pins import from a .csv of coordinates.`)
  }
  return parseActualSheltersCsv(await file.text())
}
