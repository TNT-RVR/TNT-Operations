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
   */
  tolerance?: number
  /** Refuse a result covering more than this share of the image — it has bled. */
  maxFraction?: number
  /** Refuse a result smaller than this — it failed to spread. */
  minFraction?: number
}

export interface GrowResult {
  mask: Uint8Array
  /** Pixels claimed, as a share of the image. */
  fraction: number
  /** Median colour of the seeds, for reporting. */
  seedColour: [number, number, number]
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
  const { tolerance = 60, maxFraction = 0.9, minFraction = 0.01 } = opts
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
  const tol2 = tolerance * tolerance

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
      if (colourDist2(data, nIdx * 4, cr, cg, cb) > tol2) continue
      mask[nIdx] = 1
      queue[tail++] = nIdx
      claimed++
    }
  }

  const fraction = claimed / (w * h)
  // Too much means it escaped the field; too little means it never spread.
  // Either way the answer is worthless, and saying so beats drawing it.
  if (fraction > maxFraction || fraction < minFraction) return null
  return { mask, fraction, seedColour: [cr, cg, cb] }
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

  // Clockwise neighbours, starting west.
  const N = [
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
  ]
  const out: Array<[number, number]> = [[sx, sy]]
  let cx = sx
  let cy = sy
  let dir = 0
  // A bound rather than `while (true)`: a malformed mask must not hang the tab.
  const maxSteps = 8 * (w + h) + mask.length
  for (let step = 0; step < maxSteps; step++) {
    let moved = false
    // Start looking one step back from where we came in, so the trace hugs
    // the edge instead of cutting across.
    for (let k = 0; k < 8; k++) {
      const d = (dir + 6 + k) % 8
      const nx = cx + N[d][0]
      const ny = cy + N[d][1]
      if (!at(nx, ny)) continue
      cx = nx
      cy = ny
      dir = d
      out.push([cx, cy])
      moved = true
      break
    }
    if (!moved) break // isolated pixel
    if (cx === sx && cy === sy) break // closed the loop
  }
  return out
}
