/**
 * Captures the auth type from an emailed link (invite / password recovery).
 *
 * Supabase puts `#access_token=…&type=invite` (or `type=recovery`) on the URL,
 * and supabase-js consumes that hash asynchronously to establish the session —
 * wiping it in the process. So we read it HERE, at module load, before the
 * client gets a chance to clear it. Later code asks `initialAuthType()`.
 *
 * Why it matters: someone arriving from an invite is signed in but has NEVER
 * set a password. Without this we'd drop them into the app and they could
 * never sign back in.
 */

/**
 * Pure parser — the fragment wins, falling back to the query string (some
 * Supabase flows use one, some the other). Exported so it can be tested
 * without a browser.
 */
export function parseAuthType(hash: string, search = ''): string | null {
  const fromHash = new URLSearchParams(hash.replace(/^#/, '')).get('type')
  if (fromHash) return fromHash
  return new URLSearchParams(search.replace(/^\?/, '')).get('type')
}

/** True for the link types that leave an account without a usable password. */
export const typeNeedsPassword = (t: string | null): boolean => t === 'invite' || t === 'recovery'

function readType(): string | null {
  if (typeof window === 'undefined') return null
  return parseAuthType(window.location.hash, window.location.search)
}

let authType: string | null = readType()

/** 'invite' | 'recovery' | … — whatever the email link declared, or null. */
export const initialAuthType = (): string | null => authType

/** True when the user arrived from a link that requires choosing a password. */
export const arrivedNeedingPassword = (): boolean => typeNeedsPassword(authType)

/** Called once the password has been set, so the app stops asking. */
export function clearAuthType(): void {
  authType = null
}
