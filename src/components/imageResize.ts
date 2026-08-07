/**
 * Client-side image downscaling. Needs a browser — hence here rather than in
 * `src/domain/`.
 *
 * People upload photos straight off a phone: 4000×3000, several megabytes. That
 * cannot go in a database column that is read on every task row. This crops to
 * a centred square and resizes before anything is stored, so a 6 MB original
 * becomes roughly 15 KB.
 */
import { AVATAR_EDGE_PX } from '@/domain/avatar'

/**
 * Read a File into a centred square data URL of at most `edge` pixels.
 *
 * Centre-cropped rather than letterboxed: an avatar is displayed in a circle,
 * so preserving the full frame would just shrink the face and pad the sides
 * with background. Centre is where faces usually are.
 *
 * JPEG output unless the source has transparency, since a photo as PNG is
 * several times larger for no visible gain.
 */
export async function toSquareDataUrl(file: File, edge = AVATAR_EDGE_PX): Promise<string> {
  const bitmap = await loadBitmap(file)
  try {
    const side = Math.min(bitmap.width, bitmap.height)
    const sx = (bitmap.width - side) / 2
    const sy = (bitmap.height - side) / 2
    // Never upscale — a 64px source stays 64px rather than becoming a blurry 256.
    const out = Math.min(edge, side)

    const canvas = document.createElement('canvas')
    canvas.width = out
    canvas.height = out
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not process that image in this browser.')

    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, out, out)

    const keepAlpha = file.type === 'image/png' || file.type === 'image/webp'
    return keepAlpha ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.85)
  } finally {
    // createImageBitmap allocates outside the JS heap; without this the memory
    // is held until GC notices, which on a phone can mean several photos' worth.
    if ('close' in bitmap) bitmap.close()
  }
}

/**
 * Decode a File to something drawable.
 *
 * `createImageBitmap` is faster and avoids a DOM round trip, but Safari has
 * historically refused some formats, so an `<img>` is the fallback rather than
 * the primary path.
 */
async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file)
    } catch {
      /* fall through */
    }
  }

  const url = URL.createObjectURL(file)
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('That file could not be read as an image.'))
      img.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}
