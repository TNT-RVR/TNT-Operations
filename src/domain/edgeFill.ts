/**
 * Find a field by its EDGES rather than its colour.
 *
 * Every field has a visible outline — a fence line, a headland, a road, the
 * hard rim of a pivot circle. Inside that outline the crop can be any mixture
 * of green, dry, shadowed and bare, which is exactly what defeats growing a
 * region by colour similarity: tighten the threshold and the fill stops at the
 * first dry patch, loosen it and the fill walks out into the next quarter.
 *
 * So: find the lines, then flood the space between them. A boundary stops the
 * flood whatever the ground on either side looks like, and variation inside
 * costs nothing because the flood never asks what colour a pixel is — only
 * whether it is an edge.
 *
 * Pure functions: pixels in, mask out.
 */

/** Perceptual luminance. Field boundaries show up in brightness, not hue. */
function luminance(data: Uint8ClampedArray, i: number): number {
  return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
}

/**
 * Box blur, `r` pixels, separable.
 *
 * Run before edge detection so crop rows, tramlines and pivot wheel marks stop
 * registering as boundaries. Those are strong, straight and everywhere — the
 * texture inside a field, not the edge of it.
 */
export function blurLuma(data: Uint8ClampedArray, w: number, h: number, r: number): Float32Array {
  const src = new Float32Array(w * h)
  for (let i = 0, p = 0; i < src.length; i++, p += 4) src[i] = luminance(data, p)
  if (r <= 0) return src

  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  const win = 2 * r + 1

  for (let y = 0; y < h; y++) {
    let sum = 0
    for (let x = -r; x <= r; x++) sum += src[y * w + Math.min(w - 1, Math.max(0, x))]
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = sum / win
      const add = src[y * w + Math.min(w - 1, x + r + 1)]
      const drop = src[y * w + Math.max(0, x - r)]
      sum += add - drop
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0
    for (let y = -r; y <= r; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / win
      const add = tmp[Math.min(h - 1, y + r + 1) * w + x]
      const drop = tmp[Math.max(0, y - r) * w + x]
      sum += add - drop
    }
  }
  return out
}

/** Sobel gradient magnitude over a luminance plane. */
export function gradientMagnitude(luma: Float32Array, w: number, h: number): Float32Array {
  const g = new Float32Array(w * h)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const tl = luma[i - w - 1]
      const t = luma[i - w]
      const tr = luma[i - w + 1]
      const l = luma[i - 1]
      const r = luma[i + 1]
      const bl = luma[i + w - 1]
      const b = luma[i + w]
      const br = luma[i + w + 1]
      const gx = tl + 2 * l + bl - (tr + 2 * r + br)
      const gy = tl + 2 * t + tr - (bl + 2 * b + br)
      g[i] = Math.hypot(gx, gy)
    }
  }
  return g
}

/**
 * Mark the strongest gradients as edges.
 *
 * The threshold is a PERCENTILE of the image's own gradients rather than a
 * fixed number: how strong a field boundary looks depends on the light, the
 * season and the ground either side, so an absolute value would need tuning
 * per picture — the very chore this is meant to remove.
 */
export function edgeMask(grad: Float32Array, percentile = 0.9): Uint8Array {
  const n = grad.length
  // Histogram beats sorting a million floats, and the precision is ample.
  const BINS = 512
  let max = 0
  for (let i = 0; i < n; i++) if (grad[i] > max) max = grad[i]
  if (max <= 0) return new Uint8Array(n)

  const hist = new Int32Array(BINS)
  for (let i = 0; i < n; i++) hist[Math.min(BINS - 1, ((grad[i] / max) * (BINS - 1)) | 0)]++

  const target = n * percentile
  let cum = 0
  let bin = BINS - 1
  for (let b = 0; b < BINS; b++) {
    cum += hist[b]
    if (cum >= target) {
      bin = b
      break
    }
  }
  const threshold = (bin / (BINS - 1)) * max

  const edges = new Uint8Array(n)
  for (let i = 0; i < n; i++) edges[i] = grad[i] >= threshold ? 1 : 0
  return edges
}

/**
 * Close single-pixel gaps in the edges.
 *
 * A boundary is rarely unbroken — a gateway, a culvert, a stretch where the
 * crop meets the verge at the same brightness. The flood only needs ONE gap to
 * escape into the neighbouring field, so thin breaks are bridged first.
 */
export function thickenEdges(edges: Uint8Array, w: number, h: number, r = 1): Uint8Array {
  if (r <= 0) return edges
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!edges[y * w + x]) continue
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          out[ny * w + nx] = 1
        }
      }
    }
  }
  return out
}

export interface FillResult {
  mask: Uint8Array
  fraction: number
  failure?: 'escaped' | 'stuck'
}

export interface FillOptions {
  /** Refuse a fill covering more than this share of the picture. */
  maxFraction?: number
  /** Refuse a fill smaller than this. */
  minFraction?: number
  /** How far the fill may travel from the nearest block, in pixels. */
  maxDistancePx?: number
  /** Distance from each pixel to the nearest block, if the caller has it. */
  reach?: Float32Array | null
}

/**
 * Flood from the blocks across everything that is NOT an edge.
 *
 * Note what this does not do: it never compares a pixel's colour to anything.
 * A field that is half green and half burnt off fills completely, because the
 * only question asked is whether the boundary has been reached.
 */
export function fillWithinEdges(
  edges: Uint8Array,
  w: number,
  h: number,
  seeds: Array<[number, number]>,
  opts: FillOptions = {},
): FillResult | null {
  const { maxFraction = 0.55, minFraction = 0.005, maxDistancePx = Infinity, reach = null } = opts
  if (w <= 0 || h <= 0 || seeds.length === 0) return null

  const mask = new Uint8Array(w * h)
  const queue = new Int32Array(w * h)
  let head = 0
  let tail = 0

  for (const [sx, sy] of seeds) {
    const x = Math.round(sx)
    const y = Math.round(sy)
    if (x < 0 || y < 0 || x >= w || y >= h) continue
    const i = y * w + x
    if (mask[i]) continue
    // A block sitting exactly on an edge pixel still seeds the fill: the block
    // is inside the field by definition, whatever the pixel under it looks like.
    mask[i] = 1
    queue[tail++] = i
  }
  if (tail === 0) return null

  let claimed = tail
  while (head < tail) {
    const idx = queue[head++]
    const x = idx % w
    const y = (idx / w) | 0
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
      const n = ny * w + nx
      if (mask[n] || edges[n]) continue
      if (reach && reach[n] > maxDistancePx) continue
      mask[n] = 1
      queue[tail++] = n
      claimed++
    }
  }

  const fraction = claimed / (w * h)
  const base = { mask, fraction }
  if (fraction > maxFraction) return { ...base, failure: 'escaped' }
  if (fraction < minFraction) return { ...base, failure: 'stuck' }
  return base
}

/**
 * Grow a filled region by `r` so it reaches the boundary line itself.
 *
 * The flood stops one pixel short — edge pixels are what halted it — so the
 * traced outline would otherwise sit just inside the real edge, and the
 * boundary would creep inward every time it's redetected.
 */
export function reachEdges(mask: Uint8Array, w: number, h: number, r = 2): Uint8Array {
  return thickenEdges(mask, w, h, r)
}
