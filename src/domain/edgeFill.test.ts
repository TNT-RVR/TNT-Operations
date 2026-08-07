import { describe, it, expect } from 'vitest'
import { blurLuma, gradientMagnitude, edgeMask, thickenEdges, fillWithinEdges } from './edgeFill'

const W = 160
const H = 160

function image(fn: (x: number, y: number) => [number, number, number]): Uint8ClampedArray {
  const d = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [r, g, b] = fn(x, y)
      const i = (y * W + x) * 4
      d[i] = r
      d[i + 1] = g
      d[i + 2] = b
      d[i + 3] = 255
    }
  }
  return d
}

const dist = (x: number, y: number, cx: number, cy: number) => Math.hypot(x - cx, y - cy)

/**
 * The case colour-matching could never handle: a field whose two halves look
 * completely different — green one side, burnt off the other — ringed by a
 * dark boundary, sitting in surroundings that resemble BOTH halves.
 */
const patchworkField = () =>
  image((x, y) => {
    const d = dist(x, y, 80, 80)
    if (Math.abs(d - 55) < 2) return [40, 35, 30] // the field's edge line
    if (d < 55) return x < 80 ? [70, 150, 60] : [170, 150, 90] // green | burnt
    // Outside: a patchwork that matches one half or the other.
    return (x + y) % 60 < 30 ? [75, 155, 65] : [165, 145, 85]
  })

const edgesOf = (data: Uint8ClampedArray, percentile = 0.9) =>
  thickenEdges(edgeMask(gradientMagnitude(blurLuma(data, W, H, 1), W, H), percentile), W, H, 1)

describe('blurLuma', () => {
  it('smooths without shifting the overall brightness', () => {
    const flat = image(() => [100, 100, 100])
    const b = blurLuma(flat, W, H, 2)
    for (let i = 0; i < b.length; i++) expect(b[i]).toBeCloseTo(100, 1)
  })

  it('suppresses fine texture like crop rows', () => {
    // One-pixel stripes: the texture inside a field, not its boundary.
    const striped = image((x) => (x % 2 ? [60, 60, 60] : [140, 140, 140]))
    const raw = blurLuma(striped, W, H, 0)
    const smooth = blurLuma(striped, W, H, 2)
    // Interior only: the blur clamps at the picture's border, which duplicates
    // edge pixels and exaggerates the spread there. That's an artefact of the
    // frame, not of the smoothing being measured.
    const spread = (a: Float32Array) => {
      let lo = Infinity
      let hi = -Infinity
      for (let y = 10; y < H - 10; y++) {
        for (let x = 10; x < W - 10; x++) {
          const v = a[y * W + x]
          if (v < lo) lo = v
          if (v > hi) hi = v
        }
      }
      return hi - lo
    }
    expect(spread(smooth)).toBeLessThan(spread(raw) / 2)
  })
})

describe('edgeMask', () => {
  it('marks the boundary and not the interior', () => {
    const e = edgesOf(patchworkField())
    // On the ring.
    expect(e[80 * W + Math.round(80 + 55)]).toBe(1)
    // Well inside, in each half.
    expect(e[80 * W + 60]).toBe(0)
    expect(e[80 * W + 100]).toBe(0)
  })

  it('marks nothing in a featureless image', () => {
    const flat = image(() => [120, 120, 120])
    const e = edgeMask(gradientMagnitude(blurLuma(flat, W, H, 1), W, H), 0.9)
    expect([...e].some(Boolean)).toBe(false)
  })
})

describe('fillWithinEdges', () => {
  const seeds: Array<[number, number]> = [
    [60, 80], // green half
    [100, 80], // burnt half
    [80, 60],
    [80, 100],
  ]

  it('fills a field whose halves look nothing alike', () => {
    // The whole point. Region-growing by colour either stops at the halfway
    // line or escapes into the surroundings; the edge is what matters.
    const r = fillWithinEdges(edgesOf(patchworkField()), W, H, seeds)!
    expect(r.failure).toBeUndefined()
    expect(r.mask[80 * W + 60]).toBe(1) // green half filled
    expect(r.mask[80 * W + 100]).toBe(1) // burnt half filled
  })

  it('stops at the boundary, even though outside looks like inside', () => {
    const r = fillWithinEdges(edgesOf(patchworkField()), W, H, seeds)!
    expect(r.mask[80 * W + 20]).toBe(0) // beyond the ring, to the west
    expect(r.mask[80 * W + 145]).toBe(0) // beyond the ring, to the east
    expect(r.mask[5 * W + 5]).toBe(0) // far corner
  })

  it('covers essentially the whole field', () => {
    const r = fillWithinEdges(edgesOf(patchworkField()), W, H, seeds)!
    let inside = 0
    let filled = 0
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        // Stop short of the rim: blurring widens the boundary before the
        // gradient is taken, so the outermost few pixels legitimately read as
        // edge. The question here is whether the BODY of the field fills.
        if (dist(x, y, 80, 80) >= 48) continue
        inside++
        if (r.mask[y * W + x]) filled++
      }
    }
    expect(filled / inside).toBeGreaterThan(0.98)
  })

  it('reports escaping rather than returning a wrong answer', () => {
    // No boundary at all: the fill has nothing to stop it.
    const blank = new Uint8Array(W * H)
    expect(fillWithinEdges(blank, W, H, seeds)!.failure).toBe('escaped')
  })

  it('reports getting stuck', () => {
    // Everything is an edge, so nothing can be filled.
    const solid = new Uint8Array(W * H).fill(1)
    expect(fillWithinEdges(solid, W, H, seeds)!.failure).toBe('stuck')
  })

  it('seeds even where a block sits on an edge pixel', () => {
    // A block on a track inside the field is still inside the field.
    const e = edgesOf(patchworkField())
    const onEdge: Array<[number, number]> = [[Math.round(80 + 55), 80]]
    expect(fillWithinEdges(e, W, H, onEdge)).not.toBeNull()
  })

  it('respects a distance leash', () => {
    const e = edgesOf(patchworkField())
    const reach = new Float32Array(W * H)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) reach[y * W + x] = dist(x, y, 80, 80)
    const r = fillWithinEdges(e, W, H, seeds, { reach, maxDistancePx: 20 })!
    expect(r.mask[80 * W + 68]).toBe(1) // within the leash
    expect(r.mask[80 * W + 45]).toBe(0) // beyond it
  })
})
