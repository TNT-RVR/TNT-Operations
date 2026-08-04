import type { Feature, FeatureCollection, LineString, Polygon, Position } from 'geojson'
import { fromLonLat } from './geo'
import {
  fieldFrame,
  frameExtent,
  latAlongToLonLat,
  enuToLatAlong,
  type FieldFrame,
} from './fieldFrame'
import { maskRuns, baySlotLefts, type FieldDict } from './tentGrid'

/**
 * Pure geometry → GeoJSON generators for the PLANTER overlays (spec §6.4/§6.5):
 * the blue male-bay bands, the numbered planter-pass lines, and the triangular
 * alignment mesh the crew keeps flags straight to.
 *
 * Everything here projects through {@link fieldFrame} — the SAME rotation, tiling
 * and calibration shift the placement engine uses (spec §5.1–5.4). Overlays drawn
 * from a re-derived frame would drift off the shelters the engine actually placed,
 * which is the one bug these overlays exist to make visible, so never re-derive it.
 *
 * Every generator is total: bad or incomplete input yields an EMPTY
 * FeatureCollection rather than a throw, because these run on every map render
 * while the user is still typing field parameters.
 *
 * Colours are NOT set here (Part 13 lives in the map layer paint): each feature
 * carries a `kind` so the style layer can key off it.
 */

const MALE_BAY_OFFSET_M = 5.0 * 0.3048 // 5 ft — the "pivot pass is #0" threshold too

const emptyFC = <T extends Polygon | LineString>(): FeatureCollection<T> => ({
  type: 'FeatureCollection',
  features: [],
})

/** Python `%` — result takes the sign of the divisor (parity must match the engine). */
const pymod = (a: number, n: number): number => ((a % n) + n) % n

const finitePair = (p: Position): boolean => Number.isFinite(p[0]) && Number.isFinite(p[1])

/**
 * The frame plus its bay tiling, or null when no bay geometry can be drawn
 * (no pivot, blanket-planted, empty mask, zero row spacing, degenerate pass).
 */
function bayFrame(field: FieldDict): FieldFrame | null {
  const f = fieldFrame(field)
  if (!f) return null
  if (!f.useBays) return null
  if (!f.mask) return null
  if (!(f.rowSpacingM > 0)) return null
  if (!(f.passW > 0) || !Number.isFinite(f.passW)) return null
  if (f.lefts.length !== f.mask.length) return null
  return f
}

/**
 * The forward/reversed run + slot tables the planter snake alternates between.
 * Mirrors `maleBayShelterLaterals` exactly (spec §5.4): even passes plant the
 * mask forwards, odd passes plant it backwards, and `pass_phase_swap` flips which
 * parity is which.
 */
function snakeTables(f: FieldFrame) {
  const reversed = f.mask.split('').reverse().join('')
  return {
    runsFwd: maskRuns(f.mask, 'M'),
    runsRev: maskRuns(reversed, 'M'),
    leftsFwd: f.lefts,
    leftsRev: baySlotLefts(reversed, f.rowSpacingM, f.gapM)[0],
    phase: f.passPhaseSwap ? 1 : 0,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Male-bay bands (spec §6.4 "Toggle Male Bays", geometry per §5.3/§5.4)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The blue male-bay bands — one polygon per male run per planter pass, running
 * the full along-extent of the field.
 *
 * Band edges come straight from the gap-aware tiling (spec §5.3): a male run
 * `(s, e)` spans `lefts[s] .. lefts[e-1] + rs_m`, which is **exactly
 * `(e-s)·rs_m`** because `bay_slot_lefts` only ever adds `gap_m` at a mask
 * CHANGE — i.e. between bays, never inside one. That invariant is the fix for
 * the Wordmans/Carrots "hairlines on one side" bug where `bay_gap_in` used to be
 * subtracted from the band and a wide enough gap collapsed it to nothing.
 *
 * Bands entirely off the side of the field are dropped; bands are not clipped to
 * the boundary (the map layer draws them under the boundary line).
 */
export function maleBayBands(field: FieldDict): FeatureCollection<Polygon> {
  const f = bayFrame(field)
  if (!f) return emptyFC<Polygon>()

  const { runsFwd, runsRev, leftsFwd, leftsRev, phase } = snakeTables(f)
  if (runsFwd.length === 0) return emptyFC<Polygon>()

  const [latMin, latMax, alongMin, alongMax] = frameExtent(f)
  const half = f.passW / 2
  const nPass = Math.trunc(f.radius / f.passW) + 2
  if (!Number.isFinite(nPass) || nPass < 0) return emptyFC<Polygon>()

  const feats: Feature<Polygon>[] = []
  for (let i = -nPass; i <= nPass; i++) {
    const xc = (i + 0.5) * f.passW
    const even = pymod(i + phase, 2) === 0
    const runs = even ? runsFwd : runsRev
    const lefts = even ? leftsFwd : leftsRev
    for (const [s, e] of runs) {
      const lo = xc + lefts[s] - half
      const hi = xc + lefts[e - 1] + f.rowSpacingM - half
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue
      if (hi < latMin || lo > latMax) continue // wholly off the side of the field
      const ring: Position[] = [
        latAlongToLonLat(f, lo, alongMin),
        latAlongToLonLat(f, hi, alongMin),
        latAlongToLonLat(f, hi, alongMax),
        latAlongToLonLat(f, lo, alongMax),
      ]
      if (!ring.every(finitePair)) continue
      ring.push(ring[0]) // close
      feats.push({
        type: 'Feature',
        properties: { kind: 'male_bay', pass: i },
        geometry: { type: 'Polygon', coordinates: [ring] },
      })
    }
  }
  return { type: 'FeatureCollection', features: feats }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Numbered planter passes (spec §6.4 "Number Planter Passes")
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pass boundary lines carrying the crew's pass NUMBER.
 *
 * Numbering runs OUTWARD from the pivot: west (negative lateral) counts
 * +1, +2, …; east counts −1, −2, …. The pass the pivot falls in is #0 only when
 * the pivot sits ≥5 ft (1.524 m) inside BOTH of that pass's edges — otherwise the
 * pivot is effectively on a pass boundary (the normal case, spec §5.4 "pivot sits
 * on a pass boundary") and 0 is skipped entirely.
 *
 * Each feature's geometry is the pass's WEST boundary line at lateral
 * `j · pass_w`, spanning the field's along-extent; the label goes on the line.
 * The emitted index range is centred on the pivot's pass so the numbers come out
 * symmetric (±nPass) with no duplicates.
 */
export function planterPassLines(field: FieldDict): FeatureCollection<LineString> {
  const f = bayFrame(field)
  if (!f) return emptyFC<LineString>()

  const [, , alongMin, alongMax] = frameExtent(f)
  const nPass = Math.trunc(f.radius / f.passW) + 2
  if (!Number.isFinite(nPass) || nPass < 1) return emptyFC<LineString>()

  // Where the pivot (ENU origin) lands in the rotated frame — the calibration
  // shift can push it off lateral 0.
  const [pivotLat] = enuToLatAlong(f, 0, 0)
  if (!Number.isFinite(pivotLat)) return emptyFC<LineString>()

  const k0 = Math.floor(pivotLat / f.passW) // pass index containing the pivot
  const insideWest = pivotLat - k0 * f.passW
  const insideEast = (k0 + 1) * f.passW - pivotLat
  const pivotPassCounts = insideWest >= MALE_BAY_OFFSET_M && insideEast >= MALE_BAY_OFFSET_M

  // Pass index → number, and the index range that yields a symmetric ±nPass set.
  let numberOf: (j: number) => number
  let jLo: number
  let jHi: number
  if (pivotPassCounts) {
    numberOf = (j) => k0 - j // west of k0 → +, east → −, k0 itself → 0
    jLo = k0 - nPass
    jHi = k0 + nPass
  } else {
    // The pivot sits on (or within 5 ft of) a boundary — number outward from it.
    const b = Math.round(pivotLat / f.passW)
    numberOf = (j) => (j < b ? b - j : b - j - 1) // …+2,+1 | −1,−2,…
    jLo = b - nPass
    jHi = b + nPass - 1
  }

  const feats: Feature<LineString>[] = []
  for (let j = jLo; j <= jHi; j++) {
    const lateral = j * f.passW
    const a = latAlongToLonLat(f, lateral, alongMin)
    const b2 = latAlongToLonLat(f, lateral, alongMax)
    if (!finitePair(a) || !finitePair(b2)) continue
    feats.push({
      type: 'Feature',
      properties: { kind: 'planter_pass', number: numberOf(j) },
      geometry: { type: 'LineString', coordinates: [a, b2] },
    })
  }
  return { type: 'FeatureCollection', features: feats }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Alignment mesh (spec §6.5 "Toggle Alignment Lines")
// ─────────────────────────────────────────────────────────────────────────────

export interface AlignmentPin {
  lat: number
  lng: number
}

/** Column tolerance: pins within half a metre laterally are the same bay column. */
const COLUMN_TOL_M = 0.5

/**
 * Along-pass tolerance for "level with". Pins this close along the pass are the
 * same rank, so an UNstaggered grid links straight across once instead of
 * fanning to two near-identical neighbours on projection round-trip noise.
 */
const LEVEL_TOL_M = 0.05

/**
 * The triangular guide mesh crews sight flags along (spec §6.5).
 *
 * The pins passed in are the ones actually on screen — apply `shelter_overrides`
 * BEFORE calling, so a dragged pin drags its guide lines with it.
 *
 * Method: project every pin into the field's (lateral, along) frame, group into
 * columns by lateral (±0.5 m), then emit
 *   • one polyline down each column, sorted along-pass, and
 *   • a link from every pin to its nearest neighbour above AND below it in the
 *     next column across,
 * which together make the triangular lattice. Fewer than 3 pins has no lattice.
 */
export function alignmentLines(
  shelters: Array<AlignmentPin>,
  field: FieldDict,
): FeatureCollection<LineString> {
  if (!Array.isArray(shelters) || shelters.length < 3) return emptyFC<LineString>()
  const f = fieldFrame(field)
  if (!f) return emptyFC<LineString>()

  // Project to (lateral, along), dropping anything non-finite.
  type Pin = { lateral: number; along: number; lon: number; lat: number }
  const pins: Pin[] = []
  for (const s of shelters) {
    const lat = Number(s?.lat)
    const lon = Number(s?.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    const [e, n] = fromLonLat(lon, lat, f.pivotLon)
    const [lateral, along] = enuToLatAlong(f, e - f.easting, n - f.northing)
    if (!Number.isFinite(lateral) || !Number.isFinite(along)) continue
    pins.push({ lateral, along, lon, lat })
  }
  if (pins.length < 3) return emptyFC<LineString>()

  // Group into columns by lateral, comparing against each column's running mean
  // so a long column can't drift wider than the tolerance one pin at a time.
  const sorted = pins.slice().sort((a, b) => a.lateral - b.lateral || a.along - b.along)
  const columns: Pin[][] = []
  let mean = NaN
  for (const p of sorted) {
    const col = columns[columns.length - 1]
    if (col && Math.abs(p.lateral - mean) <= COLUMN_TOL_M) {
      col.push(p)
      mean = (mean * (col.length - 1) + p.lateral) / col.length
    } else {
      columns.push([p])
      mean = p.lateral
    }
  }
  for (const col of columns) col.sort((a, b) => a.along - b.along || a.lateral - b.lateral)

  const feats: Feature<LineString>[] = []
  const push = (coords: Position[]) => {
    if (coords.length < 2 || !coords.every(finitePair)) return
    feats.push({
      type: 'Feature',
      properties: { kind: 'alignment' },
      geometry: { type: 'LineString', coordinates: coords },
    })
  }

  // Down each column.
  for (const col of columns) {
    if (col.length < 2) continue
    push(col.map((p) => [p.lon, p.lat] as Position))
  }

  // Across to the next column: nearest above + nearest below → triangles.
  const seen = new Set<string>()
  for (let c = 0; c + 1 < columns.length; c++) {
    const next = columns[c + 1]
    if (next.length === 0) continue
    for (const p of columns[c]) {
      let above: Pin | null = null // smallest `along` ≥ p.along
      let below: Pin | null = null // largest `along` ≤ p.along
      for (const q of next) {
        const d = q.along - p.along
        if (d >= -LEVEL_TOL_M && (above === null || q.along < above.along)) above = q
        if (d <= LEVEL_TOL_M && (below === null || q.along > below.along)) below = q
      }
      for (const q of [below, above]) {
        if (!q) continue
        const key = `${c}:${p.lateral},${p.along}->${q.lateral},${q.along}`
        if (seen.has(key)) continue
        seen.add(key)
        push([
          [p.lon, p.lat],
          [q.lon, q.lat],
        ])
      }
    }
  }

  return { type: 'FeatureCollection', features: feats }
}
