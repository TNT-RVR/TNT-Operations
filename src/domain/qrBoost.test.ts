import { describe, it, expect } from 'vitest'
import { boostForQr, contrastRatio, percentileRange } from './qrBoost'

/**
 * These use the REAL numbers from the field: TNT honey `#FEB836` printed on  (token-exempt)
 * white label stock, which a crew could not scan a single one of.
 */
const HONEY: [number, number, number] = [0xfe, 0xb8, 0x36]
const WHITE: [number, number, number] = [255, 255, 255]
const BLACK: [number, number, number] = [0, 0, 0]

/** A checkerboard of ink and paper, as a stand-in for QR modules. */
function patch(ink: [number, number, number], paper: [number, number, number], w = 40, h = 40) {
  const d = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = (x >> 2) % 2 === (y >> 2) % 2 ? ink : paper
      const p = (y * w + x) * 4
      d[p] = c[0]
      d[p + 1] = c[1]
      d[p + 2] = c[2]
      d[p + 3] = 255
    }
  }
  return { data: d, width: w, height: h }
}

/** Run the boost over a fixture. */
const boost = (f: ReturnType<typeof patch>) => boostForQr(f.data, f.width, f.height)

/** Greyscale separation actually present in a processed frame. */
function separation(out: Uint8ClampedArray): number {
  let min = 255
  let max = 0
  for (let p = 0; p < out.length; p += 4) {
    const v = out[p]
    if (v < min) min = v
    if (v > max) max = v
  }
  return (max - min) / 255
}

describe('the problem, stated in numbers', () => {
  it('honey on white is barely darker than the paper', () => {
    // This is why nothing scanned. Under 30% is where decoders start failing.
    expect(contrastRatio(HONEY, WHITE)).toBeLessThan(0.3)
  })

  it('black on white is not close to that', () => {
    // Close, not exact: the luminance weights sum to 1 only to float precision.
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(1, 10)
  })
})

describe('boostForQr', () => {
  it('turns honey-on-white into full separation', () => {
    const before = contrastRatio(HONEY, WHITE)
    const after = separation(boost(patch(HONEY, WHITE)))
    expect(before).toBeLessThan(0.3)
    expect(after).toBeGreaterThan(0.95)
    // The point of the exercise: several times the contrast the decoder had.
    expect(after / before).toBeGreaterThan(3)
  })

  it('leaves an ordinary black label fully readable', () => {
    // The boost must not be a trade — normal labels have to keep working.
    expect(separation(boost(patch(BLACK, WHITE)))).toBeGreaterThan(0.95)
  })

  it('keeps the ink darker than the paper, never inverting', () => {
    // An inverted frame decodes as nothing. Sample a known ink pixel (0,0) and
    // a known paper pixel, and check the order survives.
    const out = boost(patch(HONEY, WHITE))
    const at = (x: number, y: number) => out[(y * 40 + x) * 4]
    expect(at(0, 0)).toBeLessThan(at(4, 0))
  })

  it('returns a frame of the same size', () => {
    const f = patch(HONEY, WHITE, 33, 21)
    expect(boostForQr(f.data, f.width, f.height).length).toBe(33 * 21 * 4)
  })

  it('leaves a flat frame alone instead of amplifying its noise', () => {
    // A phone pointed at the sky. Stretching this would manufacture texture the
    // decoder then wastes every frame chasing.
    const flat = patch([200, 200, 200], [203, 203, 203])
    expect(separation(boost(flat))).toBeLessThan(0.1)
  })

  it('sets every pixel opaque', () => {
    const out = boost(patch(HONEY, WHITE))
    for (let p = 3; p < out.length; p += 4) expect(out[p]).toBe(255)
  })
})

describe('percentileRange', () => {
  it('ignores a handful of outliers at each end', () => {
    // 2% clipping: one blown highlight must not define the top of the range.
    const chan = new Uint8ClampedArray(1000).fill(100)
    chan[0] = 0
    chan[1] = 255
    const [lo, hi] = percentileRange(chan)
    expect(lo).toBe(100)
    expect(hi).toBe(100)
  })

  it('finds a genuine spread', () => {
    const chan = new Uint8ClampedArray(1000)
    for (let i = 0; i < 500; i++) chan[i] = 40
    for (let i = 500; i < 1000; i++) chan[i] = 220
    const [lo, hi] = percentileRange(chan)
    expect(lo).toBe(40)
    expect(hi).toBe(220)
  })
})
