import { describe, it, expect } from 'vitest'
import { rowGuideLines, type LngLat } from './rowGuides'

const M_PER_DEG_LAT = 111_320
const mPerDegLng = (lat: number) => M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180)

/** Metres between two points, for asserting on distances rather than degrees. */
const distM = (a: [number, number], b: [number, number]) => {
  const latMid = (a[1] + b[1]) / 2
  return Math.hypot((b[0] - a[0]) * mPerDegLng(latMid), (b[1] - a[1]) * M_PER_DEG_LAT)
}

/** A west-to-east row of `n` pins, 10 m apart, at latitude 49.83. */
const eastRow = (lat: number, n: number, startLng = -111.6): LngLat[] =>
  Array.from({ length: n }, (_, i) => ({ lat, lng: startLng + (i * 10) / mPerDegLng(lat) }))

describe('rowGuideLines', () => {
  it('draws one line per row', () => {
    const positions = [...eastRow(49.83, 3), ...eastRow(49.831, 3)]
    const rows = [0, 0, 0, 1, 1, 1]
    const lines = rowGuideLines(positions, rows)
    expect(lines.map((l) => l.row)).toEqual([0, 1])
  })

  it('extends past the end pins by the distance asked for', () => {
    // The whole point: the line has to reach past the boundary, because that
    // is where someone decides which row to turn down.
    const positions = eastRow(49.83, 3)
    const [line] = rowGuideLines(positions, [0, 0, 0], 40)
    const first = positions[0]
    const last = positions[2]
    expect(distM(line.coordinates[0], [first.lng, first.lat])).toBeCloseTo(40, 0)
    expect(distM(line.coordinates[1], [last.lng, last.lat])).toBeCloseTo(40, 0)
  })

  it('keeps the row direction', () => {
    // A due-east row must extend due east, not drift north.
    const [line] = rowGuideLines(eastRow(49.83, 4), [0, 0, 0, 0], 25)
    expect(line.coordinates[0][1]).toBeCloseTo(49.83, 6)
    expect(line.coordinates[1][1]).toBeCloseTo(49.83, 6)
    expect(line.coordinates[0][0]).toBeLessThan(line.coordinates[1][0])
  })

  it('extends the same DISTANCE at any latitude, not the same degrees', () => {
    // A degree of longitude is 30% shorter at 60° than at 49°. Extending in
    // degrees would make northern rows stick out further on the ground.
    const south = rowGuideLines(eastRow(49.83, 2), [0, 0], 40)[0]
    const north = rowGuideLines(eastRow(60.0, 2), [0, 0], 40)[0]
    const southEnd = distM(south.coordinates[1], [
      south.coordinates[1][0] - (40 / mPerDegLng(49.83)),
      49.83,
    ])
    expect(southEnd).toBeCloseTo(40, 0)
    // Different degree spans, same metres.
    const southSpanDeg = south.coordinates[1][0] - south.coordinates[0][0]
    const northSpanDeg = north.coordinates[1][0] - north.coordinates[0][0]
    expect(northSpanDeg).toBeGreaterThan(southSpanDeg)
  })

  it('skips a row with one pin rather than guessing its direction', () => {
    // One point has no direction. A guide line pointing somewhere nobody
    // measured is worse than no line at all.
    const lines = rowGuideLines([...eastRow(49.83, 2), { lat: 49.84, lng: -111.6 }], [0, 0, 1])
    expect(lines.map((l) => l.row)).toEqual([0])
  })

  it('uses the row ends, so GPS noise between neighbours cannot swing the line', () => {
    // Middle pin knocked 3 m north. Taking direction from consecutive pins
    // would tilt the line; taking it from the extremes barely moves.
    const clean = eastRow(49.83, 3)
    const noisy = [clean[0], { ...clean[1], lat: clean[1].lat + 3 / M_PER_DEG_LAT }, clean[2]]
    const a = rowGuideLines(clean, [0, 0, 0], 40)[0]
    const b = rowGuideLines(noisy, [0, 0, 0], 40)[0]
    expect(b.coordinates[0][1]).toBeCloseTo(a.coordinates[0][1], 6)
  })

  it('ignores unusable coordinates instead of drawing through them', () => {
    const positions = [...eastRow(49.83, 2), { lat: NaN, lng: -111.6 }]
    const lines = rowGuideLines(positions, [0, 0, 0], 40)
    expect(lines).toHaveLength(1)
    expect(lines[0].coordinates.every(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat))).toBe(
      true,
    )
  })

  it('returns nothing when the inputs do not line up', () => {
    expect(rowGuideLines([], [])).toEqual([])
    expect(rowGuideLines(eastRow(49.83, 2), [0])).toEqual([])
  })
})
