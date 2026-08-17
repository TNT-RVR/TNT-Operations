/**
 * Make a low-contrast QR label readable.
 *
 * ── The problem this solves ──────────────────────────────────────────────────
 *
 * TNT's block labels are printed in the brand honey, `#FEB836`, including the  (token-exempt: printed ink, not UI)
 * three finder patterns a decoder locks onto before it reads anything. Decoders
 * work in greyscale, and by luminance that gold is barely dark at all:
 *
 *   luminance(#FEB836) = 0.2126·254 + 0.7152·184 + 0.0722·54 ≈ 190  (token-exempt)
 *   luminance(white)   = 255
 *
 * A 26% separation, before sunlight, lamination glare and a phone camera's
 * auto-exposure eat into it. Below threshold the finder patterns simply are not
 * found, which is why the failure is "no code detected" rather than a wrong or
 * partial read.
 *
 * ── Why the blue channel, not luminance ──────────────────────────────────────
 *
 * Gold is a WARM colour: high red, high green, very little blue. Read the blue
 * channel alone and the same ink separates enormously:
 *
 *   blue(#FEB836) = 54     blue(white) = 255      → 79% separation  (token-exempt)
 *
 * Three times the contrast, for free, with no filtering. And it costs nothing
 * on ordinary black labels, because black ink is dark in every channel — blue
 * included. It would only hurt for a QR printed in blue or cyan, which is not a
 * thing anyone prints.
 *
 * The stretch afterwards is a percentile one, not min/max: a single blown-out
 * highlight or one dark speck would otherwise define the range and undo the
 * gain.
 */

/** Ignore this proportion at each end, so outliers cannot define the range. */
const CLIP = 0.02

/** Below this spread the frame is flat — sky, a blur, a hand — so leave it be. */
const MIN_SPREAD = 8

/**
 * Return a greyscale RGBA copy with the ink pushed toward black and the paper
 * toward white. Same dimensions; the caller wraps it in an ImageData.
 *
 * Takes raw pixels rather than an ImageData so it stays pure domain code with
 * no DOM types — which is also what lets it be tested without a browser.
 */
export function boostForQr(data: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const n = width * height
  const chan = new Uint8ClampedArray(n)

  // Blue channel — see the header. Reading one channel is also a third of the
  // work of a luminance conversion, which matters at several frames a second.
  for (let i = 0, p = 0; i < n; i++, p += 4) chan[i] = data[p + 2]

  const [lo, hi] = percentileRange(chan)
  const out = new Uint8ClampedArray(data.length)

  if (hi - lo < MIN_SPREAD) {
    // Nothing to stretch. Return the channel as-is rather than amplifying noise
    // into a texture the decoder will chase.
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      out[p] = out[p + 1] = out[p + 2] = chan[i]
      out[p + 3] = 255
    }
    return out
  }

  const scale = 255 / (hi - lo)
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const v = (chan[i] - lo) * scale
    out[p] = out[p + 1] = out[p + 2] = v < 0 ? 0 : v > 255 ? 255 : v
    out[p + 3] = 255
  }
  return out
}

/** The 2nd and 98th percentile values, via a 256-bin histogram. */
export function percentileRange(chan: Uint8ClampedArray, clip = CLIP): [number, number] {
  const hist = new Uint32Array(256)
  for (let i = 0; i < chan.length; i++) hist[chan[i]]++

  const cut = Math.floor(chan.length * clip)
  let lo = 0
  let hi = 255
  for (let acc = 0, v = 0; v < 256; v++) {
    acc += hist[v]
    if (acc > cut) {
      lo = v
      break
    }
  }
  for (let acc = 0, v = 255; v >= 0; v--) {
    acc += hist[v]
    if (acc > cut) {
      hi = v
      break
    }
  }
  return lo <= hi ? [lo, hi] : [0, 255]
}

/** Separation between ink and paper, 0–1. Used by the tests to prove the gain. */
export function contrastRatio(ink: [number, number, number], paper: [number, number, number]): number {
  const lum = ([r, g, b]: [number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * b
  return Math.abs(lum(paper) - lum(ink)) / 255
}
