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
import { growRegion, fillHoles, traceOutline } from '@/domain/imageSegment'
import { simplify } from '@/domain/fieldShape'
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

export interface DetectResult {
  field: FieldDict
  /** Outline vertices, for reporting. */
  corners: number
  /** Share of the fetched image the field claimed. */
  fraction: number
  /** Share of the blocks that ended up inside the detected outline. */
  blocksInside: number
}

export interface DetectOptions {
  /** Colour tolerance for the region grow. */
  tolerance?: number
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
): Promise<DetectResult | null> {
  const { tolerance = 55, pad = 0.35, simplifyM = 12 } = opts
  if (samples.length < 4) return null

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
  if (!ctx) return null

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
    return null
  }

  // Blocks → pixels in this image.
  const originX = tx0 * TILE
  const originY = ty0 * TILE
  const seeds: Array<[number, number]> = samples.map((s) => {
    const [px, py] = lngLatToPixel(s.lng, s.lat, z)
    return [px - originX, py - originY]
  })

  const grown = growRegion(data.data, W, H, seeds, { tolerance })
  if (!grown) return null

  const filled = fillHoles(grown.mask, W, H)
  const outlinePx = traceOutline(filled, W, H)
  if (outlinePx.length < 8) return null

  // Metres per pixel here, so the simplification tolerance is a real distance.
  const midLat = (minLat + maxLat) / 2
  const mPerPx = (156543.03392 * Math.cos((midLat * Math.PI) / 180)) / Math.pow(2, z)
  const simplified = simplify(outlinePx, Math.max(1, simplifyM / mPerPx))
  if (simplified.length < 4) return null

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
  if (blocksInside < 0.8) return null

  return {
    corners: ring.length,
    fraction: grown.fraction,
    blocksInside,
    field: {
      PP_Latitude: String(midLat),
      PP_Longitude: String((minLng + maxLng) / 2),
      use_bays: false,
      boundary_polygon: ring,
    } as FieldDict,
  }
}
