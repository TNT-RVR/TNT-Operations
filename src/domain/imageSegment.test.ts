import { describe, it, expect } from 'vitest'
import { growRegion, fillHoles, traceOutline } from './imageSegment'

const W = 120
const H = 120

/** Build an RGBA image from a per-pixel colour function. */
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

const CROP: [number, number, number] = [80, 140, 60] // green field
const SOIL: [number, number, number] = [150, 120, 90] // brown surroundings

/** A green disc of radius R centred in a brown image. */
const discImage = (R: number, noise = 0) =>
  image((x, y) => {
    const inside = (x - W / 2) ** 2 + (y - H / 2) ** 2 <= R * R
    const base = inside ? CROP : SOIL
    if (!noise) return base
    const j = (((x * 7 + y * 13) % 11) - 5) * noise
    return [base[0] + j, base[1] + j, base[2] + j]
  })

describe('growRegion', () => {
  it('claims the field and nothing else', () => {
    const data = discImage(40)
    const r = growRegion(data, W, H, [[60, 60]])!
    expect(r).not.toBeNull()
    // A disc of radius 40 in a 120x120 image is about 35% of it.
    expect(r.fraction).toBeGreaterThan(0.3)
    expect(r.fraction).toBeLessThan(0.4)
    // Centre claimed, corner not.
    expect(r.mask[60 * W + 60]).toBe(1)
    expect(r.mask[0]).toBe(0)
  })

  it('copes with noisy imagery', () => {
    const r = growRegion(discImage(40, 3), W, H, [[60, 60]])!
    expect(r.fraction).toBeGreaterThan(0.3)
    expect(r.fraction).toBeLessThan(0.4)
  })

  it('uses the MEDIAN seed colour, so one bad block cannot mislead it', () => {
    // A block sitting on a track: its pixel is soil-coloured. A mean would be
    // dragged towards soil and the region would spread into the surroundings.
    const data = discImage(40)
    const seeds: Array<[number, number]> = [
      [60, 60],
      [55, 62],
      [65, 58],
      [5, 5], // this one is on soil
    ]
    const r = growRegion(data, W, H, seeds)!
    expect(r.seedColour[1]).toBeGreaterThan(120) // still green
    expect(r.fraction).toBeLessThan(0.45)
  })

  it('refuses a result that bled across the whole image', () => {
    // Uniform image: everything matches, so the answer is meaningless.
    const flat = image(() => CROP)
    expect(growRegion(flat, W, H, [[60, 60]], { maxFraction: 0.9 })).toBeNull()
  })

  it('refuses a result that never spread', () => {
    // Noisy imagery plus a tolerance too tight to cross it: the region stalls
    // at a handful of pixels, which is not an outline.
    const data = discImage(40, 6)
    expect(growRegion(data, W, H, [[60, 60]], { tolerance: 1, minFraction: 0.01 })).toBeNull()
  })

  it('handles seeds outside the image, and no seeds', () => {
    const data = discImage(40)
    expect(growRegion(data, W, H, [[-5, -5]])).toBeNull()
    expect(growRegion(data, W, H, [])).toBeNull()
  })
})

describe('fillHoles', () => {
  it('fills an enclosed gap but leaves the outside alone', () => {
    // A field with a dugout in the middle: enclosed, so part of the field.
    const data = image((x, y) => {
      const inField = (x - W / 2) ** 2 + (y - H / 2) ** 2 <= 40 * 40
      const inHole = (x - W / 2) ** 2 + (y - H / 2) ** 2 <= 8 * 8
      return inField && !inHole ? CROP : SOIL
    })
    const grown = growRegion(data, W, H, [[60, 45]])!
    expect(grown.mask[60 * W + 60]).toBe(0) // hole not claimed by the grow
    const filled = fillHoles(grown.mask, W, H)
    expect(filled[60 * W + 60]).toBe(1) // now filled
    expect(filled[0]).toBe(0) // outside still outside
  })
})

describe('traceOutline', () => {
  it('walks the boundary of a disc', () => {
    const grown = growRegion(discImage(40), W, H, [[60, 60]])!
    const outline = traceOutline(fillHoles(grown.mask, W, H), W, H)
    expect(outline.length).toBeGreaterThan(50)
    // Every traced point should sit near the disc's radius.
    for (const [x, y] of outline) {
      const d = Math.hypot(x - W / 2, y - H / 2)
      expect(d).toBeGreaterThan(36)
      expect(d).toBeLessThan(44)
    }
  })

  it('returns nothing for an empty mask', () => {
    expect(traceOutline(new Uint8Array(W * H), W, H)).toEqual([])
  })

  it('terminates on a single isolated pixel', () => {
    // A malformed mask must not spin forever.
    const m = new Uint8Array(W * H)
    m[60 * W + 60] = 1
    expect(traceOutline(m, W, H).length).toBeLessThan(10)
  })
})
