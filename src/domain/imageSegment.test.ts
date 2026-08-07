import { describe, it, expect } from 'vitest'
import { growRegion, fillHoles, traceOutline, distanceFrom, largestComponent, seedComponents, openMask } from './imageSegment'

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

  it('copes with noisy imagery when given room for it', () => {
    // Tolerance stated rather than inherited: this test is about noise, and
    // the default is deliberately tight to stop the region escaping a field.
    const r = growRegion(discImage(40, 3), W, H, [[60, 60]], { tolerance: 60 })!
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

  it('refuses a result that bled across the whole image, and says so', () => {
    // Uniform image: everything matches, so the answer is meaningless.
    const flat = image(() => CROP)
    expect(growRegion(flat, W, H, [[60, 60]], { maxFraction: 0.9 })!.failure).toBe('bled')
  })

  it('refuses a result that never spread, and says so', () => {
    // Noisy imagery plus a tolerance too tight to cross it: the region stalls
    // at a handful of pixels, which is not an outline.
    const data = discImage(40, 6)
    expect(growRegion(data, W, H, [[60, 60]], { tolerance: 1, minFraction: 0.01 })!.failure).toBe('never-spread')
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

describe('the distance leash', () => {
  /**
   * The real failure: a field beside a look-alike area joined to it. Colour
   * alone runs straight through and swallows the neighbour.
   */
  const twoFields = image((x, y) => {
    const inLeft = (x - 30) ** 2 + (y - 60) ** 2 <= 22 * 22
    const inRight = (x - 90) ** 2 + (y - 60) ** 2 <= 22 * 22
    // A track of the same colour joining them.
    const inBridge = y >= 57 && y <= 63 && x >= 30 && x <= 90
    return inLeft || inRight || inBridge ? CROP : SOIL
  })

  it('escapes into the neighbouring field without a leash', () => {
    const r = growRegion(twoFields, W, H, [[30, 60]], { maxFraction: 0.9 })!
    expect(r.mask[60 * W + 90]).toBe(1) // reached the far field
  })

  it('stays in the seeded field with one', () => {
    // Blocks only in the left field; 35 px is enough to reach its own edge.
    const seeds: Array<[number, number]> = [
      [30, 60],
      [24, 55],
      [36, 65],
    ]
    const r = growRegion(twoFields, W, H, seeds, { maxDistancePx: 20 })!
    expect(r.mask[60 * W + 30]).toBe(1) // own field claimed
    expect(r.mask[60 * W + 90]).toBe(0) // neighbour NOT claimed
  })

  it('still reaches the whole of its own field', () => {
    const seeds: Array<[number, number]> = [
      [30, 60],
      [24, 55],
      [36, 65],
    ]
    const r = growRegion(twoFields, W, H, seeds, { maxDistancePx: 20 })!
    // The rim of the left disc, well away from any seed, is still included.
    expect(r.mask[60 * W + 10]).toBe(1)
  })
})

describe('distanceFrom', () => {
  it('measures distance from the seed pixels', () => {
    const seed = new Uint8Array(W * H)
    seed[60 * W + 60] = 1
    const d = distanceFrom(seed, W, H)
    expect(d[60 * W + 60]).toBe(0)
    expect(d[60 * W + 70]).toBeCloseTo(10, 0)
    // Diagonal, within chamfer error.
    expect(d[70 * W + 70]).toBeGreaterThan(13)
    expect(d[70 * W + 70]).toBeLessThan(15)
  })
})

describe('measured tolerance', () => {
  it('adapts to how much the crop actually varies', () => {
    // An even field needs little latitude; a patchy one needs more. A single
    // fixed number cannot serve both, which is why this is measured.
    const seeds: Array<[number, number]> = [
      [60, 60],
      [50, 55],
      [70, 65],
      [55, 70],
      [65, 50],
    ]
    const even = growRegion(discImage(40, 0), W, H, seeds)!
    const patchy = growRegion(discImage(40, 4), W, H, seeds)!
    expect(patchy.tolerance).toBeGreaterThan(even.tolerance)
  })

  it('stays within sane bounds whatever the imagery', () => {
    const seeds: Array<[number, number]> = [
      [60, 60],
      [50, 55],
      [70, 65],
    ]
    for (const noise of [0, 2, 8]) {
      const r = growRegion(discImage(40, noise), W, H, seeds)
      if (!r) continue
      // Never so tight it can't cross image noise, never so loose it swallows
      // the surrounding ground.
      expect(r.tolerance).toBeGreaterThanOrEqual(22)
      expect(r.tolerance).toBeLessThanOrEqual(70)
    }
  })
})

describe('tracing a realistic, ragged edge', () => {
  /** A disc with a bumpy rim and a pinch, as real segmentation produces. */
  const raggedMask = () => {
    const m = new Uint8Array(W * H)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const dx = x - W / 2
        const dy = y - H / 2
        const ang = Math.atan2(dy, dx)
        // Wobbling radius plus a deep notch, so the walk meets a pinch point.
        const r = 40 + 4 * Math.sin(ang * 7) - (Math.abs(ang) < 0.15 ? 14 : 0)
        if (dx * dx + dy * dy <= r * r) m[y * W + x] = 1
      }
    }
    return m
  }

  it('walks the whole outline, not just a couple of pixels', () => {
    // The reported failure: the tracer stopped almost immediately on a real
    // mask and the detection reported "too small to be a field".
    const outline = traceOutline(raggedMask(), W, H)
    // A radius-40 disc has a perimeter over 250 px; anything near zero means
    // the walk terminated early.
    expect(outline.length).toBeGreaterThan(200)
  })

  it('stays on the boundary all the way round', () => {
    const m = raggedMask()
    const outline = traceOutline(m, W, H)
    for (const [x, y] of outline) {
      expect(m[y * W + x]).toBe(1) // every step is a field pixel
      // and each touches the outside, i.e. is genuinely on the edge
      const touchesOutside =
        !m[y * W + (x - 1)] || !m[y * W + (x + 1)] || !m[(y - 1) * W + x] || !m[(y + 1) * W + x]
      expect(touchesOutside).toBe(true)
    }
  })

  it('covers the shape rather than one lobe of it', () => {
    const outline = traceOutline(raggedMask(), W, H)
    const xs = outline.map((p) => p[0])
    const ys = outline.map((p) => p[1])
    // The traced points should span most of the shape in both directions.
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(60)
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(60)
  })
})

describe('largestComponent', () => {
  it('keeps the field and discards stray specks', () => {
    // The actual failure: a block on a track seeds a speck, and because the
    // tracer starts top-left it traced the speck rather than the field.
    const m = new Uint8Array(W * H)
    for (let y = 40; y < 90; y++) for (let x = 40; x < 90; x++) m[y * W + x] = 1 // the field
    m[5 * W + 5] = 1 // speck, above-left so scan order finds it FIRST
    m[6 * W + 5] = 1

    expect(traceOutline(m, W, H).length).toBeLessThan(8) // traced the speck
    const main = largestComponent(m, W, H)
    expect(main[5 * W + 5]).toBe(0) // speck gone
    expect(main[60 * W + 60]).toBe(1) // field kept
    expect(traceOutline(main, W, H).length).toBeGreaterThan(100) // real outline
  })

  it('handles an empty mask', () => {
    expect([...largestComponent(new Uint8Array(W * H), W, H)].some(Boolean)).toBe(false)
  })

  it('picks the bigger of two separate blobs', () => {
    const m = new Uint8Array(W * H)
    for (let y = 10; y < 20; y++) for (let x = 10; x < 20; x++) m[y * W + x] = 1 // small
    for (let y = 60; y < 100; y++) for (let x = 60; x < 100; x++) m[y * W + x] = 1 // big
    const main = largestComponent(m, W, H)
    expect(main[15 * W + 15]).toBe(0)
    expect(main[80 * W + 80]).toBe(1)
  })
})

describe('openMask', () => {
  it('severs a thin bridge between two fields', () => {
    // Exactly the real failure: a track a few pixels wide ties this field to
    // the next, so the grow crosses and they count as one blob.
    const m = new Uint8Array(W * H)
    const disc = (cx: number, cy: number, r: number) => {
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) m[y * W + x] = 1
    }
    disc(35, 60, 25)
    disc(95, 60, 18)
    for (let y = 58; y <= 62; y++) for (let x = 35; x <= 95; x++) m[y * W + x] = 1 // the track

    const opened = openMask(m, W, H, 4)
    // Bridge cut, both bodies survive.
    expect(opened[60 * W + 65]).toBe(0)
    expect(opened[60 * W + 35]).toBe(1)
    expect(opened[60 * W + 95]).toBe(1)

    // ...so the largest-blob step now keeps only the seeded field.
    const main = largestComponent(opened, W, H)
    expect(main[60 * W + 35]).toBe(1)
    expect(main[60 * W + 95]).toBe(0)
  })

  it('leaves a solid shape essentially intact', () => {
    const m = new Uint8Array(W * H)
    for (let y = 30; y < 90; y++) for (let x = 30; x < 90; x++) m[y * W + x] = 1
    const opened = openMask(m, W, H, 3)
    expect(opened[60 * W + 60]).toBe(1)
    const before = [...m].filter(Boolean).length
    const after = [...opened].filter(Boolean).length
    expect(after).toBeGreaterThan(before * 0.9)
  })

  it('never invents pixels outside the original mask', () => {
    const m = new Uint8Array(W * H)
    for (let y = 40; y < 80; y++) for (let x = 40; x < 80; x++) m[y * W + x] = 1
    const opened = openMask(m, W, H, 3)
    for (let i = 0; i < m.length; i++) if (opened[i]) expect(m[i]).toBe(1)
  })
})

describe('seedComponents', () => {
  /** A field split in two by a track, plus a neighbouring field. */
  const split = () => {
    const m = new Uint8Array(W * H)
    for (let y = 30; y < 90; y++) {
      for (let x = 20; x < 70; x++) {
        if (y >= 58 && y <= 62) continue // the track cutting it in half
        m[y * W + x] = 1
      }
    }
    for (let y = 40; y < 80; y++) for (let x = 90; x < 115; x++) m[y * W + x] = 1 // neighbour
    return m
  }

  it('keeps every piece of the field that holds a block', () => {
    // The reported failure: taking only the biggest blob discarded the far
    // side of a split field and a quarter of the blocks with it.
    const seeds: Array<[number, number]> = [
      [40, 40], // upper half
      [40, 80], // lower half
    ]
    const kept = seedComponents(split(), W, H, seeds)
    expect(kept[40 * W + 40]).toBe(1)
    expect(kept[80 * W + 40]).toBe(1)
  })

  it('still drops a neighbouring field with no blocks in it', () => {
    const kept = seedComponents(split(), W, H, [[40, 40], [40, 80]])
    expect(kept[60 * W + 100]).toBe(0)
  })

  it('differs from largestComponent exactly where it matters', () => {
    const seeds: Array<[number, number]> = [[40, 40], [40, 80]]
    const biggest = largestComponent(split(), W, H)
    const seeded = seedComponents(split(), W, H, seeds)
    // Both keep the bigger half; only the seeded version keeps the other.
    expect(biggest[40 * W + 40]).toBe(1)
    expect(seeded[40 * W + 40]).toBe(1)
    expect(biggest[80 * W + 40]).toBe(0)
    expect(seeded[80 * W + 40]).toBe(1)
  })

  it('returns nothing when no block lands on the mask', () => {
    expect([...seedComponents(split(), W, H, [[5, 5]])].some(Boolean)).toBe(false)
  })
})
