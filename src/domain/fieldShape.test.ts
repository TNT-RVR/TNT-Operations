import { describe, it, expect } from 'vitest'
import { inferFieldShape, convexHull, simplify, fitCircle } from './fieldShape'
import type { SamplePoint } from './returnsMap'

const M_PER_LAT = 111_320
const LAT0 = 49.83
const LNG0 = -111.6
const M_PER_LNG = 111_320 * Math.cos((LAT0 * Math.PI) / 180)

/** Point at (x, y) metres from the origin. */
const at = (x: number, y: number): SamplePoint => ({
  lat: LAT0 + y / M_PER_LAT,
  lng: LNG0 + x / M_PER_LNG,
  value: 5,
})

/** Blocks filling a disc of radius R, on a lattice. */
function disc(R: number, step = 40): SamplePoint[] {
  const out: SamplePoint[] = []
  for (let x = -R; x <= R; x += step) {
    for (let y = -R; y <= R; y += step) {
      if (x * x + y * y <= R * R) out.push(at(x, y))
    }
  }
  return out
}

/** Blocks filling a square of side S. */
function square(S: number, step = 40): SamplePoint[] {
  const out: SamplePoint[] = []
  for (let x = -S / 2; x <= S / 2; x += step) {
    for (let y = -S / 2; y <= S / 2; y += step) out.push(at(x, y))
  }
  return out
}

describe('convexHull', () => {
  it('finds the corners of a square, ignoring interior points', () => {
    const h = convexHull([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [5, 5],
    ])
    expect(h).toHaveLength(4)
    expect(h).not.toContainEqual([5, 5])
  })

  it('passes through short inputs unchanged', () => {
    expect(convexHull([[0, 0]])).toHaveLength(1)
    expect(convexHull([])).toHaveLength(0)
  })
})

describe('simplify', () => {
  it('collapses a straight run to its endpoints', () => {
    const line: Array<[number, number]> = [
      [0, 0],
      [1, 0.1],
      [2, 0],
      [3, 0.1],
      [4, 0],
    ]
    expect(simplify(line, 1)).toEqual([
      [0, 0],
      [4, 0],
    ])
  })

  it('keeps a genuine corner', () => {
    const bend: Array<[number, number]> = [
      [0, 0],
      [5, 0],
      [5, 5],
    ]
    expect(simplify(bend, 1)).toHaveLength(3)
  })
})

describe('inferFieldShape', () => {
  it('recognises a pivot as a circle', () => {
    const s = inferFieldShape(disc(400))!
    expect(s.kind).toBe('circle')
    // Radius covers the outermost block plus the buffer.
    expect(s.radiusM!).toBeGreaterThan(400)
    expect(s.radiusM!).toBeLessThan(480)
    expect(s.field.Radius).toBeDefined()
    expect(s.field.boundary_polygon).toBeUndefined()
  })

  it('centres the circle on the field, not on wherever blocks are densest', () => {
    const s = inferFieldShape(disc(400))!
    expect(s.centre.lat).toBeCloseTo(LAT0, 3)
    expect(s.centre.lng).toBeCloseTo(LNG0, 3)
  })

  it('recognises a square field as a polygon with straight sides', () => {
    const s = inferFieldShape(square(600))!
    expect(s.kind).toBe('polygon')
    // Four corners — a hull of dozens of vertices simplified to the real shape.
    expect(s.corners).toBeGreaterThanOrEqual(4)
    expect(s.corners).toBeLessThanOrEqual(6)
    expect(s.field.boundary_polygon).toBeDefined()
  })

  it('recognises an L-shaped field as a polygon', () => {
    // Concave fields exist; the fit must not call this a circle.
    const l = [...square(400).filter((p) => !(p.lat > LAT0 && p.lng > LNG0))]
    expect(inferFieldShape(l)!.kind).toBe('polygon')
  })

  it('does not invent a shape from too few blocks', () => {
    // An outline fitted to three points would be fiction.
    expect(inferFieldShape(disc(400).slice(0, 5))).toBeNull()
    expect(inferFieldShape([])).toBeNull()
  })

  it('encloses every block it was given', () => {
    // Whatever shape is chosen, no block may fall outside the drawn outline.
    const pts = disc(400)
    const s = inferFieldShape(pts)!
    const maxD = Math.max(
      ...pts.map((p) =>
        Math.hypot((p.lng - s.centre.lng) * M_PER_LNG, (p.lat - s.centre.lat) * M_PER_LAT),
      ),
    )
    expect(s.radiusM!).toBeGreaterThanOrEqual(maxD)
  })

  it('is not fooled into a circle by a slightly irregular polygon', () => {
    // A quarter-section with one clipped corner is still a straight-edged field.
    const clipped = square(600).filter((p) => !(p.lat > LAT0 + 0.002 && p.lng > LNG0 + 0.002))
    expect(inferFieldShape(clipped)!.kind).toBe('polygon')
  })
})

describe('fitCircle', () => {
  it('recovers a known circle', () => {
    const pts: Array<[number, number]> = []
    for (let a = 0; a < Math.PI * 2; a += 0.3) pts.push([100 + 250 * Math.cos(a), -50 + 250 * Math.sin(a)])
    const f = fitCircle(pts)!
    expect(f.cx).toBeCloseTo(100, 3)
    expect(f.cy).toBeCloseTo(-50, 3)
    expect(f.r).toBeCloseTo(250, 3)
  })

  it('returns null for collinear points', () => {
    expect(
      fitCircle([
        [0, 0],
        [1, 1],
        [2, 2],
      ]),
    ).toBeNull()
  })

  it('centres on the field even when blocks are lopsided', () => {
    // Twice as many blocks on the east side. A centroid drifts that way; a
    // proper fit does not, and the drawn circle stays on the field.
    const pts: Array<[number, number]> = []
    for (let a = -1.2; a < 1.2; a += 0.1) pts.push([300 * Math.cos(a), 300 * Math.sin(a)])
    for (let a = 2; a < 4.2; a += 0.3) pts.push([300 * Math.cos(a), 300 * Math.sin(a)])
    const f = fitCircle(pts)!
    expect(Math.hypot(f.cx, f.cy)).toBeLessThan(15)
    expect(f.r).toBeCloseTo(300, 0)
  })
})

describe('fitted circle size', () => {
  it('is not inflated by one block sitting proud', () => {
    const clean = disc(400)
    const withStraggler = [...clean, at(470, 0)]
    const a = inferFieldShape(clean)!
    const b = inferFieldShape(withStraggler)!
    // The straggler may extend the circle, but only to cover it — not by
    // dragging the centre and the radius together.
    expect(b.radiusM! - a.radiusM!).toBeLessThan(90)
    expect(b.kind).toBe('circle')
  })
})
