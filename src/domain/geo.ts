/**
 * Geodesy helpers for the Shelter Maps section. Pure functions.
 * Target home for the port of `utmish.py` (ENU conversion) and the reusable
 * bits of `maketentgrid.py`.
 */

export interface LngLat {
  lng: number
  lat: number
}

const R = 6_371_000 // Earth radius, metres
const toRad = (deg: number) => (deg * Math.PI) / 180

/** Great-circle distance between two points, in metres (haversine). */
export function haversineMeters(a: LngLat, b: LngLat): number {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
