/**
 * One-way calendar sync: incubation milestones → Google Calendar. Pure
 * functions — no React, no network. The Netlify functions do the talking.
 *
 * ── The app owns the calendar ────────────────────────────────────────────────
 *
 * Sync runs in one direction only, and that is a deliberate limit rather than a
 * first cut. Milestones are COMPUTED from a run's start date and its temperature
 * history; there is no coherent meaning to dragging "earliest cool" two days
 * later in Google. So the calendar is a projection, and anything edited there is
 * overwritten on the next pass.
 *
 * ── Deletion is the part that gets forgotten ─────────────────────────────────
 *
 * A push-only sync that never deletes is worse than no sync: when a run's start
 * date moves, every milestone moves with it, and the stale events sit alongside
 * the new ones. A crew then sees two "Vapona out" dates and has no way to tell
 * which is real. `diffEvents` therefore returns deletes as well as writes, and
 * the caller must honour them.
 *
 * ── Why the event id is derived, not random ──────────────────────────────────
 *
 * Google lets the caller choose an event id. Deriving it from
 * (incubator, milestone) means a re-sync UPDATES the same event rather than
 * creating a second one, and it survives losing our own bookkeeping — if the
 * mapping table were wiped, the next sync would still land on the right events
 * instead of duplicating the calendar.
 */
import type { MilestoneEvent } from './incubation'

/** A Google Calendar event, in the shape their API takes. */
export interface GcalEvent {
  id: string
  summary: string
  description?: string
  /** All-day events use `date`, not `dateTime`. */
  start: { date: string }
  end: { date: string }
  /** Google requires this to un-delete an event we previously cancelled. */
  status?: 'confirmed' | 'cancelled'
}

/**
 * Google's event-id rules: characters a–v and 0–9 only, 5–1024 long.
 *
 * That is base32hex, which is why the encoding below exists rather than just
 * using our own uuids — a normal uuid contains characters Google rejects, and
 * the failure is a 400 with a message that does not mention the id.
 */
const BASE32HEX = '0123456789abcdefghijklmnopqrstuv'

/**
 * A deterministic, Google-legal id for one milestone.
 *
 * FNV-1a over the key, rendered in base32hex and padded. Not cryptographic and
 * does not need to be — the only requirement is that the same milestone always
 * maps to the same id and different milestones essentially never collide.
 */
export function eventIdFor(incubatorId: string, day: number, label: string): string {
  const key = `${incubatorId}|${day}|${label}`
  // Two independent FNV-1a passes with different offsets give 64 bits, which is
  // ample for a few hundred events and keeps the id short.
  const hash = (offset: number) => {
    let h = offset
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i)
      h = Math.imul(h, 16777619) >>> 0
    }
    return h
  }
  const encode = (n: number) => {
    let out = ''
    let v = n
    for (let i = 0; i < 7; i++) {
      out = BASE32HEX[v % 32] + out
      v = Math.floor(v / 32)
    }
    return out
  }
  // Prefixed so an event created by this app is identifiable in a shared
  // calendar, and so the id can never start in a way Google dislikes.
  return `tnt${encode(hash(2166136261))}${encode(hash(2166136261 ^ 0x5bf03635))}`
}

/** Add whole days to a YYYY-MM-DD, in UTC so no timezone can shift it. */
function addDay(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/**
 * A milestone as a Google all-day event.
 *
 * All-day rather than timed: a milestone is a DAY, not a moment. Giving it a
 * time would be inventing precision that does not exist, and would then shift
 * across timezones for anyone travelling.
 *
 * Google's all-day `end` is EXCLUSIVE, so a single-day event ends the following
 * day. Getting that wrong renders a zero-length event that some clients hide
 * entirely.
 */
export function toGcalEvent(e: MilestoneEvent): GcalEvent {
  return {
    id: eventIdFor(e.incubatorId, e.day, e.label),
    summary: `${e.incubatorName} — ${e.label} (Day ${e.day})`,
    description: 'From TNT Operations. Edits here are overwritten on the next sync.',
    start: { date: e.date },
    end: { date: addDay(e.date) },
    status: 'confirmed',
  }
}

/** What the last sync put on the calendar, from our bookkeeping table. */
export interface SyncedEvent {
  eventId: string
  /** The date it was last written with, so an unchanged event can be skipped. */
  date: string
  summary: string
}

export interface EventDiff {
  /** Events to create or overwrite. */
  upsert: GcalEvent[]
  /** Event ids to remove — milestones that no longer exist. */
  remove: string[]
  /** Already correct; no request needed. */
  unchanged: string[]
}

/**
 * What to send to Google to make the calendar match the milestones.
 *
 * Skipping unchanged events matters more than it looks: a full re-push of every
 * event on every run burns quota and rewrites `updated` timestamps, which makes
 * every event look freshly changed in anyone's notification feed.
 */
export function diffEvents(
  milestones: readonly MilestoneEvent[],
  synced: readonly SyncedEvent[],
): EventDiff {
  const desired = milestones.map(toGcalEvent)
  const byId = new Map(synced.map((s) => [s.eventId, s]))

  const upsert: GcalEvent[] = []
  const unchanged: string[] = []

  for (const ev of desired) {
    const prev = byId.get(ev.id)
    if (prev && prev.date === ev.start.date && prev.summary === ev.summary) unchanged.push(ev.id)
    else upsert.push(ev)
  }

  const wanted = new Set(desired.map((e) => e.id))
  const remove = synced.filter((s) => !wanted.has(s.eventId)).map((s) => s.eventId)

  return { upsert, remove, unchanged }
}

/**
 * Milestones worth putting on a calendar.
 *
 * Past milestones are dropped beyond a short tail. A calendar filled with every
 * milestone of every run since the app was installed is unreadable, and Google
 * charges quota per event. The tail keeps the last few weeks visible so someone
 * checking "when did that cool start" still finds it.
 */
export function syncWindow(
  milestones: readonly MilestoneEvent[],
  today: string,
  opts: { pastDays?: number; futureDays?: number } = {},
): MilestoneEvent[] {
  const { pastDays = 30, futureDays = 365 } = opts
  const shift = (days: number) => {
    const d = new Date(`${today}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + days)
    return d.toISOString().slice(0, 10)
  }
  const from = shift(-pastDays)
  const to = shift(futureDays)
  return milestones.filter((m) => m.date >= from && m.date <= to)
}

/** The calendar this app creates and owns. */
export const CALENDAR_SUMMARY = 'TNT Operations — Incubation'
export const CALENDAR_DESCRIPTION =
  'Incubation milestones from TNT Operations. Managed automatically — changes made here are overwritten.'

/**
 * The narrowest scope that does the job.
 *
 * `calendar.app.created` grants access ONLY to calendars this app created, so
 * connecting cannot expose anyone's personal calendar. It is also a smaller ask
 * in Google's OAuth verification review than full calendar access.
 */
export const GCAL_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created'
