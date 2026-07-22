/**
 * Geodesy helpers for the Shelter Maps section. Pure functions.
 *
 * Ported from the old beetent-maps app:
 *   - `haversineMeters` — great-circle distance.
 *   - `fromLonLat` / `toLonLat` — the "UTM-ish" transverse-Mercator projection
 *     from `utmish.py`. It is a standard UTM forward/inverse EXCEPT the grid is
 *     centred on a caller-supplied `centralLongitude` (the field's pivot) rather
 *     than a fixed 6° zone, which minimises distortion at the worksite.
 *   - `latlonListToEnu` — project a lat/lon ring to local East/North metres
 *     relative to a pivot (from `latlon_list_to_enu` in `maketentgrid.py`).
 *
 * These MUST reproduce the Python bit-for-bit (same constants, same operation
 * order) so the shelter-grid golden tests match — do not "clean up" the algebra.
 */

export interface LngLat {
  lng: number
  lat: number
}

const R_HAVERSINE = 6_371_000 // Earth radius, metres
const toRad = (deg: number) => (deg * Math.PI) / 180

/** Great-circle distance between two points, in metres (haversine). */
export function haversineMeters(a: LngLat, b: LngLat): number {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R_HAVERSINE * Math.asin(Math.sqrt(h))
}

// ── UTM-ish projection constants (verbatim from utmish.py) ────────────────────
const K0 = 0.9996

const E = 0.00669438
const E2 = E * E
const E3 = E2 * E
const E_P2 = E / (1.0 - E)

const SQRT_E = Math.sqrt(1 - E)
const _E = (1 - SQRT_E) / (1 + SQRT_E)
const _E2 = _E * _E
const _E3 = _E2 * _E
const _E4 = _E3 * _E
const _E5 = _E4 * _E

const M1 = 1 - E / 4 - (3 * E2) / 64 - (5 * E3) / 256
const M2 = (3 * E) / 8 + (3 * E2) / 32 + (45 * E3) / 1024
const M3 = (15 * E2) / 256 + (45 * E3) / 1024
const M4 = (35 * E3) / 3072

const P2 = (3 / 2) * _E - (27 / 32) * _E3 + (269 / 512) * _E5
const P3 = (21 / 16) * _E2 - (55 / 32) * _E4
const P4 = (151 / 96) * _E3 - (417 / 128) * _E5
const P5 = (1097 / 512) * _E4

const R_UTM = 6378137

const radians = (deg: number) => (deg * Math.PI) / 180
const degrees = (rad: number) => (rad * 180) / Math.PI

/**
 * Lon/lat → UTM-ish (easting, northing) in metres, on a grid centred on
 * `centralLongitude`. Northern hemisphere only (all TNT fields are ~49–55°N),
 * matching the scalar path of `utmish.from_lonlat`.
 */
export function fromLonLat(
  longitude: number,
  latitude: number,
  centralLongitude: number,
): [number, number] {
  const latRad = radians(latitude)
  const latSin = Math.sin(latRad)
  const latCos = Math.cos(latRad)

  const latTan = latSin / latCos
  const latTan2 = latTan * latTan
  const latTan4 = latTan2 * latTan2

  const lonRad = radians(longitude)
  const centralLonRad = radians(centralLongitude)

  const n = R_UTM / Math.sqrt(1 - E * latSin ** 2)
  const c = E_P2 * latCos ** 2

  const a = latCos * (lonRad - centralLonRad)
  const a2 = a * a
  const a3 = a2 * a
  const a4 = a3 * a
  const a5 = a4 * a
  const a6 = a5 * a

  const m =
    R_UTM *
    (M1 * latRad - M2 * Math.sin(2 * latRad) + M3 * Math.sin(4 * latRad) - M4 * Math.sin(6 * latRad))

  const easting =
    K0 *
      n *
      (a + (a3 / 6) * (1 - latTan2 + c) + (a5 / 120) * (5 - 18 * latTan2 + latTan4 + 72 * c - 58 * E_P2)) +
    500000

  const northing =
    K0 *
    (m +
      n *
        latTan *
        (a2 / 2 +
          (a4 / 24) * (5 - latTan2 + 9 * c + 4 * c ** 2) +
          (a6 / 720) * (61 - 58 * latTan2 + latTan4 + 600 * c - 330 * E_P2)))

  return [easting, northing]
}

/**
 * UTM-ish (easting, northing) → [lon, lat], inverse of {@link fromLonLat}, on a
 * grid centred on `centralLongitude`. Mirrors `utmish.to_lonlat` (returns
 * [lon, lat], northern hemisphere).
 */
export function toLonLat(
  easting: number,
  northing: number,
  centralLongitude: number,
): [number, number] {
  const x = easting - 500000
  const y = northing

  const m = y / K0
  const mu = m / (R_UTM * M1)

  const pRad =
    mu +
    P2 * Math.sin(2 * mu) +
    P3 * Math.sin(4 * mu) +
    P4 * Math.sin(6 * mu) +
    P5 * Math.sin(8 * mu)

  const pSin = Math.sin(pRad)
  const pSin2 = pSin * pSin

  const pCos = Math.cos(pRad)

  const pTan = pSin / pCos
  const pTan2 = pTan * pTan
  const pTan4 = pTan2 * pTan2

  const epSin = 1 - E * pSin2
  const epSinSqrt = Math.sqrt(1 - E * pSin2)

  const n = R_UTM / epSinSqrt
  const r = (1 - E) / epSin

  const c = _E * pCos ** 2
  const c2 = c * c

  const d = x / (n * K0)
  const d2 = d * d
  const d3 = d2 * d
  const d4 = d3 * d
  const d5 = d4 * d
  const d6 = d5 * d

  const latitude =
    pRad -
    (pTan / r) * (d2 / 2 - (d4 / 24) * (5 + 3 * pTan2 + 10 * c - 4 * c2 - 9 * E_P2)) +
    (d6 / 720) * (61 + 90 * pTan2 + 298 * c + 45 * pTan4 - 252 * E_P2 - 3 * c2)

  const longitude =
    (d - (d3 / 6) * (1 + 2 * pTan2 + c) + (d5 / 120) * (5 - 2 * c + 28 * pTan2 - 3 * c2 + 8 * E_P2 + 24 * pTan4)) /
    pCos

  return [degrees(longitude) + centralLongitude, degrees(latitude)]
}

/**
 * Convert a list of [lat, lon] points to [east, north] metres relative to the
 * pivot. Mirrors `latlon_list_to_enu(latlon_list, pivot_lon, pivot_lat)`.
 */
export function latlonListToEnu(
  latlonList: Array<[number, number]>,
  pivotLon: number,
  pivotLat: number,
): Array<[number, number]> {
  const [pe, pn] = fromLonLat(pivotLon, pivotLat, pivotLon)
  return latlonList.map(([lat, lon]) => {
    const [e, n] = fromLonLat(lon, lat, pivotLon)
    return [e - pe, n - pn]
  })
}
