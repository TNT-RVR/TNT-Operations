import { describe, it, expect } from 'vitest'
import { crewStatus, sortCrews, STALE_AFTER_MS, type LiveCrew } from './crews'

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
