/**
 * Where an installed app should land when it is launched.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 *
 * A PWA's landing page comes from the manifest's `start_url`, which a phone
 * records AT INSTALL TIME. TNT's said `/field` for its first year, because the
 * install was for crew tablets. It says `/` now, but an icon already on a home
 * screen keeps launching where it was told to: iOS bookmarks the page that was
 * open when it was added, and Android caches the WebAPK and re-reads the
 * manifest on its own schedule. Removing and re-adding the icon did not shift
 * it, which is the state that made this necessary.
 *
 * So the app decides for itself, once, on launch.
 *
 * ── What it must not do ──────────────────────────────────────────────────────
 *
 * It must not touch crews. A device account has no dashboard, so `canDashboard`
 * is false and Field Mode is exactly where it should open — the redirect is off
 * for them by construction rather than by a role check that could drift.
 *
 * It must not hijack navigation. Only the FIRST entry of a launch qualifies:
 * once someone has moved around inside the app, `/field` is a place they chose
 * to be. A link opened from a notification carries history too, and stays put.
 */
export interface LaunchContext {
  /** Path the app opened at. */
  path: string
  /** True when running as an installed app rather than a browser tab. */
  standalone: boolean
  /** `history.length` — 1 means nothing has been navigated yet. */
  historyLength: number
  /** Whether this person has a dashboard to be sent to. */
  canDashboard: boolean
}

/**
 * Paths that were once a `start_url` and are no longer the place to land.
 *
 * Deliberately a short, explicit list rather than "anything that is not /".
 * A stale install can only be pointing where an old manifest pointed, and
 * redirecting from anywhere else would break every deep link in the app.
 */
const STALE_START_URLS = ['/field']

/** The path to send them to, or null to stay put. */
export function launchRedirect(ctx: LaunchContext): string | null {
  if (!ctx.standalone) return null // a browser tab is where the person put it
  if (!ctx.canDashboard) return null // crews: Field Mode IS their home
  if (ctx.historyLength > 1) return null // they navigated here themselves
  if (!STALE_START_URLS.includes(ctx.path)) return null
  return '/'
}
