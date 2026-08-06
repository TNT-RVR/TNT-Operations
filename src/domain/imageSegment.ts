/**
 * Find a field's outline in satellite imagery.
 *
 * The blocks tell us where the field IS, but not where it ENDS. The imagery
 * knows: a pivot's crop circle, a quarter's fence line and a headland are all
 * plainly visible. So we seed a region-grow from the block positions, let it
 * spread across pixels that look like the same field, and trace the edge of
 * what it reaches.
 *
 * Everything here is pure — pixels in, outline out — so it can be tested on
 * synthetic images instead of whatever the satellite happened to catch.
 *
 * Known limits, none of them silent:
 *   - imagery is from some past date, so a field re-shaped since won't match
 *   - a crop that looks like its neighbour lets the region bleed across
 *   - shadow, cloud and irrigation marks all change colour
 * The caller checks the result against the blocks and falls back to a fitted
 * shape when it looks wrong, so a bad segmentation costs nothing.
 */

/** Squared RGB distance — no square roots inside the inner loop. */
function colourDist2(
  data: Uint8ClampedArray,
  i: number,
  r: number,
  g: number,
  b: number,
): number {
  const dr = data[i] - r
  const dg = data[i + 1] - g
  const db = data[i + 2] - b
  return dr * dr + dg * dg + db * db
}

export interface GrowOptions {
  /**
   * How different a pixel may look from the field's colour and still belong,
   * as an RGB distance. Bigger swallows the neighbours; smaller leaves holes.
   *
   * 'auto' measures it from the blocks themselves: how much the crop varies
   * across the pixels the blocks sit on, which is the only honest estimate.
   * A fixed number can't suit both an even pivot and a patchy dryland field.
   */
  tolerance?: number | 'auto'
  /** Refuse a result covering more than this share of the image — it has bled. */
  maxFraction?: number
  /** Refuse a result smaller than this — it failed to spread. */
  minFraction?: number
  /**
   * Hard leash: how far, in pixels, the region may travel from the nearest
   * block before it stops.
   *
   * This is the constraint that matters. Colour alone is not enough — dry
   * stubble, a road margin and a bare headland can all resemble the crop, so
   * an unleashed grow escapes down a track and swallows the next quarter, the
   * river bank and everything else. But the field's edge is by definition
   * CLOSE to the blocks placed in it, so anything far away is not this field
   * whatever colour it happens to be.
   */
  maxDistancePx?: number
}

/**
 * Distance in pixels from every pixel to the nearest set pixel in `seed`,
 * by two-pass chamfer. Approximate Euclidean, linear in pixels.
 */
export function distanceFrom(seed: Uint8Array, w: number, h: number): Float32Array {
  const BIG = 1e9
  const d = new Float32Array(w * h)
  for (let i = 0; i < d.length; i++) d[i] = seed[i] ? 0 : BIG
  const D1 = 1
  const D2 = 1.41421356
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      let v = d[i]
      if (x > 0) v = Math.min(v, d[i - 1] + D1)
      if (y > 0) v = Math.min(v, d[i - w] + D1)
      if (x > 0 && y > 0) v = Math.min(v, d[i - w - 1] + D2)
      if (x < w - 1 && y > 0) v = Math.min(v, d[i - w + 1] + D2)
      d[i] = v
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x
      let v = d[i]
      if (x < w - 1) v = Math.min(v, d[i + 1] + D1)
      if (y < h - 1) v = Math.min(v, d[i + w] + D1)
      if (x < w - 1 && y < h - 1) v = Math.min(v, d[i + w + 1] + D2)
      if (x > 0 && y < h - 1) v = Math.min(v, d[i + w - 1] + D2)
      d[i] = v
    }
  }
  return d
}

export interface GrowResult {
  mask: Uint8Array
  /** Pixels claimed, as a share of the image. */
  fraction: number
  /** Median colour of the seeds, for reporting. */
  seedColour: [number, number, number]
  /** Tolerance actually used — worth reporting when it was measured. */
  tolerance: number
  /** Why it gave up, when it did. */
  failure?: 'bled' | 'never-spread'
}

/**
 * Grow a region from `seeds` across pixels resembling them.
 *
 * The field's colour is the MEDIAN of the seed pixels, not the mean: a block
 * that happens to sit on a track, a shadow or a bare patch would otherwise
 * drag the reference colour and let the region spread into the wrong ground.
 */
export function growRegion(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  seeds: Array<[number, number]>,
  opts: GrowOptions = {},
): GrowResult | null {
  const {
    tolerance = 'auto',
    // The image is padded around the blocks, so the field itself should be a
    // minority of it. Anything past half has plainly escaped.
    maxFraction = 0.5,
    minFraction = 0.01,
    maxDistancePx = Infinity,
  } = opts
  if (w <= 0 || h <= 0 || seeds.length === 0) return null

  const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h
  const valid = seeds.filter(([x, y]) => inBounds(Math.round(x), Math.round(y)))
  if (valid.length === 0) return null

  // Median colour of the seeds, per channel.
  const rs: number[] = []
  const gs: number[] = []
  const bs: number[] = []
  for (const [sx, sy] of valid) {
    const i = (Math.round(sy) * w + Math.round(sx)) * 4
    rs.push(data[i])
    gs.push(data[i + 1])
    bs.push(data[i + 2])
  }
  const med = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b)
    const m = s.length >> 1
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
  }
  const cr = med(rs)
  const cg = med(gs)
  const cb = med(bs)

  // Measured tolerance: how far the block pixels themselves stray from the
  // field's median colour. Median + 3 robust deviations covers the crop's own
  // variation without reaching the ground beyond it. Clamped so a field that
  // happens to be very uniform still tolerates ordinary image noise, and one
  // that's very patchy can't open the gates completely.
  let tol = typeof tolerance === 'number' ? tolerance : 40
  if (tolerance === 'auto') {
    const ds = valid.map(([sx, sy]) => {
      const i = (Math.round(sy) * w + Math.round(sx)) * 4
      return Math.sqrt(colourDist2(data, i, cr, cg, cb))
    })
    const dMed = med(ds)
    const mad = med(ds.map((d) => Math.abs(d - dMed))) * 1.4826
    tol = Math.min(70, Math.max(22, dMed + 3 * mad))
  }
  const tol2 = tol * tol

  // Leash: how far each pixel is from the nearest block.
  let reach: Float32Array | null = null
  if (Number.isFinite(maxDistancePx)) {
    const seedMask = new Uint8Array(w * h)
    for (const [sx, sy] of valid) seedMask[Math.round(sy) * w + Math.round(sx)] = 1
    reach = distanceFrom(seedMask, w, h)
  }

  const mask = new Uint8Array(w * h)
  // Flat typed-array queue: a JS array of pairs allocates millions of objects
  // on a megapixel image.
  const queue = new Int32Array(w * h)
  let head = 0
  let tail = 0
  for (const [sx, sy] of valid) {
    const px = Math.round(sx)
    const py = Math.round(sy)
    const idx = py * w + px
    if (mask[idx]) continue
    mask[idx] = 1
    queue[tail++] = idx
  }

  let claimed = tail
  while (head < tail) {
    const idx = queue[head++]
    const x = idx % w
    const y = (idx / w) | 0
    // 4-connected: diagonals let a region leak through a one-pixel gap.
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx
      const ny = y + dy
      if (!inBounds(nx, ny)) continue
      const nIdx = ny * w + nx
      if (mask[nIdx]) continue
      // Too far from any block to be part of this field, whatever its colour.
      if (reach && reach[nIdx] > maxDistancePx) continue
      if (colourDist2(data, nIdx * 4, cr, cg, cb) > tol2) continue
      mask[nIdx] = 1
      queue[tail++] = nIdx
      claimed++
    }
  }

  const fraction = claimed / (w * h)
  // Too much means it escaped the field; too little means it never spread.
  // Either way the answer is worthless — but say WHICH, so the next attempt
  // knows whether to loosen or tighten.
  const base = { mask, fraction, seedColour: [cr, cg, cb] as [number, number, number], tolerance: tol }
  if (fraction > maxFraction) return { ...base, failure: 'bled' }
  if (fraction < minFraction) return { ...base, failure: 'never-spread' }
  return base
}

/**
 * Keep only the biggest connected blob in a mask.
 *
 * The grow starts from EVERY block, so a block sitting on a track, a shadow or
 * a bare patch can seed a speck of its own that never joins the field. That
 * matters more than it sounds: the outline tracer starts at the first mask
 * pixel in scan order, so a stray speck above-left of the field gets traced
 * INSTEAD of the field, and the result reads as "too small to be a field".
 */
export function largestComponent(mask: Uint8Array, w: number, h: number): Uint8Array {
  const label = new Int32Array(w * h).fill(-1)
  const queue = new Int32Array(w * h)
  let best = -1
  let bestSize = 0
  let next = 0

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || label[start] >= 0) continue
    const id = next++
    let head = 0
    let tail = 0
    label[start] = id
    queue[tail++] = start
    let size = 0
    while (head < tail) {
      const idx = queue[head++]
      size++
      const x = idx % w
      const y = (idx / w) | 0
      if (x > 0 && mask[idx - 1] && label[idx - 1] < 0) {
        label[idx - 1] = id
        queue[tail++] = idx - 1
      }
      if (x < w - 1 && mask[idx + 1] && label[idx + 1] < 0) {
        label[idx + 1] = id
        queue[tail++] = idx + 1
      }
      if (y > 0 && mask[idx - w] && label[idx - w] < 0) {
        label[idx - w] = id
        queue[tail++] = idx - w
      }
      if (y < h - 1 && mask[idx + w] && label[idx + w] < 0) {
        label[idx + w] = id
        queue[tail++] = idx + w
      }
    }
    if (size > bestSize) {
      bestSize = size
      best = id
    }
  }

  const out = new Uint8Array(w * h)
  if (best < 0) return out
  for (let i = 0; i < out.length; i++) if (label[i] === best) out[i] = 1
  return out
}

/**
 * Fill enclosed holes in a mask — a dugout, a bale stack or a bare patch that
 * the grow refused. They're inside the field even if they don't look like it.
 *
 * Works by flooding the BACKGROUND from the image border: anything the flood
 * can't reach is enclosed, so it belongs to the field.
 */
export function fillHoles(mask: Uint8Array, w: number, h: number): Uint8Array {
  const outside = new Uint8Array(w * h)
  const queue = new Int32Array(w * h)
  let head = 0
  let tail = 0

  const push = (x: number, y: number) => {
    const i = y * w + x
    if (mask[i] || outside[i]) return
    outside[i] = 1
    queue[tail++] = i
  }
  for (let x = 0; x < w; x++) {
    push(x, 0)
    push(x, h - 1)
  }
  for (let y = 0; y < h; y++) {
    push(0, y)
    push(w - 1, y)
  }
  while (head < tail) {
    const idx = queue[head++]
    const x = idx % w
    const y = (idx / w) | 0
    if (x > 0) push(x - 1, y)
    if (x < w - 1) push(x + 1, y)
    if (y > 0) push(x, y - 1)
    if (y < h - 1) push(x, y + 1)
  }

  const out = new Uint8Array(w * h)
  for (let i = 0; i < out.length; i++) out[i] = mask[i] || !outside[i] ? 1 : 0
  return out
}

/**
 * Trace the outer boundary of a mask (Moore-neighbour tracing), returning
 * pixel coordinates in order around the shape.
 *
 * Returns the outline of the component containing the first mask pixel found
 * scanning top-left, which after hole-filling is the field itself.
 */
export function traceOutline(mask: Uint8Array, w: number, h: number): Array<[number, number]> {
  let start = -1
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) {
      start = i
      break
    }
  }
  if (start < 0) return []

  const sx = start % w
  const sy = (start / w) | 0
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : mask[y * w + x])

  // The eight neighbours, clockwise from west.
  const N: Array<[number, number]> = [
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
  ]
  const dirOf = (dx: number, dy: number) => N.findIndex(([ax, ay]) => ax === dx && ay === dy)

  const out: Array<[number, number]> = [[sx, sy]]
  let cx = sx
  let cy = sy
  // Where we came FROM. The start is the first set pixel in scan order, so the
  // cell to its west is certainly background — a valid place to begin sweeping.
  let bx = sx - 1
  let by = sy
  let firstStep: number | null = null

  // A bound rather than `while (true)`: a malformed mask must not hang the tab.
  const maxSteps = 8 * mask.length
  for (let step = 0; step < maxSteps; step++) {
    const from = dirOf(bx - cx, by - cy)
    let moved = false
    // Sweep clockwise starting just past where we came from, tracking the last
    // background cell as we go — that becomes the next "came from".
    for (let k = 1; k <= 8; k++) {
      const d = ((from < 0 ? 0 : from) + k) % 8
      const nx = cx + N[d][0]
      const ny = cy + N[d][1]
      if (!at(nx, ny)) {
        bx = nx
        by = ny
        continue
      }
      cx = nx
      cy = ny
      out.push([cx, cy])
      moved = true
      break
    }
    if (!moved) break // isolated pixel: nothing to walk

    if (out.length === 2) {
      firstStep = cy * w + cx
      continue
    }
    // Jacob's stopping criterion: finish only on re-entering the start pixel
    // heading the same way as the first step. Stopping merely because the walk
    // touched the start again cuts the outline short at any pinch in the shape
    // — which is what reduced a real field edge to a few pixels and reported
    // "too small to be a field".
    if (cx === sx && cy === sy && firstStep != null) {
      const peekFrom = dirOf(bx - cx, by - cy)
      for (let k = 1; k <= 8; k++) {
        const d = ((peekFrom < 0 ? 0 : peekFrom) + k) % 8
        const nx = cx + N[d][0]
        const ny = cy + N[d][1]
        if (at(nx, ny)) {
          if (ny * w + nx === firstStep) return out
          break
        }
      }
    }
  }
  return out
}
