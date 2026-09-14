/**
 * The notification `badge` must be a SILHOUETTE, not one of the app icons.
 *
 * Android renders a collapsed notification as the small icon alone — what the
 * web calls `badge` — and it renders it by discarding every colour channel and
 * using the ALPHA as a stencil filled with the status-bar tint. Every icon
 * `scripts/build_app_icons.py` emits is deliberately OPAQUE (a transparent PWA
 * icon gets composited onto whatever the launcher likes, and the honey mark on
 * white is the one background it was never drawn for). An opaque image is a
 * stencil with no holes, so the phone drew a plain white box.
 *
 * The bug was invisible in the only place anyone looks: expanding the shade
 * swaps in `icon`, which was always fine. So nothing about the failure points
 * at the file, and re-pointing `badge` at an icon "to use the real logo" would
 * look like a tidy-up. Hence a test rather than a comment.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'

const PUBLIC = join(process.cwd(), 'public')
const sw = readFileSync(join(PUBLIC, 'sw.js'), 'utf8')

/** The `badge:` path the service worker hands to showNotification. */
function badgePath(): string {
  const m = sw.match(/\bbadge:\s*'([^']+)'/)
  expect(m, 'sw.js should set a badge on the push notification').not.toBeNull()
  return m![1]
}

type Png = { width: number; height: number; colourType: number; alpha: Uint8Array }

/**
 * Enough of a PNG decoder to answer one question: which pixels are see-through.
 *
 * Only the shapes this repo's own generator produces are handled — 8-bit,
 * non-interlaced — and anything else throws rather than guessing, because a
 * decoder that quietly returns "all transparent" would pass this test on a file
 * it never read.
 */
function decode(file: string): Png {
  const buf = readFileSync(file)
  expect(buf.subarray(0, 8).toString('hex'), `${file} should be a PNG`).toBe('89504e470d0a1a0a')

  let width = 0
  let height = 0
  let depth = 0
  let colourType = -1
  let interlace = 0
  const idat: Buffer[] = []

  for (let at = 8; at + 8 <= buf.length; ) {
    const len = buf.readUInt32BE(at)
    const type = buf.subarray(at + 4, at + 8).toString('ascii')
    const body = buf.subarray(at + 8, at + 8 + len)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      depth = body[8]
      colourType = body[9]
      interlace = body[12]
    } else if (type === 'IDAT') idat.push(body)
    else if (type === 'IEND') break
    at += 12 + len
  }

  if (depth !== 8 || interlace !== 0) {
    throw new Error(`${file}: only 8-bit non-interlaced PNGs are decoded here`)
  }

  // Greyscale, truecolour, indexed, grey+alpha, RGBA.
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colourType]
  if (!channels) throw new Error(`${file}: unsupported colour type ${colourType}`)

  // A colour type without an alpha channel is opaque everywhere, which is the
  // failure this test exists to catch — say so instead of decoding pixels.
  if (colourType !== 4 && colourType !== 6) {
    return { width, height, colourType, alpha: new Uint8Array(width * height).fill(255) }
  }

  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = Buffer.alloc(height * stride)

  // Undo the per-scanline filters (PNG spec §9.2). Each line is prefixed by its
  // filter byte and may refer to the pixel to its left and the line above.
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[y * stride + x - channels] : 0
      const b = y > 0 ? out[(y - 1) * stride + x] : 0
      const c = x >= channels && y > 0 ? out[(y - 1) * stride + x - channels] : 0
      let v = line[x]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      } else if (filter !== 0) throw new Error(`${file}: bad filter ${filter} on row ${y}`)
      out[y * stride + x] = v & 0xff
    }
  }

  const alpha = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) alpha[i] = out[i * channels + channels - 1]
  return { width, height, colourType, alpha }
}

describe('the push notification badge', () => {
  it('is its own file, not one of the opaque app icons', () => {
    expect(badgePath()).not.toMatch(/icon-\d+\.png|apple-touch-icon|favicon/)
  })

  it('carries an alpha channel', () => {
    const png = decode(join(PUBLIC, badgePath()))
    // 4 = grey+alpha, 6 = RGBA. Type 2 is what `render()` writes, and is the
    // shape that produced the white box.
    expect([4, 6]).toContain(png.colourType)
  })

  /*
   * The numbers are loose on purpose. This is not a pixel lock on the mark —
   * it may be redrawn — it is a check that the file is a stencil at all: mostly
   * open, with a real shape punched through it. A solid square reads as 0%
   * transparent; an empty file reads as 100%.
   */
  it('is mostly transparent, with a mark still in it', () => {
    const png = decode(join(PUBLIC, badgePath()))
    const clear = png.alpha.reduce((n, a) => n + (a === 0 ? 1 : 0), 0)
    const total = png.width * png.height
    expect(clear / total, 'a badge that is nearly solid will draw as a box').toBeGreaterThan(0.4)
    expect(1 - clear / total, 'a badge with almost nothing in it draws as nothing').toBeGreaterThan(
      0.02,
    )
  })

  /*
   * Android asks for 24dp, which is 96 px at xxxhdpi — the density of the
   * phones the crew carry. Smaller gets upscaled and the strokes go soft;
   * larger is bytes the phone downsamples anyway.
   */
  it('is square and big enough for a high-density status bar', () => {
    const png = decode(join(PUBLIC, badgePath()))
    expect(png.width).toBe(png.height)
    expect(png.width).toBeGreaterThanOrEqual(96)
  })

  /*
   * The LARGE icon is the other half of the pair and has the opposite
   * requirement — it is drawn as a picture, so it must stay the real icon.
   * Pointing both at the silhouette would fix the status bar and empty the
   * expanded notification.
   */
  it('leaves the large icon as the real app icon', () => {
    const icon = sw.match(/\bicon:\s*'([^']+)'/)?.[1]
    expect(icon).toMatch(/icon-\d+\.png/)
    expect(icon).not.toBe(badgePath())
  })
})
