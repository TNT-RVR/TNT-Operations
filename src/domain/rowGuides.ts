/**
 * Row guide lines — each shelter row, drawn past the edge of the field.
 *
 * A crew approaching from the headland has to pick the right row to turn down.
 * The shelter pins say where the row IS, but they stop at the field boundary,
 * which is exactly where the decision gets made — you are looking at the end of
 * a row from outside it. Extending the line past the edge puts the answer in
 * front of the vehicle before it turns.
 *
 * Pure geometry: no map, no React. The extension is metres on the ground,
 * converted per row, so a row at the top of the field and one at the bottom
 * stick out by the same distance rather than the same number of degrees.
 */

export interface LngLat {
  lat: number
  lng: number
}

const M_PER_DEG_LAT = 111_320

/** Metres per degree of longitude at this latitude — shrinks toward the poles. */
const mPerDegLng = (lat: number) => M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180)

/**
 * One line per row, running through its pins and extending `extendM` past the
 * outermost pin at each end.
 *
 * Rows with a single pin get no line: one point has no direction, and guessing
 * one from a neighbouring row would draw a guide that points somewhere nobody
 * measured. A row nobody can drive is better than a line that lies.
 */
export function rowGuideLines(
  positions: LngLat[],
  rows: number[],
  extendM = 40,
): Array<{ row: number; coordinates: Array<[number, number]> }> {
  if (positions.length === 0 || positions.length !== rows.length) return []

  const byRow = new Map<number, LngLat[]>()
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i]
    if (!Number.isFinite(p?.lat) || !Number.isFinite(p?.lng)) continue
    const list = byRow.get(rows[i]) ?? []
    list.push(p)
    byRow.set(rows[i], list)
  }

  const out: Array<{ row: number; coordinates: Array<[number, number]> }> = []
  for (const [row, pins] of [...byRow.entries()].sort((a, b) => a[0] - b[0])) {
    if (pins.length < 2) continue

    // The row's direction, taken from its two extreme pins rather than
    // consecutive ones: adjacent shelters are metres apart, so a metre of GPS
    // noise between them would swing the line wildly, while the full length of
    // the row averages that out.
    const ends = extremes(pins)
    if (!ends) continue
    const [a, b] = ends

    const latMid = (a.lat + b.lat) / 2
    const dxM = (b.lng - a.lng) * mPerDegLng(latMid)
    const dyM = (b.lat - a.lat) * M_PER_DEG_LAT
    const len = Math.hypot(dxM, dyM)
    if (len < 1) continue

    const ux = dxM / len
    const uy = dyM / len
    const dLng = (ux * extendM) / mPerDegLng(latMid)
    const dLat = (uy * extendM) / M_PER_DEG_LAT

    out.push({
      row,
      coordinates: [
        [a.lng - dLng, a.lat - dLat],
        [b.lng + dLng, b.lat + dLat],
      ],
    })
  }
  return out
}

/** The two pins furthest apart in a row — its ends. */
function extremes(pins: LngLat[]): [LngLat, LngLat] | null {
  let best: [LngLat, LngLat] | null = null
  let bestD = -1
  for (let i = 0; i < pins.length; i++) {
    for (let j = i + 1; j < pins.length; j++) {
      const latMid = (pins[i].lat + pins[j].lat) / 2
      const dx = (pins[j].lng - pins[i].lng) * mPerDegLng(latMid)
      const dy = (pins[j].lat - pins[i].lat) * M_PER_DEG_LAT
      const d = dx * dx + dy * dy
      if (d > bestD) {
        bestD = d
        best = [pins[i], pins[j]]
      }
    }
  }
  return best
}
