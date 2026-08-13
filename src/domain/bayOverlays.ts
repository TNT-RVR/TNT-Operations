import type {
  Feature,
  FeatureCollection,
  LineString,
  MultiPolygon,
  Point,
  Polygon,
  Position,
} from 'geojson'
import {
  booleanPointInPolygon as turfBooleanPointInPolygon,
  difference as turfDifference,
  featureCollection as turfFeatureCollection,
  intersect as turfIntersect,
  lineSplit as turfLineSplit,
  polygon as turfPolygon,
  union as turfUnion,
} from '@turf/turf'
import { fromLonLat } from './geo'
import {
  fieldFrame,
  frameExtent,
  latAlongToLonLat,
  enuToLatAlong,
  enuToLonLat,
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

// ─────────────────────────────────────────────────────────────────────────────
// 0. Inner-boundary exclusions (spec Part 4 `boundary_inner` /
//    `access_road_boundary`, toggled by §6.3 and §6.4)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read a field-dict boolean that may be a real boolean, a Python-ish string
 * (`"True"` / `"false"`), a number, or missing.
 *
 * ABSENT or BLANK means "unset", so the SPEC default applies — that matters here
 * because the two inner-boundary toggles default opposite ways:
 * `bays_through_inner` is FALSE (clip the bands) while
 * `sprayer_routes_around_inner` is TRUE (break the lines).
 *
 * Shared with `sprayOverlays.ts`.
 */
export function fieldBool(v: unknown, dflt: boolean): boolean {
  if (v === undefined || v === null) return dflt
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return Number.isFinite(v) ? v !== 0 : dflt
  const s = String(v).trim().toLowerCase()
  if (s === '') return dflt
  if (s === 'true' || s === 'yes' || s === 'y' || s === 'on' || s === '1') return true
  if (s === 'false' || s === 'no' || s === 'n' || s === 'off' || s === '0') return false
  return dflt
}

/**
 * One stored ring (`[[lat,lon], …]`, the Part 4 convention) → a CLOSED `[lon,lat]`
 * turf ring, or null when the ring is unusable.
 *
 * Malformed rings are DROPPED, never repaired and never thrown on: these run on
 * every render while the user is mid-draw, so a half-finished 2-point ring or a
 * stray non-numeric coordinate must simply not clip anything.
 */
function toLonLatRing(raw: unknown): Position[] | null {
  if (!Array.isArray(raw) || raw.length < 3) return null
  const ring: Position[] = []
  for (const p of raw as Array<[unknown, unknown]>) {
    if (!Array.isArray(p) || p.length < 2) return null
    const lat = Number(p[0])
    const lon = Number(p[1])
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
    const last = ring[ring.length - 1]
    if (last && last[0] === lon && last[1] === lat) continue // drop repeats
    ring.push([lon, lat])
  }
  // Drop any closing duplicate(s); turf wants exactly one, added below.
  while (
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
  ) {
    ring.pop()
  }
  if (ring.length < 3) return null
  ring.push(ring[0])
  return ring
}

/**
 * The UNION of every inner-exclusion ring on a field — interior boundaries plus
 * the pivot access road — as ONE turf polygon in `[lon,lat]`, or null when there
 * is nothing to clip against.
 *
 * Build this ONCE per generator call and reuse it for every band/line: unioning
 * per feature would be O(bands × rings) boolean ops on every map render.
 *
 * Returning null is the "no work" signal — callers must then emit their geometry
 * completely untouched, so a field with no inner rings is byte-for-byte what it
 * was before clipping existed. That equivalence is the regression the tests lock.
 *
 * Shared with `sprayOverlays.ts`.
 */
export function innerExclusionUnion(field: FieldDict): Feature<Polygon | MultiPolygon> | null {
  try {
    const inner = field['boundary_inner']
    const access = field['access_road_boundary']
    const raw: unknown[] = [
      ...(Array.isArray(inner) ? (inner as unknown[]) : []),
      ...(Array.isArray(access) ? (access as unknown[]) : []),
    ]
    if (raw.length === 0) return null

    const polys: Feature<Polygon>[] = []
    for (const r of raw) {
      const ring = toLonLatRing(r)
      if (!ring) continue
      try {
        polys.push(turfPolygon([ring]))
      } catch {
        /* turf rejected the ring (degenerate) — ignore it */
      }
    }
    if (polys.length === 0) return null
    if (polys.length === 1) return polys[0]

    const merged = turfUnion(turfFeatureCollection<Polygon | MultiPolygon>(polys))
    if (merged && merged.geometry) return merged
    // Union can fail on self-touching input; a plain MultiPolygon of the parts is
    // still a correct clip mask (the boolean ops below handle overlap).
    return {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'MultiPolygon',
        coordinates: polys.map((p) => p.geometry.coordinates),
      },
    }
  } catch {
    return null
  }
}

/**
 * Subtract the exclusion mask from one polygon feature.
 *
 * A band that straddles a hole comes back as SEVERAL pieces (turf hands us a
 * MultiPolygon), so this returns an array; every piece carries a copy of the
 * input's properties. A band swallowed whole returns `[]`.
 */
function clipPolygonFeature(
  feat: Feature<Polygon>,
  holes: Feature<Polygon | MultiPolygon>,
): Feature<Polygon>[] {
  let diff: Feature<Polygon | MultiPolygon> | null
  try {
    diff = turfDifference(turfFeatureCollection<Polygon | MultiPolygon>([feat, holes]))
  } catch {
    return [feat] // never lose geometry to a boolean-op hiccup
  }
  if (!diff || !diff.geometry) return [] // fully covered
  const piece = (coordinates: Position[][]): Feature<Polygon> => ({
    type: 'Feature',
    properties: { ...feat.properties },
    geometry: { type: 'Polygon', coordinates },
  })
  if (diff.geometry.type === 'Polygon') return [piece(diff.geometry.coordinates)]
  if (diff.geometry.type === 'MultiPolygon') return diff.geometry.coordinates.map(piece)
  return []
}

// ── 0b. Clipping overlays to the FIELD ──────────────────────────────────────
// Bands and pass lines are generated across the frame's bounding box, which is
// always bigger than the field itself — so without this they visibly spill past
// the boundary. Everything drawn on the crop gets clipped to the field outline:
// the boundary polygon, or the pivot circle on radius-only fields.

/**
 * The field outline as a turf polygon, or null when the field has no extent.
 * A drawn boundary wins; otherwise the pivot circle IS the field, so overlays
 * on a radius-only field still get clipped to something sensible.
 */
export function fieldOutline(field: FieldDict): Feature<Polygon> | null {
  const f = fieldFrame(field)
  return f ? outlineFromFrame(f) : null
}

export function outlineFromFrame(f: FieldFrame): Feature<Polygon> | null {
  try {
    if (f.boundaryEnu && f.boundaryEnu.length >= 3) {
      const ring: Position[] = f.boundaryEnu.map(([e, n]) => enuToLonLat(f, e, n))
      ring.push(ring[0]) // turf requires a closed ring
      return turfPolygon([ring])
    }
    if (f.radius > 0) {
      const steps = 128
      const ring: Position[] = []
      for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * 2 * Math.PI
        ring.push(enuToLonLat(f, Math.cos(a) * f.radius, Math.sin(a) * f.radius))
      }
      return turfPolygon([ring])
    }
  } catch {
    /* degenerate ring — draw unclipped rather than crash */
  }
  return null
}

/** Keep only the part of a polygon inside the field. */
export function clipPolygonToOutline(feat: Feature<Polygon>, outline: Feature<Polygon>): Feature<Polygon>[] {
  let hit: Feature<Polygon | MultiPolygon> | null
  try {
    hit = turfIntersect(turfFeatureCollection<Polygon>([feat, outline]))
  } catch {
    return [feat]
  }
  if (!hit || !hit.geometry) return []
  const piece = (coordinates: Position[][]): Feature<Polygon> => ({
    type: 'Feature',
    properties: { ...feat.properties },
    geometry: { type: 'Polygon', coordinates },
  })
  if (hit.geometry.type === 'Polygon') return [piece(hit.geometry.coordinates)]
  if (hit.geometry.type === 'MultiPolygon') return hit.geometry.coordinates.map(piece)
  return []
}

/** Keep only the parts of a line inside the field (a line may become several). */
export function clipLineToOutline(feat: Feature<LineString>, outline: Feature<Polygon>): Feature<LineString>[] {
  let pieces: Feature<LineString>[]
  try {
    const split = turfLineSplit(feat, outline)
    pieces = split.features.length > 0 ? (split.features as Feature<LineString>[]) : [feat]
  } catch {
    return [feat]
  }
  const inside: Feature<LineString>[] = []
  for (const p of pieces) {
    const c = p.geometry?.coordinates
    if (!c || c.length < 2) continue
    // Midpoint of the middle segment — robust when an endpoint sits exactly on
    // the boundary, which is the common case right after a split.
    const i = Math.max(0, Math.floor((c.length - 1) / 2))
    const mid: Position = [(c[i][0] + c[i + 1][0]) / 2, (c[i][1] + c[i + 1][1]) / 2]
    if (!Number.isFinite(mid[0]) || !Number.isFinite(mid[1])) continue
    try {
      if (turfBooleanPointInPolygon(mid, outline)) {
        inside.push({ type: 'Feature', properties: { ...feat.properties }, geometry: p.geometry })
      }
    } catch {
      /* skip an unjudgeable piece rather than drawing it outside the field */
    }
  }
  return inside
}

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
 * the OUTER boundary (the map layer draws them under the boundary line).
 *
 * They ARE clipped to the INNER ones (spec §6.4 "Toggle Bays Through Inner"):
 * unless `bays_through_inner` is set, every band has the union of
 * `boundary_inner` + `access_road_boundary` subtracted from it, so a band that
 * crosses a slough or the pivot road comes back as the pieces either side and a
 * band swallowed by one disappears. A field with no inner rings does no boolean
 * work at all and emits exactly what it always did.
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

  // NOTE: bands are NOT trimmed to the field outline here. That's a display
  // concern — and clipping a band to a curved boundary narrows it at the edge,
  // which would break the §5.3 band-width invariant these generators guarantee.
  // The map applies `clipToField` when it draws.
  const out = feats

  // Spec §6.4 — bays run straight through the inner boundaries only on request.
  if (fieldBool(field['bays_through_inner'], false)) {
    return { type: 'FeatureCollection', features: out }
  }
  const holes = innerExclusionUnion(field)
  if (!holes) return { type: 'FeatureCollection', features: out }
  try {
    const clipped: Feature<Polygon>[] = []
    for (const band of out) clipped.push(...clipPolygonFeature(band, holes))
    return { type: 'FeatureCollection', features: clipped }
  } catch {
    return { type: 'FeatureCollection', features: out }
  }
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

  // Spans the bounding box by design; the map trims with `clipToField`.
  return { type: 'FeatureCollection', features: feats }
}

/**
 * Trim an overlay to the field outline — the DISPLAY clip.
 *
 * The generators deliberately span the frame's bounding box, because that's
 * what keeps their geometry exact (a band clipped to a curved boundary is no
 * longer `nm × row-spacing` wide, and the §5.3 invariant would be untestable).
 * The map calls this when it draws, so nothing spills past the field.
 *
 * Accepts polygons or lines; anything the outline can't judge is passed through
 * rather than dropped, so a boolean-op failure never blanks a layer.
 */
export function clipToField<G extends Polygon | LineString>(
  fc: FeatureCollection<G>,
  field: FieldDict,
): FeatureCollection<G> {
  const outline = fieldOutline(field)
  if (!outline || fc.features.length === 0) return fc
  const out: Feature<G>[] = []
  for (const f of fc.features) {
    try {
      if (f.geometry?.type === 'Polygon') {
        out.push(...(clipPolygonToOutline(f as Feature<Polygon>, outline) as unknown as Feature<G>[]))
      } else if (f.geometry?.type === 'LineString') {
        out.push(...(clipLineToOutline(f as Feature<LineString>, outline) as unknown as Feature<G>[]))
      } else {
        out.push(f)
      }
    } catch {
      out.push(f)
    }
  }
  return { type: 'FeatureCollection', features: out }
}

/**
 * Pass numbers as POINTS at BOTH ENDS of every pass line (spec §6.4).
 *
 * A single label at the line's centre is invisible in the middle of a field —
 * the operator reads pass numbers at the headland, where they're driving in. So
 * each clipped pass contributes a label at each end, nudged just inside the
 * line so it doesn't sit on the boundary itself.
 */
export function planterPassLabels(field: FieldDict): FeatureCollection<Point> {
  // Labels are display-only, so they use the CLIPPED lines — a number belongs at
  // the headland where the operator drives in, not out on the bounding box.
  const lines = clipToField(planterPassLines(field), field)
  const feats: Feature<Point>[] = []
  for (const line of lines.features) {
    const c = line.geometry?.coordinates
    if (!c || c.length < 2) continue
    const number = (line.properties as { number?: number } | null)?.number
    if (number === undefined) continue
    // Pull each label ~4% in from the tip so it reads inside the field.
    const inset = (from: Position, to: Position): Position => [
      from[0] + (to[0] - from[0]) * 0.04,
      from[1] + (to[1] - from[1]) * 0.04,
    ]
    for (const p of [inset(c[0], c[1]), inset(c[c.length - 1], c[c.length - 2])]) {
      if (!finitePair(p)) continue
      feats.push({
        type: 'Feature',
        properties: { kind: 'planter_pass_label', number },
        geometry: { type: 'Point', coordinates: p },
      })
    }
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
 * Row tolerance: pins within half a metre along the pass are the same rank.
 *
 * The mirror of {@link COLUMN_TOL_M}, and deliberately the same number — a crew
 * sighting across a field is doing the same thing as a crew sighting down it,
 * and a guide that appeared in one direction but not the other at the same
 * slop would be confusing to use.
 */
const ROW_TOL_M = 0.5

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
 * ── These are LINES, not polylines through the pins ─────────────────────────
 *
 * Each guide is a straight line spanning the whole field, positioned by the
 * pins that lie on it — not a path that visits them. That is the difference
 * between a guide and a record of where things already are:
 *
 *   • it carries on THROUGH a gap, so shelters either side of a wet spot or a
 *     slough can be put on the same line as each other;
 *   • it reaches past the outermost shelter, so the next one placed has a line
 *     to go on; and
 *   • it cannot kink. A polyline through pins that are 20 cm out of true bends
 *     at each one and quietly certifies the error; a fitted line shows it.
 *
 * Method: project every pin into the field's (lateral, along) frame, then
 *   • group by lateral (±0.5 m) → a COLUMN line down the field at that lateral;
 *   • group by along (±0.5 m) → a ROW line across the field at that along; and
 *   • take every pin's nearest neighbour above and below in the next column,
 *     and extend the line through that pair to the field extent → the
 *     DIAGONALS. Collinear ones collapse to a single line, so a diagonal that
 *     runs through six pins is drawn once rather than five times.
 *
 * Column position is the group's MEAN lateral, not its first pin's, so one
 * shelter set slightly off does not drag the whole guide with it. Rows likewise.
 *
 * On a staggered grid a row links every OTHER column, because those are the
 * pins genuinely level with each other; a line through pins that are not level
 * would be a worse guide than none.
 *
 * Lines span the frame's bounding box by design — the map trims them with
 * `clipToField`, the same contract the bay and pass generators follow.
 *
 * Each feature carries `axis: 'column' | 'row' | 'diagonal'` alongside
 * `kind: 'alignment'`, so a caller can style or filter one family without
 * having to infer it from the vertex count. Fewer than 3 pins has no lattice.
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

  /**
   * Bucket pins along one axis.
   *
   * Compared against each group's running MEAN rather than its last member, so
   * a long group can't drift wider than the tolerance one pin at a time. Shared
   * by both axes so a row and a column can never disagree about what "the same
   * line" means.
   */
  const groupBy = (key: (p: Pin) => number, other: (p: Pin) => number, tol: number): Pin[][] => {
    const sorted = pins.slice().sort((a, b) => key(a) - key(b) || other(a) - other(b))
    const groups: Pin[][] = []
    let mean = NaN
    for (const p of sorted) {
      const g = groups[groups.length - 1]
      if (g && Math.abs(key(p) - mean) <= tol) {
        g.push(p)
        mean = (mean * (g.length - 1) + key(p)) / g.length
      } else {
        groups.push([p])
        mean = key(p)
      }
    }
    // Order within the group by the OTHER axis, so the polyline runs straight
    // along it instead of zig-zagging back on itself.
    for (const g of groups) g.sort((a, b) => other(a) - other(b) || key(a) - key(b))
    return groups
  }

  const columns = groupBy((p) => p.lateral, (p) => p.along, COLUMN_TOL_M)
  const rows = groupBy((p) => p.along, (p) => p.lateral, ROW_TOL_M)

  const [latMin, latMax, alongMin, alongMax] = frameExtent(f)

  const feats: Feature<LineString>[] = []
  /** Lines already drawn, keyed by their extent-clipped endpoints. */
  const drawn = new Set<string>()

  /**
   * Extend the line through two frame points to the edges of the field extent,
   * and emit it once.
   *
   * Slab clipping: walk the parameter `t` along the direction and keep the
   * window that stays inside the box on both axes. A direction parallel to an
   * axis simply has no constraint from that axis, which is why the zero-guard
   * checks whether the point is already inside rather than rejecting outright.
   */
  const pushLine = (
    a: { lateral: number; along: number },
    b: { lateral: number; along: number },
    axis: 'column' | 'row' | 'diagonal',
  ) => {
    const dLat = b.lateral - a.lateral
    const dAlong = b.along - a.along
    if (!Number.isFinite(dLat) || !Number.isFinite(dAlong)) return
    if (dLat === 0 && dAlong === 0) return

    let t0 = -Infinity
    let t1 = Infinity
    const slab = (origin: number, delta: number, lo: number, hi: number): boolean => {
      if (delta === 0) return origin >= lo && origin <= hi
      const ta = (lo - origin) / delta
      const tb = (hi - origin) / delta
      t0 = Math.max(t0, Math.min(ta, tb))
      t1 = Math.min(t1, Math.max(ta, tb))
      return true
    }
    if (!slab(a.lateral, dLat, latMin, latMax)) return
    if (!slab(a.along, dAlong, alongMin, alongMax)) return
    if (!(t1 > t0) || !Number.isFinite(t0) || !Number.isFinite(t1)) return

    const at = (t: number): Position =>
      latAlongToLonLat(f, a.lateral + dLat * t, a.along + dAlong * t)
    const coords: Position[] = [at(t0), at(t1)]
    if (!coords.every(finitePair)) return

    // Collinear guides land on the same two endpoints, so rounding them is
    // enough to draw each line once — a diagonal through six pins would
    // otherwise be emitted five times, one per adjacent pair.
    //
    // The axis is NOT part of the key, deliberately. On an unstaggered grid the
    // "diagonal" to the neighbour level with a pin IS that pin's row line, and
    // labelling the same geometry twice would draw it twice. Rows and columns
    // are emitted first, so the more meaningful label wins.
    const key = coords.map((c) => `${c[0].toFixed(7)},${c[1].toFixed(7)}`).join('|')
    if (drawn.has(key)) return
    drawn.add(key)

    feats.push({
      type: 'Feature',
      properties: { kind: 'alignment', axis },
      geometry: { type: 'LineString', coordinates: coords },
    })
  }

  /** The mean of a group's positions on one axis — robust to one stray pin. */
  const meanOf = (g: Pin[], key: (p: Pin) => number) =>
    g.reduce((sum, p) => sum + key(p), 0) / g.length

  // A line down each column and across each row, spanning the field.
  for (const col of columns) {
    if (col.length < 2) continue
    const lateral = meanOf(col, (p) => p.lateral)
    pushLine({ lateral, along: alongMin }, { lateral, along: alongMax }, 'column')
  }
  for (const row of rows) {
    if (row.length < 2) continue
    const along = meanOf(row, (p) => p.along)
    pushLine({ lateral: latMin, along }, { lateral: latMax, along }, 'row')
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
        pushLine(p, q, 'diagonal')
      }
    }
  }

  return { type: 'FeatureCollection', features: feats }
}
