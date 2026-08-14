import type { CrewTask } from './supplies'
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
  task?: CrewTask
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

// ═══════════════════════════════════════════════════════════════════════════
// Crew membership (migration 0023)
// ═══════════════════════════════════════════════════════════════════════════

export interface Crew {
  id: string
  name: string
  season: number
  active: boolean
  /** The field this crew is working, and which job. Null = unassigned. */
  currentFieldId: string | null
  currentTask: CrewTask | null
  assignedAt: string | null
}

/**
 * What a crew is doing, in words.
 *
 * The assignment is the ANSWER; a live position only says where they are. A
 * crew can be assigned and out of signal, which is normal, and reading
 * "unassigned" for that would be worse than saying nothing.
 */
export function describeAssignment(crew: Crew, fieldName?: string | null): string {
  if (!crew.currentTask || !crew.currentFieldId) return 'No job set'
  const job =
    crew.currentTask === 'tray'
      ? 'Trays'
      : crew.currentTask === 'removal'
        ? 'Shelter removal'
        : 'Shelters'
  return `${job} · ${fieldName ?? 'unknown field'}`
}

export interface CrewMember {
  id: string
  crewId: string
  userId: string
  role: 'lead' | 'member'
  joinedAt: string
  /** Null while still on the crew. Leaving is recorded, not deleted. */
  leftAt: string | null
}

/** Still on a crew right now. */
export const isActive = (m: CrewMember): boolean => m.leftAt == null

/** The crew a person is on, or null. */
export function crewOf(members: CrewMember[], userId: string): string | null {
  return members.find((m) => isActive(m) && m.userId === userId)?.crewId ?? null
}

/** Everyone currently on a crew. */
export function membersOf(members: CrewMember[], crewId: string): CrewMember[] {
  return members.filter((m) => isActive(m) && m.crewId === crewId)
}

/** The lead — whose GPS speaks for the crew — or null when nobody holds it. */
export function leadOf(members: CrewMember[], crewId: string): CrewMember | null {
  return membersOf(members, crewId).find((m) => m.role === 'lead') ?? null
}

/**
 * Should THIS device broadcast the crew's position?
 *
 * Only the lead, and only when it knows which crew it is on. Several phones in
 * one truck reporting slightly different fixes would draw a crew as a smear of
 * pins that disagree — and the iPad is the device that stays with the vehicle
 * rather than going up a ladder in someone's pocket.
 *
 * A crew with NO lead broadcasts nothing rather than electing one silently:
 * the map would then show a position that moves when a particular person walks
 * off, which is worse than an honest gap.
 */
export function shouldBroadcastPosition(members: CrewMember[], userId: string | null): boolean {
  if (!userId) return false
  const mine = members.find((m) => isActive(m) && m.userId === userId)
  return mine?.role === 'lead'
}

export interface CrewChange {
  /** Memberships to close, by id. */
  leave: string[]
  /** Whether a new membership row is needed. */
  join: boolean
}

/**
 * What joining `crewId` means for someone.
 *
 * Joining a crew while on another leaves the first — people get moved around
 * mid-morning and nobody is going to remember to press "leave" first. Joining
 * the crew you are already on is a no-op rather than a duplicate row.
 */
export function planJoin(members: CrewMember[], userId: string, crewId: string): CrewChange {
  const active = members.filter((m) => isActive(m) && m.userId === userId)
  if (active.some((m) => m.crewId === crewId)) return { leave: [], join: false }
  return { leave: active.map((m) => m.id), join: true }
}

export interface LeadHandover {
  /** Memberships that must stop being lead first. */
  demote: string[]
  /** The membership to promote, or null when the person isn't on the crew. */
  promote: string | null
}

/**
 * Moving the lead to this device.
 *
 * The old lead must be demoted in the same breath: a crew has exactly one
 * position reporter (the database enforces it with a partial unique index), so
 * promoting without demoting is rejected outright — and in mock mode it
 * silently produced two leads, where whichever was found first won and the
 * button appeared to do nothing.
 */
export function planTakeLead(members: CrewMember[], userId: string, crewId: string): LeadHandover {
  const active = membersOf(members, crewId)
  const mine = active.find((m) => m.userId === userId) ?? null
  return {
    demote: active.filter((m) => m.role === 'lead' && m.userId !== userId).map((m) => m.id),
    promote: mine && mine.role !== 'lead' ? mine.id : null,
  }
}
