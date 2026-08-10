/**
 * Tests for the Google Calendar projection.
 *
 * The two things that actually break a push-only sync are DELETION (stale
 * milestones left behind after a run shifts) and ID STABILITY (a re-sync
 * duplicating the calendar instead of updating it). Most of these prove one or
 * the other.
 */
import { describe, it, expect } from 'vitest'
import type { MilestoneEvent } from './incubation'
import {
  CALENDAR_SUMMARY,
  GCAL_SCOPE,
  type SyncedEvent,
  diffEvents,
  eventIdFor,
  syncWindow,
  toGcalEvent,
} from './calendarSync'

const ms = (over: Partial<MilestoneEvent> = {}): MilestoneEvent => ({
  date: '2026-08-10',
  day: 12,
  label: 'Vapona out',
  incubatorId: 'inc_1',
  incubatorName: 'Incubator 1',
  ...over,
})

// ═══════════════════════════════════════════════════════════════════════════
// Event ids
// ═══════════════════════════════════════════════════════════════════════════

describe('eventIdFor', () => {
  it('is stable for the same milestone', () => {
    // The whole point: a re-sync must UPDATE, not duplicate.
    expect(eventIdFor('inc_1', 12, 'Vapona out')).toBe(eventIdFor('inc_1', 12, 'Vapona out'))
  })

  it('differs per incubator, per day and per label', () => {
    const base = eventIdFor('inc_1', 12, 'Vapona out')
    expect(eventIdFor('inc_2', 12, 'Vapona out')).not.toBe(base)
    expect(eventIdFor('inc_1', 13, 'Vapona out')).not.toBe(base)
    expect(eventIdFor('inc_1', 12, 'Earliest cool')).not.toBe(base)
  })

  it('only uses characters Google accepts', () => {
    // Google's rule is base32hex: a–v and 0–9. A normal uuid contains letters
    // outside that range and is rejected with a 400 that never mentions the id.
    for (const id of [
      eventIdFor('inc_1', 1, 'A'),
      eventIdFor('550e8400-e29b-41d4-a716-446655440000', 99, 'Expected release'),
      eventIdFor('', 0, ''),
    ]) {
      expect(id).toMatch(/^[a-v0-9]+$/)
      expect(id.length).toBeGreaterThanOrEqual(5)
      expect(id.length).toBeLessThanOrEqual(1024)
    }
  })

  it('does not collide across a realistic set', () => {
    const ids = new Set<string>()
    for (let inc = 0; inc < 20; inc++) {
      for (const day of [0, 3, 7, 12, 18, 21, 28]) {
        for (const label of ['Vapona in', 'Vapona out', 'Earliest cool', 'Expected release']) {
          ids.add(eventIdFor(`inc_${inc}`, day, label))
        }
      }
    }
    expect(ids.size).toBe(20 * 7 * 4)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Event shape
// ═══════════════════════════════════════════════════════════════════════════

describe('toGcalEvent', () => {
  it('is an all-day event ending the NEXT day', () => {
    // Google's all-day `end` is exclusive. Same-day start and end renders a
    // zero-length event that some clients hide entirely.
    const e = toGcalEvent(ms())
    expect(e.start).toEqual({ date: '2026-08-10' })
    expect(e.end).toEqual({ date: '2026-08-11' })
  })

  it('rolls the end date over a month boundary', () => {
    expect(toGcalEvent(ms({ date: '2026-08-31' })).end.date).toBe('2026-09-01')
  })

  it('rolls over a year boundary', () => {
    expect(toGcalEvent(ms({ date: '2026-12-31' })).end.date).toBe('2027-01-01')
  })

  it('handles a leap day', () => {
    expect(toGcalEvent(ms({ date: '2028-02-28' })).end.date).toBe('2028-02-29')
    expect(toGcalEvent(ms({ date: '2028-02-29' })).end.date).toBe('2028-03-01')
  })

  it('names the incubator, the milestone and the day', () => {
    expect(toGcalEvent(ms()).summary).toBe('Incubator 1 — Vapona out (Day 12)')
  })

  it('says the event is managed, so nobody edits it expecting it to stick', () => {
    expect(toGcalEvent(ms()).description).toContain('overwritten')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Diffing
// ═══════════════════════════════════════════════════════════════════════════

describe('diffEvents', () => {
  it('creates everything on a first sync', () => {
    const d = diffEvents([ms(), ms({ day: 18, label: 'Earliest cool', date: '2026-08-16' })], [])
    expect(d.upsert).toHaveLength(2)
    expect(d.remove).toEqual([])
    expect(d.unchanged).toEqual([])
  })

  it('does nothing when nothing changed', () => {
    // A full re-push rewrites every `updated` timestamp, which makes every
    // event look freshly changed in someone's notification feed.
    const m = ms()
    const synced: SyncedEvent[] = [
      { eventId: eventIdFor('inc_1', 12, 'Vapona out'), date: m.date, summary: toGcalEvent(m).summary },
    ]
    const d = diffEvents([m], synced)
    expect(d.upsert).toEqual([])
    expect(d.remove).toEqual([])
    expect(d.unchanged).toHaveLength(1)
  })

  it('updates an event whose DATE moved', () => {
    const synced: SyncedEvent[] = [
      { eventId: eventIdFor('inc_1', 12, 'Vapona out'), date: '2026-08-10', summary: toGcalEvent(ms()).summary },
    ]
    const d = diffEvents([ms({ date: '2026-08-14' })], synced)
    expect(d.upsert).toHaveLength(1)
    expect(d.upsert[0].start.date).toBe('2026-08-14')
    expect(d.remove).toEqual([])
  })

  it('updates an event whose TITLE changed', () => {
    // An incubator rename has to reach the calendar, or it goes stale silently.
    const synced: SyncedEvent[] = [
      { eventId: eventIdFor('inc_1', 12, 'Vapona out'), date: '2026-08-10', summary: 'Old name — Vapona out (Day 12)' },
    ]
    expect(diffEvents([ms()], synced).upsert).toHaveLength(1)
  })

  it('REMOVES a milestone that no longer exists', () => {
    // The failure this prevents: a run's start date moves, every milestone
    // moves with it, and the old events sit alongside the new ones. A crew
    // then sees two "Vapona out" dates with no way to tell which is real.
    const synced: SyncedEvent[] = [
      { eventId: 'tnt0000000000000', date: '2026-01-01', summary: 'Gone — Vapona out (Day 12)' },
    ]
    const d = diffEvents([ms()], synced)
    expect(d.remove).toEqual(['tnt0000000000000'])
    expect(d.upsert).toHaveLength(1)
  })

  it('removes everything when the last run is deleted', () => {
    const synced: SyncedEvent[] = [
      { eventId: 'a1', date: '2026-01-01', summary: 'x' },
      { eventId: 'a2', date: '2026-01-02', summary: 'y' },
    ]
    const d = diffEvents([], synced)
    expect(d.remove).toEqual(['a1', 'a2'])
    expect(d.upsert).toEqual([])
  })

  it('handles a mix of all three in one pass', () => {
    const keep = ms()
    const moved = ms({ day: 18, label: 'Earliest cool', date: '2026-08-20' })
    const synced: SyncedEvent[] = [
      { eventId: eventIdFor('inc_1', 12, 'Vapona out'), date: keep.date, summary: toGcalEvent(keep).summary },
      { eventId: eventIdFor('inc_1', 18, 'Earliest cool'), date: '2026-08-16', summary: toGcalEvent(moved).summary },
      { eventId: 'tnt00000stale000', date: '2025-01-01', summary: 'Old' },
    ]
    const d = diffEvents([keep, moved], synced)
    expect(d.unchanged).toHaveLength(1)
    expect(d.upsert).toHaveLength(1)
    expect(d.remove).toEqual(['tnt00000stale000'])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Window
// ═══════════════════════════════════════════════════════════════════════════

describe('syncWindow', () => {
  const TODAY = '2026-08-10'

  it('keeps upcoming milestones', () => {
    expect(syncWindow([ms({ date: '2026-09-01' })], TODAY)).toHaveLength(1)
  })

  it('keeps a short tail of recent history', () => {
    expect(syncWindow([ms({ date: '2026-07-20' })], TODAY)).toHaveLength(1)
  })

  it('drops the distant past', () => {
    // Otherwise the calendar accumulates every milestone since installation and
    // becomes unreadable.
    expect(syncWindow([ms({ date: '2024-05-01' })], TODAY)).toEqual([])
  })

  it('drops the distant future', () => {
    expect(syncWindow([ms({ date: '2030-01-01' })], TODAY)).toEqual([])
  })

  it('includes both boundaries', () => {
    expect(syncWindow([ms({ date: '2026-07-11' })], TODAY, { pastDays: 30 })).toHaveLength(1)
    expect(syncWindow([ms({ date: '2026-07-10' })], TODAY, { pastDays: 31 })).toHaveLength(1)
  })

  it('takes a custom window', () => {
    expect(syncWindow([ms({ date: '2026-08-12' })], TODAY, { futureDays: 1 })).toEqual([])
    expect(syncWindow([ms({ date: '2026-08-11' })], TODAY, { futureDays: 1 })).toHaveLength(1)
  })
})

describe('constants', () => {
  it('asks for the narrowest scope that works', () => {
    // calendar.app.created reaches only calendars this app made, so connecting
    // cannot expose a personal calendar — and it is a smaller ask in Google's
    // verification review than full calendar access.
    expect(GCAL_SCOPE).toBe('https://www.googleapis.com/auth/calendar.app.created')
    expect(GCAL_SCOPE).not.toContain('auth/calendar ')
  })

  it('names the calendar so it is obvious where it came from', () => {
    expect(CALENDAR_SUMMARY).toContain('TNT')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Drift guard
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A Netlify function cannot import from `src/`, so the milestone table, the
 * day→date offset and the event-id derivation exist twice — once in the domain
 * and once in `netlify/functions/lib/gcalConstants.mjs`.
 *
 * Duplication that can silently drift is the dangerous kind: change a milestone
 * day here and the calendar would keep pushing the old one indefinitely, with
 * nothing failing. These tests import BOTH and assert they agree, which is the
 * only reason the arrangement is acceptable.
 */
describe('the Netlify mirror matches the domain', () => {
  it('has the same milestone table', async () => {
    const mirror = await import('../../netlify/functions/lib/gcalConstants.mjs')
    const domain = await import('./incubation')
    expect(mirror.MILESTONES).toEqual(domain.INCUBATION_MILESTONES)
  })

  it('derives the same event ids', async () => {
    const mirror = await import('../../netlify/functions/lib/gcalConstants.mjs')
    for (const [id, day, label] of [
      ['inc_1', 1, 'Incubation Start'],
      ['inc_2', 23, 'Expected Release'],
      ['550e8400-e29b-41d4-a716-446655440000', 37, 'Latest Release'],
    ] as Array<[string, number, string]>) {
      expect(mirror.eventIdFor(id, day, label)).toBe(eventIdFor(id, day, label))
    }
  })

  it('places milestones on the same dates', async () => {
    const mirror = await import('../../netlify/functions/lib/gcalConstants.mjs')
    const domain = await import('./incubation')

    const incs = [{ id: 'inc_1', name: 'Incubator 1', incubationStart: '2026-08-01', tempMode: 'incubation' }]
    const fromDomain = domain.milestoneEvents(incs, [])

    // Same data, snake_case as it arrives from PostgREST.
    const fromMirror = mirror.milestoneEvents(
      [{ id: 'inc_1', name: 'Incubator 1', incubation_start: '2026-08-01', temp_mode: 'incubation' }],
      [],
    )

    expect(fromMirror).toEqual(fromDomain)
  })

  it('skips an incubator that is switched off, on both sides', async () => {
    const mirror = await import('../../netlify/functions/lib/gcalConstants.mjs')
    const domain = await import('./incubation')
    expect(
      domain.milestoneEvents([{ id: 'a', name: 'A', incubationStart: '2026-08-01', tempMode: 'off' }], []),
    ).toEqual([])
    expect(
      mirror.milestoneEvents([{ id: 'a', name: 'A', incubation_start: '2026-08-01', temp_mode: 'off' }], []),
    ).toEqual([])
  })

  it('falls back to the modal tray in-date identically', async () => {
    const mirror = await import('../../netlify/functions/lib/gcalConstants.mjs')
    const domain = await import('./incubation')

    const domainStart = domain.incubationStartFor({ id: 'a', incubationStart: '' }, [
      { incubatorId: 'a', status: 'active', inDate: '2026-08-05' },
      { incubatorId: 'a', status: 'active', inDate: '2026-08-05' },
      { incubatorId: 'a', status: 'active', inDate: '2026-08-09' },
    ])
    const mirrorStart = mirror.incubationStartFor({ id: 'a', incubation_start: '' }, [
      { incubator_id: 'a', status: 'active', in_date: '2026-08-05' },
      { incubator_id: 'a', status: 'active', in_date: '2026-08-05' },
      { incubator_id: 'a', status: 'active', in_date: '2026-08-09' },
    ])
    expect(mirrorStart).toBe(domainStart)
    expect(mirrorStart).toBe('2026-08-05')
  })

  it('treats "none" as not running on both sides', async () => {
    const mirror = await import('../../netlify/functions/lib/gcalConstants.mjs')
    const domain = await import('./incubation')
    expect(domain.incubationStartFor({ id: 'a', incubationStart: 'none' }, [])).toBeNull()
    expect(mirror.incubationStartFor({ id: 'a', incubation_start: 'none' }, [])).toBeNull()
  })
})
