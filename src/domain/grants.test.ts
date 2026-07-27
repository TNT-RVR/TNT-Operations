import { describe, it, expect } from 'vitest'
import {
  moneyRange,
  closesLabel,
  closingSoon,
  isArchivedGrant,
  claudeGrantPrompt,
  GRANT_STATUSES,
  ACTIVE_GRANT_STATUSES,
  ARCHIVED_GRANT_STATUSES,
} from './grants'

const NOW = new Date('2026-07-27T12:00:00Z')

describe('moneyRange', () => {
  it('formats a range, an open-ended range, a single value, and nothing', () => {
    expect(moneyRange(5000, 50000)).toBe('$5,000–$50,000')
    expect(moneyRange(0, 50000)).toBe('up to $50,000')
    expect(moneyRange(10000, null)).toBe('$10,000')
    expect(moneyRange(null, 10000)).toBe('$10,000')
    expect(moneyRange(null, null)).toBe('—')
  })
})

describe('closesLabel', () => {
  it('says Ongoing with no date', () => {
    expect(closesLabel(null, NOW)).toBe('Ongoing')
  })
  it('counts down inside 30 days', () => {
    expect(closesLabel('2026-08-06', NOW)).toMatch(/Aug 6, 2026 · 10d left/)
  })
  it('shows a bare date beyond 30 days', () => {
    expect(closesLabel('2026-12-01', NOW)).toBe('Dec 1, 2026')
  })
  it('marks past dates closed', () => {
    expect(closesLabel('2026-01-02', NOW)).toBe('Closed Jan 2, 2026')
  })
})

describe('closingSoon', () => {
  it('is true only for open dates inside the window', () => {
    expect(closingSoon('2026-08-06', 30, NOW)).toBe(true)
    expect(closingSoon('2026-12-01', 30, NOW)).toBe(false)
    expect(closingSoon('2026-01-02', 30, NOW)).toBe(false) // already closed
    expect(closingSoon(null, 30, NOW)).toBe(false)
  })
})

describe('status vocabulary', () => {
  it('splits every status into exactly one of active/archived', () => {
    expect([...ACTIVE_GRANT_STATUSES, ...ARCHIVED_GRANT_STATUSES].sort()).toEqual([...GRANT_STATUSES].sort())
    for (const s of ACTIVE_GRANT_STATUSES) expect(isArchivedGrant(s)).toBe(false)
    for (const s of ARCHIVED_GRANT_STATUSES) expect(isArchivedGrant(s)).toBe(true)
  })
})

describe('claudeGrantPrompt', () => {
  it('includes the grant facts and omits blank fields', () => {
    const p = claudeGrantPrompt({
      title: 'Bee Research Fund',
      funder: 'AAFC',
      closesOn: '2026-09-01',
      notesMd: 'Talk to Darren first.',
    })
    expect(p).toContain('GRANT: Bee Research Fund')
    expect(p).toContain('Funder: AAFC')
    expect(p).toContain('Closes: 2026-09-01')
    expect(p).toContain('Our notes:\nTalk to Darren first.')
    expect(p).not.toContain('Link:') // url omitted
    expect(p).toContain('leafcutter-bee pollination business')
  })
})
