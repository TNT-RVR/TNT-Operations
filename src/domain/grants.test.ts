import { describe, it, expect } from 'vitest'
import {
  claudeChatUrl,
  claudeUrlWasTruncated,
  CLAUDE_URL_MAX,
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

describe('claudeChatUrl', () => {
  it('puts the prompt in the URL so Claude opens ready to help', () => {
    const url = claudeChatUrl('Help me with the Bee Research Fund')
    expect(url.startsWith('https://claude.ai/new?q=')).toBe(true)
    expect(decodeURIComponent(url.split('?q=')[1])).toBe('Help me with the Bee Research Fund')
  })
  it('encodes newlines and special characters safely', () => {
    const prompt = 'GRANT: A & B\nCloses: 2026-09-01\nNotes: 50% match?'
    const url = claudeChatUrl(prompt)
    expect(url).not.toContain('\n')
    expect(url).not.toContain(' ')
    expect(decodeURIComponent(url.split('?q=')[1])).toBe(prompt)
  })
  it('falls back to a blank chat rather than sending a truncated prompt', () => {
    const huge = 'x'.repeat(CLAUDE_URL_MAX + 100)
    expect(claudeChatUrl(huge)).toBe('https://claude.ai/new')
    expect(claudeUrlWasTruncated(huge)).toBe(true)
  })
  it('a realistic grant prompt fits comfortably in the URL', () => {
    const prompt = claudeGrantPrompt({
      title: 'Sustainable CAP — On-Farm Efficiency Program',
      funder: 'Agriculture and Agri-Food Canada / Government of Alberta',
      url: 'https://www.alberta.ca/on-farm-efficiency-program',
      eligibilitySummary: 'Alberta producers investing in equipment or practices that improve efficiency and reduce emissions.',
      summary: 'Cost-share funding for on-farm efficiency upgrades.',
      closesOn: '2026-09-15',
      notesMd: 'Shelter trailers and incubator controls likely qualify. Need quotes from two suppliers first.',
    })
    expect(claudeUrlWasTruncated(prompt)).toBe(false)
    expect(claudeChatUrl(prompt)).toContain('?q=')
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
