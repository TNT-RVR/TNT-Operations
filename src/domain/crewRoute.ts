/**
 * Crew driving route — the faithful TypeScript port of `crew_route()` from the
 * old beetent-maps `maketentgrid.py` (plus the override short-circuit its GUI
 * caller `_redraw_crews` applied around it).
 *
 * A snake driven down the CENTRE of the male bays that have shelters near them
 * (the crew works one male bay at a time, snaking across to the next):
 *   • group shelters by nearest male-bay centre (mirroring the bay overlay
 *     geometry: resolve_row_mask / bay_slot_lefts / pass tiling + phase),
 *   • each pass runs the FULL length to the field boundary,
 *   • consecutive passes are joined by following the boundary perimeter
 *     (headland) — never across the crop (or across a canal concavity),
 *   • if a `parking_pin` is set the route starts AND ends there,
 *   • a `crew_route_override` polyline, if present, replaces everything.
 *
 * Route length is computed in the rotated metric frame, so it is invariant to
 * any field shift. Returns `{ route: [[lat, lon], ...], totalM }` — empty route
 * and 0 when one can't be built (matching the Python's `([], 0.0)`).
 *
 * The math mirrors the Python operation-for-operation (same rounding, same
 * tie-breaks, same loop bounds). Do NOT "tidy" the algebra — fidelity is the
 * point. Helpers that are module-private in `tentGrid.ts` (mask/lefts/py-compat
 * shims) are re-derived here rather than exported from it.
 */

import { fromLonLat, toLonLat, latlonListToEnu } from './geo'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Raw field dict, matching the JSON saved by the old app (loosely typed). */
export type FieldDict = Record<string, unknown>

export interface CrewRouteResult {
  /** Route waypoints as [lat, lon] (empty if a route can't be built). */
  route: Array<[number, number]>
  /** Total route length in metres. */
  totalM: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Python-compatibility primitives (mirroring tentGrid.ts's private shims)
// ─────────────────────────────────────────────────────────────────────────────

/** Python truthiness for the value kinds found in field dicts. */
function truthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false) return false
  if (typeof v === 'number') return v !== 0
  if (typeof v === 'string') return v.length > 0
  if (Array.isArray(v)) return v.length > 0
  return true
}

/** `dict.get(key) or default` — default when the value is falsy. */
function getOr<T>(field: FieldDict, key: string, dflt: T): unknown | T {
  const v = field[key]
  return truthy(v) ? v : dflt
}

/** `float(x)` — throws (like Python TypeError/ValueError) on non-numeric input. */
function toFloat(v: unknown): number {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`float() bad number: ${v}`)
    return v
  }
  if (v === null || v === undefined || typeof v === 'boolean') {
    throw new Error(`float() invalid: ${v}`)
  }
  const s = String(v).trim()
  if (s === '') throw new Error('float() empty string')
  const n = Number(s)
  if (Number.isNaN(n) || !Number.isFinite(n)) throw new Error(`float() invalid: ${s}`)
  return n
}

/** `int(x)` — truncate toward zero for numbers; parse an integer literal for strings. */
function toInt(v: unknown): number {
  if (typeof v === 'number') return Math.trunc(v)
  const s = String(v).trim()
  if (!/^[+-]?\d+$/.test(s)) throw new Error(`int() invalid: ${s}`)
  return parseInt(s, 10)
}

/** Python `round()` — round half to even ("banker's rounding"). */
function pyRound(value: number, ndigits = 0): number {
  if (!Number.isFinite(value)) return value
  const m = 10 ** ndigits
  const scaled = value * m
  const floor = Math.floor(scaled)
  const frac = scaled - floor
  let rounded: number
  if (Math.abs(frac - 0.5) < 1e-9) {
    rounded = floor % 2 === 0 ? floor : floor + 1
  } else {
    rounded = Math.round(scaled)
  }
  return rounded / m
}

/** Python `%` (result takes the sign of the divisor). */
function pymod(a: number, n: number): number {
  return ((a % n) + n) % n
}

/** `bisect.bisect_left` over an ascending number array. */
function bisectLeft(arr: number[], x: number): number {
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid] < x) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Haversine with the app's R = 6378137 m — matches `haversine_m` in
 * beetent_app.py, which the old GUI used to measure a `crew_route_override`.
 * (geo.ts's `haversineMeters` uses R = 6371000, a different constant, so it is
 * deliberately NOT reused here.)
 */
function haversineAppM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6378137.0
  const rad = (d: number) => (d * Math.PI) / 180
  const dlat = rad(lat2 - lat1)
  const dlon = rad(lon2 - lon1)
  const a =
    Math.sin(dlat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dlon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// ─────────────────────────────────────────────────────────────────────────────
// Bay-mask helpers (re-derived from maketentgrid.py; private in tentGrid.ts)
// ─────────────────────────────────────────────────────────────────────────────

/** Contiguous runs of `char` in `mask` as [start, endExclusive) pairs (mask_runs). */
function maskRuns(mask: string, char: string): Array<[number, number]> {
  const runs: Array<[number, number]> = []
  let start: number | null = null
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === char) {
      if (start === null) start = i
    } else if (start !== null) {
      runs.push([start, i])
      start = null
    }
  }
  if (start !== null) runs.push([start, mask.length])
  return runs
}

/** Build the M/F-per-row planter mask (resolve_row_mask). */
function resolveRowMask(
  nf: number,
  nm: number,
  layout: string,
  custom: string,
  totalRows?: number,
): string {
  nf = Math.trunc(nf)
  nm = Math.trunc(nm)
  const unit = Math.max(0, nf + nm)
  if (unit === 0) return ''
  let target: number
  try {
    target = totalRows ? toInt(totalRows) : unit
  } catch {
    target = unit
  }
  if (target <= 0) target = unit
  if (layout === 'custom') {
    const s = (custom || '')
      .toUpperCase()
      .split('')
      .filter((c) => c === 'M' || c === 'F')
      .join('')
    if (s) return s
    layout = 'centered'
  }
  let unitMask: string
  if (layout === 'outer') {
    const left = Math.trunc(nm / 2)
    const right = nm - left
    unitMask = 'M'.repeat(left) + 'F'.repeat(nf) + 'M'.repeat(right)
  } else {
    const leftF = Math.trunc(nf / 2)
    const rightF = nf - leftF
    unitMask = 'F'.repeat(leftF) + 'M'.repeat(nm) + 'F'.repeat(rightF)
  }
  if (target === unit) return unitMask
  const copies = Math.trunc((target + unit - 1) / unit)
  return unitMask.repeat(copies).slice(0, target)
}

/**
 * Lateral left-edge of each planter row slot with `gapM` inserted at every
 * male/female boundary. Returns [lefts, passW] (bay_slot_lefts).
 */
function baySlotLefts(mask: string, rsM: number, gapM: number): [number[], number] {
  const n = mask.length
  if (n === 0) return [[], 0.0]
  const lefts = new Array<number>(n).fill(0.0)
  let x = 0.0
  for (let k = 1; k < n; k++) {
    x += rsM
    if (mask[k - 1] !== mask[k]) x += gapM
    lefts[k] = x
  }
  let passW = lefts[n - 1] + rsM
  if (mask[0] !== mask[n - 1]) passW += gapM
  return [lefts, passW]
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

type LA = [number, number] // (lateral, along) in the rotated metric frame

const EMPTY: CrewRouteResult = { route: [], totalM: 0 }

/**
 * Estimated crew driving route for a field. `shelters` are the already-computed
 * shelter positions (from `getTentPositions`) — pass them in; unlike the Python
 * this port never recomputes the grid itself (keeps the module dependency-free
 * and lets callers reuse the cached compute, as the old GUI always did).
 */
export function crewRoute(
  field: FieldDict,
  shelters: Array<{ lat: number; lng: number }>,
): CrewRouteResult {
  // Manually edited route wins (the _redraw_crews / cost-estimator short-circuit).
  const ov = field['crew_route_override']
  if (Array.isArray(ov) && ov.length >= 2) {
    try {
      const route: Array<[number, number]> = ov.map((p) => {
        const arr = p as [unknown, unknown]
        return [toFloat(arr[0]), toFloat(arr[1])]
      })
      let totalM = 0
      for (let i = 1; i < route.length; i++) {
        totalM += haversineAppM(route[i - 1][0], route[i - 1][1], route[i][0], route[i][1])
      }
      return { route, totalM }
    } catch {
      return { route: [], totalM: 0 }
    }
  }

  if (!shelters || shelters.length < 2) return { route: [], totalM: 0 }

  let plat: number
  let plon: number
  let rsM: number
  let nf: number
  let nm: number
  let totalRows: number
  try {
    plat = toFloat(field['PP_Latitude'])
    plon = toFloat(field['PP_Longitude'])
    rsM = toFloat(getOr(field, 'row_spacing_in', 22)) * 0.0254
    nf = Math.trunc(toFloat(getOr(field, 'num_female_rows', 8)))
    nm = Math.trunc(toFloat(getOr(field, 'num_male_rows', 2)))
    totalRows = Math.trunc(toFloat(getOr(field, 'total_rows', nf + nm)))
  } catch {
    return EMPTY
  }
  const layout = String(getOr(field, 'row_layout', 'centered'))
  const custom = String(getOr(field, 'custom_row_mask', ''))
  const cm = custom
    .toUpperCase()
    .split('')
    .filter((c) => c === 'M' || c === 'F')
    .join('')
  if (layout === 'custom' && cm) totalRows = cm.length
  const mask = resolveRowMask(nf, nm, layout, custom, totalRows)
  const runsFwd = mask ? maskRuns(mask, 'M') : []
  const maskRev = mask.split('').reverse().join('')
  const runsRev = mask ? maskRuns(maskRev, 'M') : []
  let gapM: number
  try {
    gapM = Math.max(0.0, toFloat(getOr(field, 'bay_gap_in', 0))) * 0.0254
  } catch {
    gapM = 0.0
  }
  const [leftsFwd, passW] = mask ? baySlotLefts(mask, rsM, gapM) : [[], 0.0]
  const [leftsRev] = mask ? baySlotLefts(maskRev, rsM, gapM) : [[], 0.0]
  if (runsFwd.length === 0 || passW <= 0) return EMPTY
  const half = passW / 2.0

  // `float(d.get('Planting_angle') or d.get('Spray_angle') or 0)` — deliberately
  // unguarded in the Python too (a non-numeric angle raises there as well).
  const angle = toFloat(
    truthy(field['Planting_angle'])
      ? field['Planting_angle']
      : truthy(field['Spray_angle'])
        ? field['Spray_angle']
        : 0,
  )
  const rot = ((pymod(180 - angle, 360) - 180) * Math.PI) / 180
  const cosR = Math.cos(rot)
  const sinR = Math.sin(rot)
  const ldx = cosR
  const ldy = sinR // lateral unit (across passes)
  const tdx = -sinR
  const tdy = cosR // travel unit (along passes)
  let bse: number
  let bsn: number
  try {
    bse = toFloat(getOr(field, 'bay_shift_e_m', 0))
    bsn = toFloat(getOr(field, 'bay_shift_n_m', 0))
  } catch {
    bse = 0.0
    bsn = 0.0
  }
  const latShift = bse * ldx + bsn * ldy
  const phase = truthy(field['pass_phase_swap']) ? 1 : 0

  const shEnu = latlonListToEnu(
    shelters.map((s) => [s.lat, s.lng] as [number, number]),
    plon,
    plat,
  )
  let maxR = 0
  for (const [e, n] of shEnu) {
    const d = Math.hypot(e, n)
    if (d > maxR) maxR = d
  }
  maxR *= 1.1
  const nPass = Math.trunc(maxR / passW) + 2

  // Male-bay CENTRE laterals (centre of each M run in each pass), mirroring the
  // x1..x2 band _redraw_bays draws; the snake also flips the mask on odd passes.
  // A male run (s,e) spans lefts[s] .. lefts[e-1]+rs_m; its centre is the
  // midpoint (gap-aware via bay_slot_lefts).
  const centre = (i: number, s: number, e: number): number => {
    const leftsI = pymod(i + phase, 2) === 0 ? leftsFwd : leftsRev
    return pyRound((i + 0.5) * passW + latShift + (leftsI[s] + leftsI[e - 1] + rsM) / 2.0 - half, 3)
  }
  const centreSet = new Set<number>()
  for (let i = -nPass; i <= nPass; i++) {
    const runsI = pymod(i + phase, 2) === 0 ? runsFwd : runsRev
    for (const [s, e] of runsI) centreSet.add(centre(i, s, e))
  }
  const centres = Array.from(centreSet).sort((a, b) => a - b)
  if (centres.length === 0) return EMPTY

  // Group shelters by nearest bay-centre lateral.
  const cols = new Map<number, Array<[number, number]>>() // centre -> [(shelter lateral, along)]
  for (const [e, n] of shEnu) {
    const latV = e * ldx + n * ldy
    const along = e * tdx + n * tdy
    const j = bisectLeft(centres, latV)
    let best: number | null = null
    let bestD: number | null = null
    for (const k of [j - 1, j, j + 1]) {
      if (k >= 0 && k < centres.length) {
        const d = Math.abs(centres[k] - latV)
        if (bestD === null || d < bestD) {
          bestD = d
          best = centres[k]
        }
      }
    }
    if (best === null) continue // unreachable when centres is non-empty
    if (!cols.has(best)) cols.set(best, [])
    cols.get(best)!.push([latV, along])
  }

  const used = Array.from(cols.keys()).sort((a, b) => a - b) // bay-centre laterals with shelters

  // Boundary in the rotated (lateral, along) frame, if the field has one. A crew
  // never crosses the standing crop: each pass is driven the FULL length to the
  // field boundary, then they follow the boundary (headland) to the next pass.
  let bndLa: LA[] | null = null
  const bp = (getOr(field, 'boundary_polygon', []) as unknown[]) || []
  if (Array.isArray(bp) && bp.length >= 3) {
    try {
      const bndEnu = latlonListToEnu(
        bp.map((p) => {
          const arr = p as [unknown, unknown]
          return [toFloat(arr[0]), toFloat(arr[1])] as [number, number]
        }),
        plon,
        plat,
      )
      bndLa = bndEnu.map(([e, n]) => [e * ldx + n * ldy, e * tdx + n * tdy] as LA)
    } catch {
      bndLa = null
    }
  }

  let routeLa: LA[] = [] // (lateral, along) waypoints

  if (bndLa && bndLa.length >= 3) {
    const bnd = bndLa
    const m = bnd.length

    // along-values + boundary-edge index where the vertical line lateral=cx
    // crosses the boundary; sorted [(along, edge), ...].
    const clipCol = (cx: number): Array<[number, number]> => {
      const cr: Array<[number, number]> = []
      for (let k = 0; k < m; k++) {
        const [x1, y1] = bnd[k]
        const [x2, y2] = bnd[(k + 1) % m]
        if (x1 < cx !== x2 < cx) {
          const t = (cx - x1) / (x2 - x1)
          cr.push([y1 + t * (y2 - y1), k])
        }
      }
      cr.sort((a, b) => a[0] - b[0] || a[1] - b[1])
      return cr
    }

    // Boundary vertices strictly between boundary points p and q (on edges
    // eP / eQ) — the SHORTER of the two perimeter arcs, i.e. the headland the
    // crew drives between passes.
    const arc = (p: LA, eP: number, q: LA, eQ: number): LA[] => {
      if (eP === eQ) return []
      const collect = (step: number): LA[] => {
        const verts: LA[] = []
        let idx = step > 0 ? pymod(eP + 1, m) : eP
        const target = step > 0 ? eQ : pymod(eQ + 1, m)
        for (let i = 0; i <= m; i++) {
          verts.push(bnd[idx])
          if (idx === target) break
          idx = pymod(idx + step, m)
        }
        return verts
      }
      const plen = (verts: LA[]): number => {
        const pts = [p, ...verts, q]
        let s = 0
        for (let i = 1; i < pts.length; i++) {
          s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
        }
        return s
      }
      const fwd = collect(1)
      const bwd = collect(-1)
      return plen(fwd) <= plen(bwd) ? fwd : bwd
    }

    // Closest point on the boundary to pt + the edge it's on.
    const nearestBnd = (pt: LA): [LA, number] => {
      const [px, py] = pt
      let best: LA = bnd[0]
      let bestD: number | null = null
      let bestE = 0
      for (let k = 0; k < m; k++) {
        const [x1, y1] = bnd[k]
        const [x2, y2] = bnd[(k + 1) % m]
        const dx = x2 - x1
        const dy = y2 - y1
        const seg = dx * dx + dy * dy
        let cx: number
        let cy: number
        if (seg > 0) {
          const t = Math.max(0.0, Math.min(1.0, ((px - x1) * dx + (py - y1) * dy) / seg))
          cx = x1 + t * dx
          cy = y1 + t * dy
        } else {
          cx = x1
          cy = y1
        }
        const d = (px - cx) ** 2 + (py - cy) ** 2
        if (bestD === null || d < bestD) {
          bestD = d
          best = [cx, cy]
          bestE = k
        }
      }
      return [best, bestE]
    }

    // Each column's IN-FIELD interval(s) that actually contain shelters. A canal
    // (or any concavity) can split a column into two separate in-field spans; we
    // keep only the span(s) with shelters and NEVER bridge the gap between them,
    // so a pass is clipped flush to the boundary and the crew is never routed
    // across the boundary or the canal.
    type Seg = [number, number, number, number] // aLo, eLo, aHi, eHi
    const shelterIntervals = (cxVal: number, alongs: number[]): Seg[] => {
      const cr = clipCol(cxVal) // crossings sorted by along
      const out: Seg[] = []
      for (let k = 0; k + 1 < cr.length; k += 2) {
        const [aLo, eLo] = cr[k]
        const [aHi, eHi] = cr[k + 1]
        if (alongs.some((a) => aLo - 2.0 <= a && a <= aHi + 2.0)) {
          out.push([aLo, eLo, aHi, eHi])
        }
      }
      return out
    }

    const colSegs = new Map<number, [number, Seg[]]>() // cx -> (draw lateral, segs)
    let maxRegions = 0
    for (const cx of used) {
      const members = cols.get(cx)!
      const alongs = members.map(([, a]) => a).sort((a, b) => a - b)
      let cxDraw = cx
      let segsHere = shelterIntervals(cx, alongs)
      if (segsHere.length === 0) {
        // Bay centre is off the field at this edge column — fall back to the
        // mean shelter lateral, which is always inside.
        cxDraw = members.reduce((s, [lv]) => s + lv, 0) / members.length
        segsHere = shelterIntervals(cxDraw, alongs)
      }
      if (segsHere.length === 0) continue
      colSegs.set(cx, [cxDraw, segsHere])
      maxRegions = Math.max(maxRegions, segsHere.length)
    }

    // Snake region by region (interval index, low→high along): the crew works
    // one side of any canal/concavity completely before the next, and every hop
    // between passes follows the boundary headland (via arc) — so the route
    // never crosses the crop or the canal. Each pass is entered from the end
    // nearest the previous exit to keep the headland hops short.
    let prev: LA | null = null
    let prevE: number | null = null
    let firstEntry: LA | null = null
    let firstE: number | null = null
    const ordered = used.filter((cx) => colSegs.has(cx))
    for (let r = 0; r < maxRegions; r++) {
      let colsR = ordered.filter((cx) => r < colSegs.get(cx)![1].length)
      if (r % 2 === 1) colsR = colsR.slice().reverse() // serpentine across regions too
      for (const cx of colsR) {
        const [cxDraw, segsHere] = colSegs.get(cx)!
        const [aLo, eLo, aHi, eHi] = segsHere[r]
        let entry: LA
        let eEn: number
        let exit: LA
        let eEx: number
        if (prev === null || Math.abs(aLo - prev[1]) <= Math.abs(aHi - prev[1])) {
          entry = [cxDraw, aLo]
          eEn = eLo
          exit = [cxDraw, aHi]
          eEx = eHi
        } else {
          entry = [cxDraw, aHi]
          eEn = eHi
          exit = [cxDraw, aLo]
          eEx = eLo
        }
        if (prev !== null) {
          routeLa.push(...arc(prev, prevE!, entry, eEn)) // along the headland
        }
        if (firstEntry === null) {
          firstEntry = entry
          firstE = eEn
        }
        routeLa.push(entry)
        routeLa.push(exit)
        prev = exit
        prevE = eEx
      }
    }

    // If a parking pin is placed, the crew starts AND ends there: drive from
    // parking to the boundary, ALONG the boundary to the first pass, work the
    // field, then back along the boundary to parking (still never crossing the
    // crop).
    const park = field['parking_pin']
    if (truthy(park) && routeLa.length > 0 && firstEntry !== null) {
      try {
        const parkArr = park as [unknown, unknown]
        const [pe2, pn2] = latlonListToEnu([[toFloat(parkArr[0]), toFloat(parkArr[1])]], plon, plat)[0]
        const parkLa: LA = [pe2 * ldx + pn2 * ldy, pe2 * tdx + pn2 * tdy]
        const [pb, ePb] = nearestBnd(parkLa)
        const pre: LA[] = [parkLa, pb, ...arc(pb, ePb, firstEntry, firstE!)]
        const suf: LA[] = [...arc(prev!, prevE!, pb, ePb), pb, parkLa]
        routeLa = [...pre, ...routeLa, ...suf]
      } catch {
        /* ignore a malformed parking pin, like the Python */
      }
    }
  }

  if (routeLa.length === 0) {
    // No boundary (or clip failed): straight-connector snake over the shelter
    // extent of each column (best effort when there's nothing to clip to).
    let direction = 1
    for (const cx of used) {
      const alos = cols
        .get(cx)!
        .map(([, a]) => a)
        .sort((a, b) => a - b)
      const a0 = alos[0] - rsM
      const a1 = alos[alos.length - 1] + rsM
      if (direction > 0) routeLa.push([cx, a0], [cx, a1])
      else routeLa.push([cx, a1], [cx, a0])
      direction = -direction
    }
  }

  let totalM = 0
  for (let i = 1; i < routeLa.length; i++) {
    totalM += Math.hypot(routeLa[i][0] - routeLa[i - 1][0], routeLa[i][1] - routeLa[i - 1][1])
  }

  const [pe, pn] = fromLonLat(plon, plat, plon)
  const routeLl: Array<[number, number]> = []
  for (const [cx, along] of routeLa) {
    const e = cx * ldx + along * tdx
    const n = cx * ldy + along * tdy
    const [lon2, lat2] = toLonLat(pe + e, pn + n, plon)
    routeLl.push([lat2, lon2])
  }

  return { route: routeLl, totalM }
}
