/**
 * Profile photos: validation and the initials fallback. Pure functions — no
 * React, no DOM. The canvas resizing lives in `src/components/imageResize.ts`,
 * which needs a browser.
 *
 * ── Why the fallback matters more than the photo ─────────────────────────────
 *
 * Most people will never upload one. If a missing photo renders as a blank
 * circle, a task list becomes a column of identical grey dots and the feature
 * makes the screen worse, not better. So initials are the DEFAULT state, not an
 * error state, and they have to be legible at 24px.
 *
 * ── Why they are not colour-coded per person ─────────────────────────────────
 *
 * The obvious move is a deterministic colour per user so faces are
 * distinguishable at a glance. The design system forbids it: honey is the only
 * accent, and a rainbow of avatar chips would be the loudest thing on every
 * screen. Initials are neutral; only YOUR own avatar takes the accent, which
 * also makes "which of these is me" instant. See docs/design-system.md.
 */

/** Photos are stored inline on the profile, so they need a hard ceiling. */
export const MAX_AVATAR_BYTES = 128 * 1024
/** Stored square at this edge — displayed at 24–40px, so this is generous. */
export const AVATAR_EDGE_PX = 256

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

export interface AvatarProblem {
  message: string
}

/**
 * Whether an uploaded file can be used as a profile photo.
 *
 * The size limit applies to the ORIGINAL only as a sanity bound — a 40 MB
 * camera raw is a mistake worth catching early. Ordinary phone photos are
 * downscaled before storage, so the input limit is deliberately loose while the
 * stored limit is tight.
 */
export function checkAvatarFile(file: { type: string; size: number }): AvatarProblem | null {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { message: 'Use a PNG, JPEG, WebP or GIF image.' }
  }
  if (file.size === 0) return { message: 'That file is empty.' }
  if (file.size > 20 * 1024 * 1024) {
    return { message: `That image is ${Math.round(file.size / 1024 / 1024)} MB. Pick something under 20 MB.` }
  }
  return null
}

/** Whether an already-encoded data URL is small enough to store. */
export function checkAvatarDataUrl(dataUrl: string): AvatarProblem | null {
  // Base64 is ~4/3 the byte size; the header is negligible at this scale.
  const bytes = Math.ceil((dataUrl.length * 3) / 4)
  if (bytes > MAX_AVATAR_BYTES) {
    return {
      message: `That photo is still ${Math.round(bytes / 1024)} KB after resizing. Try a simpler image.`,
    }
  }
  return null
}

/**
 * One or two letters for the fallback circle.
 *
 * Takes the first letter of the first and last word, so "Stuart Van Der Berg"
 * gives SB rather than SV. Falls back through name → email → '?', because a
 * profile can legitimately have no name yet — an invited user who has not
 * signed in has only an email.
 */
const firstTwo = (w: string) => w.slice(0, 2).toUpperCase()

export function initialsOf(input: { name?: string | null; email?: string | null }): string {
  const name = (input.name ?? '').trim()
  if (name) {
    // Only words that START with a letter or digit count. Without this,
    // "Tyler (Admin)" reads as T( — the bracket is the last word's first
    // character. Parenthetical suffixes and honorifics are common enough in a
    // real roster that this is the normal case, not an edge one.
    const words = name.split(/\s+/).filter((w) => /^[\p{L}\p{N}]/u.test(w))
    if (words.length === 0) return '?'
    if (words.length === 1) return firstTwo(words[0])
    return (words[0][0] + words[words.length - 1][0]).toUpperCase()
  }

  const email = (input.email ?? '').trim()
  if (email) {
    // Use the local part, and treat dots and plus-addressing as word breaks:
    // tyler.torrie+claude@… should read TT, not TY.
    const local = email.split('@')[0]
    const parts = local.split(/[.+_-]/).filter((w) => /^[\p{L}\p{N}]/u.test(w))
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
    if (parts.length === 1) return firstTwo(parts[0])
    return '?'
  }

  return '?'
}

/** Sizes the avatar is drawn at, in pixels. */
export const AVATAR_SIZES = { xs: 20, sm: 24, md: 32, lg: 40, xl: 72 } as const
export type AvatarSize = keyof typeof AVATAR_SIZES
