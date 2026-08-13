import { describe, it, expect } from 'vitest'
import {
  crewStatus,
  sortCrews,
  STALE_AFTER_MS,
  crewOf,
  membersOf,
  leadOf,
  shouldBroadcastPosition,
  planJoin,
  planTakeLead,
  type LiveCrew,
  type CrewMember,
} from './crews'

const NOW = Date.parse('2026-08-13T12:00:00Z')
const agoMs = (ms: number) => new Date(NOW - ms).toISOString()

const crew = (over: Partial<LiveCrew> = {}): LiveCrew => ({
  name: 'Crew A',
  task: 'shelter',
  fieldId: 'f1',
  fieldName: 'Grassy Lake NW Pivot',
  lat: 49.83,
  lng: -111.6,
  placed: 10,
  total: 40,
  at: agoMs(5_000),
  ...over,
})

describe('crewStatus', () => {
  it('is live within a couple of broadcast intervals', () => {
    expect(crewStatus(crew(), NOW)).toMatchObject({ stale: false, label: 'live' })
  })

  it('goes stale once broadcasts stop', () => {
    const s = crewStatus(crew({ at: agoMs(STALE_AFTER_MS + 1000) }), NOW)
    expect(s.stale).toBe(true)
  })

  it('says how long ago in minutes, then hours', () => {
    expect(crewStatus(crew({ at: agoMs(4 * 60_000) }), NOW).label).toBe('4 min ago')
    expect(crewStatus(crew({ at: agoMs(45 * 60_000) }), NOW).label).toBe('45 min ago')
    expect(crewStatus(crew({ at: agoMs(3 * 3600_000) }), NOW).label).toBe('3 h ago')
  })

  it('handles a broadcast with an unusable timestamp', () => {
    // Never render "NaN min ago" at someone deciding where to drive.
    const s = crewStatus(crew({ at: 'not a date' }), NOW)
    expect(s.stale).toBe(true)
    expect(s.label).toBe('no signal')
  })

  it('never reports a negative age from a clock skew', () => {
    // Phone clocks run fast. A future timestamp must read as live, not as a
    // negative number of minutes.
    const s = crewStatus(crew({ at: new Date(NOW + 30_000).toISOString() }), NOW)
    expect(s.ageMs).toBe(0)
    expect(s.stale).toBe(false)
  })
})

describe('sortCrews', () => {
  it('puts live crews above quiet ones', () => {
    const out = sortCrews(
      [crew({ name: 'Quiet', at: agoMs(10 * 60_000) }), crew({ name: 'Live', placed: 39 })],
      NOW,
    )
    expect(out.map((c) => c.name)).toEqual(['Live', 'Quiet'])
  })

  it('puts the crew furthest behind first', () => {
    // The list answers "who needs help", so a crew at 10% must not sit below
    // one that has just finished.
    const out = sortCrews(
      [
        crew({ name: 'Nearly done', placed: 38, total: 40 }),
        crew({ name: 'Behind', placed: 4, total: 40 }),
      ],
      NOW,
    )
    expect(out.map((c) => c.name)).toEqual(['Behind', 'Nearly done'])
  })

  it('treats a crew with no shelters as 0% rather than dividing by zero', () => {
    const out = sortCrews([crew({ name: 'Empty', placed: 0, total: 0 }), crew({ name: 'Half', placed: 20 })], NOW)
    expect(out[0].name).toBe('Empty')
  })

  it('falls back to name for a tie', () => {
    const out = sortCrews([crew({ name: 'B' }), crew({ name: 'A' })], NOW)
    expect(out.map((c) => c.name)).toEqual(['A', 'B'])
  })
})

describe('crew membership', () => {
  const m = (over: Partial<CrewMember> & { id: string; userId: string; crewId: string }): CrewMember => ({
    role: 'member',
    joinedAt: '2026-08-13T06:00:00Z',
    leftAt: null,
    ...over,
  })

  const members: CrewMember[] = [
    m({ id: 'cm1', crewId: 'c1', userId: 'ipad1', role: 'lead' }),
    m({ id: 'cm2', crewId: 'c1', userId: 'u1' }),
    m({ id: 'cm3', crewId: 'c1', userId: 'u2', leftAt: '2026-08-13T09:00:00Z' }),
    m({ id: 'cm4', crewId: 'c2', userId: 'ipad2', role: 'lead' }),
  ]

  it('ignores people who have left', () => {
    expect(membersOf(members, 'c1').map((x) => x.userId)).toEqual(['ipad1', 'u1'])
    expect(crewOf(members, 'u2')).toBeNull()
  })

  it('finds the lead', () => {
    expect(leadOf(members, 'c1')?.userId).toBe('ipad1')
    expect(leadOf(members, 'c3')).toBeNull()
  })

  it('broadcasts position only from the lead device', () => {
    // Three phones in one truck all reporting would draw the crew as a smear
    // of pins that disagree with each other.
    expect(shouldBroadcastPosition(members, 'ipad1')).toBe(true)
    expect(shouldBroadcastPosition(members, 'u1')).toBe(false)
    expect(shouldBroadcastPosition(members, null)).toBe(false)
  })

  it('broadcasts nothing for a crew with no lead', () => {
    // Better an honest gap than a position that moves when one person walks off.
    const noLead = [m({ id: 'x1', crewId: 'c9', userId: 'u9' })]
    expect(shouldBroadcastPosition(noLead, 'u9')).toBe(false)
  })

  it('leaves the old crew when joining another', () => {
    // People get moved mid-morning and nobody presses "leave" first.
    expect(planJoin(members, 'u1', 'c2')).toEqual({ leave: ['cm2'], join: true })
  })

  it('does nothing when joining the crew you are already on', () => {
    expect(planJoin(members, 'u1', 'c1')).toEqual({ leave: [], join: false })
  })

  it('just joins when on no crew', () => {
    expect(planJoin(members, 'newbie', 'c1')).toEqual({ leave: [], join: true })
  })

  it('does not resurrect a membership that was left', () => {
    // u2 left c1 this morning; re-joining must create a new row, not reopen it.
    expect(planJoin(members, 'u2', 'c1')).toEqual({ leave: [], join: true })
  })
})

describe('planTakeLead', () => {
  const m = (over: Partial<CrewMember> & { id: string; userId: string; crewId: string }): CrewMember => ({
    role: 'member',
    joinedAt: '2026-08-13T06:00:00Z',
    leftAt: null,
    ...over,
  })

  it('demotes the old lead while promoting the new one', () => {
    // A crew has exactly one reporter. Promoting without demoting is rejected
    // by the database, and in mock produced two leads where the button looked
    // like it did nothing.
    const members = [
      m({ id: 'a', crewId: 'c1', userId: 'ipad', role: 'lead' }),
      m({ id: 'b', crewId: 'c1', userId: 'me' }),
    ]
    expect(planTakeLead(members, 'me', 'c1')).toEqual({ demote: ['a'], promote: 'b' })
  })

  it('is a no-op when already the lead', () => {
    const members = [m({ id: 'a', crewId: 'c1', userId: 'me', role: 'lead' })]
    expect(planTakeLead(members, 'me', 'c1')).toEqual({ demote: [], promote: null })
  })

  it('promotes with nothing to demote when the crew has no lead', () => {
    const members = [m({ id: 'b', crewId: 'c1', userId: 'me' })]
    expect(planTakeLead(members, 'me', 'c1')).toEqual({ demote: [], promote: 'b' })
  })

  it('ignores leads of other crews', () => {
    const members = [
      m({ id: 'x', crewId: 'c2', userId: 'other', role: 'lead' }),
      m({ id: 'b', crewId: 'c1', userId: 'me' }),
    ]
    expect(planTakeLead(members, 'me', 'c1')).toEqual({ demote: [], promote: 'b' })
  })

  it('ignores a lead who has already left', () => {
    const members = [
      m({ id: 'a', crewId: 'c1', userId: 'gone', role: 'lead', leftAt: '2026-08-13T09:00:00Z' }),
      m({ id: 'b', crewId: 'c1', userId: 'me' }),
    ]
    expect(planTakeLead(members, 'me', 'c1')).toEqual({ demote: [], promote: 'b' })
  })
})
