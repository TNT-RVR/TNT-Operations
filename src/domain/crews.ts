/**
 * Live crew positions — how fresh they are, and how to order them.
 *
 * The trap this guards against: a crew broadcast is ephemeral. Someone parks
 * behind a shelterbelt, loses signal, and stops reporting — but they are still
 * out there working. A screen that quietly drops them, or worse shows their
 * last position as if it were current, sends a foreman driving to the wrong
 * quarter. Age is therefore part of what a crew position IS, not decoration.
 */

export interface LiveCrew {
  name: string
  /** Which job they are on. Older clients don't send it; treat as shelters. */
  task?: 'shelter' | 'tray'
  fieldId: string
  fieldName: string
  lat: number
  lng: number
  placed: number
  total: number
  /** ISO timestamp of the broadcast. */
  at: string
}

/** Field Mode broadcasts every 8 s; three missed goes before we call it stale. */
export const STALE_AFTER_MS = 25_000
/** Past this, "last seen" is the honest description rather than "just now". */
export const OLD_AFTER_MS = 5 * 60_000

export interface CrewStatus {
  ageMs: number
  /** No recent broadcast — the position may no longer be where they are. */
  stale: boolean
  /** Human phrasing, e.g. "live", "1 min ago", "18 min ago". */
  label: string
}

export function crewStatus(crew: LiveCrew, now: number = Date.now()): CrewStatus {
  const t = Date.parse(crew.at)
  const ageMs = Number.isFinite(t) ? Math.max(0, now - t) : Infinity
  if (ageMs < STALE_AFTER_MS) return { ageMs, stale: false, label: 'live' }
  if (!Number.isFinite(ageMs)) return { ageMs, stale: true, label: 'no signal' }
  const mins = Math.round(ageMs / 60_000)
  if (ageMs < OLD_AFTER_MS) {
    return { ageMs, stale: true, label: mins < 1 ? 'under a minute ago' : `${mins} min ago` }
  }
  if (mins < 120) return { ageMs, stale: true, label: `${mins} min ago` }
  return { ageMs, stale: true, label: `${Math.round(mins / 60)} h ago` }
}

/**
 * Live crews first, then by how far through they are.
 *
 * Deliberately NOT alphabetical: this list is read to answer "who needs help
 * and where", so the crew that is behind should not be buried under one that
 * finished an hour ago.
 */
export function sortCrews(crews: LiveCrew[], now: number = Date.now()): LiveCrew[] {
  return [...crews].sort((a, b) => {
    const sa = crewStatus(a, now)
    const sb = crewStatus(b, now)
    if (sa.stale !== sb.stale) return sa.stale ? 1 : -1
    const pa = a.total > 0 ? a.placed / a.total : 0
    const pb = b.total > 0 ? b.placed / b.total : 0
    if (pa !== pb) return pa - pb
    return a.name.localeCompare(b.name)
  })
}
