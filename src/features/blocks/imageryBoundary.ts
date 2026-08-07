/**
 * Detect a field's outline from the satellite basemap.
 *
 * Fetches the Esri tiles covering the blocks, seeds a region-grow from the
 * block positions, and traces the edge of whatever it reaches — the pivot
 * circle, the fence line, the headland.
 *
 * The pixel work lives in src/domain/imageSegment.ts and is pure; this file is
 * the messy half: tiles, canvases and Web Mercator.
 */
import { fillHoles, traceOutline, seedComponents, distanceFrom } from '@/domain/imageSegment'
import { blurLuma, gradientMagnitude, edgeMask, thickenEdges, fillWithinEdges, reachEdges } from '@/domain/edgeFill'
import { convexHull, polygonArea, simplify } from '@/domain/fieldShape'
import { medianSpacingM } from '@/domain/returnsMap'
import type { SamplePoint } from '@/domain/returnsMap'
import type { FieldDict } from '@/domain/tentGrid'

const TILE = 256
const TILE_URL = (z: number, x: number, y: number) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`

/** Web Mercator: lon/lat → global pixel coordinates at zoom `z`. */
function lngLatToPixel(lng: number, lat: number, z: number): [number, number] {
  const scale = TILE * Math.pow(2, z)
  const x = ((lng + 180) / 360) * scale
  const s = Math.sin((lat * Math.PI) / 180)
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale
  return [x, y]
}

/** The inverse, for turning a traced outline back into coordinates. */
function pixelToLngLat(x: number, y: number, z: number): [number, number] {
  const scale = TILE * Math.pow(2, z)
  const lng = (x / scale) * 360 - 180
  const n = Math.PI - (2 * Math.PI * y) / scale
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
  return [lng, lat]
}

/** Either an outline, or a plain statement of why there isn't one. */
export type DetectOutcome =
  | { ok: true; result: DetectResult }
  | { ok: false; reason: string }

export interface DetectResult {
  field: FieldDict
  /** Gradient percentile used to call something a boundary. */
  edgePercentile: number
  /** Outline vertices, for reporting. */
  corners: number
  /** Share of the fetched image the field claimed. */
  fraction: number
  /** Share of the blocks that ended up inside the detected outline. */
  blocksInside: number
}

export interface DetectOptions {
  /**
   * How strong a gradient counts as a field boundary, as a percentile of the
   * picture's own gradients. Higher marks fewer, stronger lines.
   */
  edgePercentile?: number
  /**
   * How far past the outermost blocks the field edge may plausibly lie.
   * Blocks are placed IN the field, so its boundary is close to them; this is
   * what stops the grow escaping down a track into the next quarter.
   */
  maxDistanceM?: number
  /** Padding around the blocks, as a fraction of their extent. */
  pad?: number
  /** Outline simplification, in metres. */
  simplifyM?: number
}

/** Load one tile, resolving to null rather than throwing on a miss. */
function loadTile(z: number, x: number, y: number): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    // Required to read the pixels back; without it the canvas is tainted and
    // getImageData throws a security error.
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = TILE_URL(z, x, y)
  })
}

/**
 * Detect the field containing `samples`.
 *
 * Returns null whenever the result can't be trusted — the region bled across
 * the whole image, failed to spread, or ended up excluding the very blocks it
 * grew from. The caller falls back to the fitted shape, so a poor detection
 * costs nothing but the wait.
 */
export async function detectFieldFromImagery(
  samples: SamplePoint[],
  opts: DetectOptions = {},
): Promise<DetectOutcome> {
  const { edgePercentile = 0.9, pad = 0.3, simplifyM = 12, maxDistanceM } = opts
  if (samples.length < 4) return { ok: false, reason: 'Too few blocks to work from.' }

  let minLat = Infinity
  let maxLat = -Infinity
  let minLng = Infinity
  let maxLng = -Infinity
  for (const s of samples) {
    minLat = Math.min(minLat, s.lat)
    maxLat = Math.max(maxLat, s.lat)
    minLng = Math.min(minLng, s.lng)
    maxLng = Math.max(maxLng, s.lng)
  }
  // Pad so the field's edge is inside the image — we can't trace an edge that
  // falls outside what we fetched.
  const dLat = (maxLat - minLat) * pad || 0.002
  const dLng = (maxLng - minLng) * pad || 0.003
  minLat -= dLat
  maxLat += dLat
  minLng -= dLng
  maxLng += dLng

  // Choose the highest zoom that keeps the download modest (~<= 36 tiles).
  let z = 17
  let topLeft: [number, number] = [0, 0]
  let bottomRight: [number, number] = [0, 0]
  for (; z >= 13; z--) {
    topLeft = lngLatToPixel(minLng, maxLat, z)
    bottomRight = lngLatToPixel(maxLng, minLat, z)
    const tiles =
      (Math.floor(bottomRight[0] / TILE) - Math.floor(topLeft[0] / TILE) + 1) *
      (Math.floor(bottomRight[1] / TILE) - Math.floor(topLeft[1] / TILE) + 1)
    if (tiles <= 36) break
  }

  const tx0 = Math.floor(topLeft[0] / TILE)
  const ty0 = Math.floor(topLeft[1] / TILE)
  const tx1 = Math.floor(bottomRight[0] / TILE)
  const ty1 = Math.floor(bottomRight[1] / TILE)

  const W = (tx1 - tx0 + 1) * TILE
  const H = (ty1 - ty0 + 1) * TILE
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return { ok: false, reason: 'This browser could not open a drawing canvas.' }

  const jobs: Array<Promise<void>> = []
  for (let tx = tx0; tx <= tx1; tx++) {
    for (let ty = ty0; ty <= ty1; ty++) {
      jobs.push(
        loadTile(z, tx, ty).then((img) => {
          if (img) ctx.drawImage(img, (tx - tx0) * TILE, (ty - ty0) * TILE)
        }),
      )
    }
  }
  await Promise.all(jobs)

  let data: ImageData
  try {
    data = ctx.getImageData(0, 0, W, H)
  } catch {
    // Tainted canvas: the tile server didn't allow cross-origin reads.
    console.warn('[imagery] cannot read pixels (CORS) — falling back to the fitted shape')
    return {
      ok: false,
      reason: "The tile server won't allow the image to be read (CORS), so the picture can't be analysed here.",
    }
  }

  // Blocks → pixels in this image.
  const originX = tx0 * TILE
  const originY = ty0 * TILE
  const seeds: Array<[number, number]> = samples.map((s) => {
    const [px, py] = lngLatToPixel(s.lng, s.lat, z)
    return [px - originX, py - originY]
  })

  // Metres per pixel at this latitude and zoom, so the leash is a real distance.
  const midLatForScale = (minLat + maxLat) / 2
  const mPerPxNow = (156543.03392 * Math.cos((midLatForScale * Math.PI) / 180)) / Math.pow(2, z)

  // Leash derived from how far apart the blocks are. Blocks are spread through
  // the field, so its edge lies roughly one spacing beyond the outermost.
  const spacing = medianSpacingM(samples) ?? 60
  const leashM = maxDistanceM ?? Math.min(250, Math.max(60, spacing * 2.2))

  const seedMask = new Uint8Array(W * H)
  for (const [sx, sy] of seeds) {
    const x = Math.round(sx)
    const y = Math.round(sy)
    if (x >= 0 && y >= 0 && x < W && y < H) seedMask[y * W + x] = 1
  }
  const reach = distanceFrom(seedMask, W, H)

  // ── Find the lines, then fill between them ────────────────────────────────
  // Blur first so crop rows and wheel marks stop registering as boundaries,
  // then take the gradient, keep the strongest as edges, and bridge one-pixel
  // gaps so the fill can't escape through a gateway.
  const luma = blurLuma(data.data, W, H, 1)
  const grad = gradientMagnitude(luma, W, H)
  const edges = thickenEdges(edgeMask(grad, edgePercentile), W, H, 1)

  const flood = fillWithinEdges(edges, W, H, seeds, {
    reach,
    maxDistancePx: leashM / mPerPxNow,
  })
  if (!flood) return { ok: false, reason: 'No usable pixels under the blocks.' }
  if (flood.failure === 'escaped') {
    return {
      ok: false,
      reason: `The field's outline has a gap in it — the fill ran out and covered ${(flood.fraction * 100).toFixed(0)}% of the picture.`,
    }
  }
  if (flood.failure === 'stuck') {
    return {
      ok: false,
      reason: `The fill couldn't spread — it reached only ${(flood.fraction * 100).toFixed(1)}% of the picture. The picture may be too busy for a clean outline here.`,
    }
  }

  // The fill halts one pixel short of the boundary it hit, so nudge it back
  // out to the line itself; otherwise the outline creeps inward each time.
  const reached = reachEdges(flood.mask, W, H, 2)
  const main = seedComponents(reached, W, H, seeds)

  // Area sanity against the ground the blocks cover, not the picture.
  const seedHull = convexHull(seeds)
  const seedArea = Math.abs(polygonArea(seedHull))
  const grownArea = [...main].reduce((a, v) => a + v, 0)
  if (seedArea > 0 && grownArea > seedArea * 2.5) {
    return {
      ok: false,
      reason: `The filled area is ${(grownArea / seedArea).toFixed(1)}x the ground the blocks cover, so it has spread past the field.`,
    }
  }

  const filled = fillHoles(main, W, H)
  const outlinePx = traceOutline(filled, W, H)
  if (outlinePx.length < 8) return { ok: false, reason: 'The traced edge was too small to be a field.' }

  // Metres per pixel here, so the simplification tolerance is a real distance.
  const midLat = midLatForScale
  const simplified = simplify(outlinePx, Math.max(1, simplifyM / mPerPxNow))
  if (simplified.length < 4) return { ok: false, reason: 'The traced edge simplified away to nothing.' }

  // Back to coordinates. fieldFrame wants [lat, lng] pairs.
  const ring = simplified.map(([x, y]) => {
    const [lng, lat] = pixelToLngLat(x + originX, y + originY, z)
    return [lat, lng] as [number, number]
  })

  // Sanity: the detected field must actually contain the blocks it grew from.
  // A region that wandered off is worse than no detection at all.
  let inside = 0
  for (const [sx, sy] of seeds) {
    const px = Math.round(sx)
    const py = Math.round(sy)
    if (px < 0 || py < 0 || px >= W || py >= H) continue
    if (filled[py * W + px]) inside++
  }
  const blocksInside = inside / seeds.length
  if (blocksInside < 0.8) {
    return {
      ok: false,
      reason: `The detected shape left ${Math.round((1 - blocksInside) * 100)}% of the blocks outside it, so it isn't this field.`,
    }
  }

  const result: DetectResult = {
    corners: ring.length,
    fraction: flood.fraction,
    blocksInside,
    edgePercentile,
    field: {
      PP_Latitude: String(midLat),
      PP_Longitude: String((minLng + maxLng) / 2),
      use_bays: false,
      boundary_polygon: ring,
    } as FieldDict,
  }
  return { ok: true, result }
}
