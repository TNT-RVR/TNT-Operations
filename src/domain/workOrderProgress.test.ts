import { describe, it, expect } from 'vitest'
import { overdueJobs, jobIsComplete, OVERDUE_LOOKBACK_DAYS } from './workOrderProgress'

const TODAY = '2026-08-14'

const job = (over: Partial<Parameters<typeof overdueJobs>[0][number]> = {}) => ({
  eventId: 'e1',
  title: 'Shelters — Bow Island',
  crewId: 'c1',
  task: 'shelter' as const,
  fieldId: 'f1',
  startDate: '2026-08-11',
  endDate: null,
  lastDate: '2026-08-12',
  ...over,
})

const half = () => ({ placed: 34, planned: 48 })
const done = () => ({ placed: 48, planned: 48 })

describe('jobIsComplete', () => {
  it('calls a fully placed field done', () => {
    expect(jobIsComplete('shelter', done())).toBe(true)
    expect(jobIsComplete('shelter', { placed: 50, planned: 48 })).toBe(true)
  })

  it('does not call a half-placed field done', () => {
    expect(jobIsComplete('shelter', half())).toBe(false)
  })

  it('never claims a tray or removal job is finished', () => {
    // Neither has a count to read, and declaring them done on no evidence is
    // how unfinished work disappears.
    expect(jobIsComplete('tray', done())).toBe(false)
    expect(jobIsComplete('removal', done())).toBe(false)
  })

  it('treats a field with no plan as unfinished rather than complete', () => {
    expect(jobIsComplete('shelter', { placed: 0, planned: 0 })).toBe(false)
    expect(jobIsComplete('shelter', null)).toBe(false)
  })
})

describe('overdueJobs', () => {
  const progress = (p: ReturnType<typeof half> | null) => () => p

  it('keeps a job whose day has passed with work left', () => {
    const out = overdueJobs([job()], TODAY, progress(half()))
    expect(out).toHaveLength(1)
    expect(out[0].daysLate).toBe(2)
    expect(out[0].progress).toEqual(half())
  })

  it('drops a job whose field is fully placed', () => {
    expect(overdueJobs([job()], TODAY, progress(done()))).toEqual([])
  })

  it('says nothing about a job still running today', () => {
    // Booked through today is not late, however long ago it started.
    expect(overdueJobs([job({ lastDate: TODAY })], TODAY, progress(half()))).toEqual([])
    expect(overdueJobs([job({ lastDate: '2026-08-20' })], TODAY, progress(half()))).toEqual([])
  })

  it('forgets a job old enough to be a question for the office', () => {
    const ancient = job({ lastDate: '2026-07-01' })
    expect(overdueJobs([ancient], TODAY, progress(half()))).toEqual([])
  })

  it('keeps one right at the edge of the lookback', () => {
    const edge = job({ lastDate: '2026-07-31' }) // 14 days before today
    expect(overdueJobs([edge], TODAY, progress(half()))).toHaveLength(1)
    expect(overdueJobs([edge], TODAY, progress(half()))[0].daysLate).toBe(OVERDUE_LOOKBACK_DAYS)
  })

  it('keeps tray work that ran out of days, having no count to prove otherwise', () => {
    const trays = job({ task: 'tray', title: 'Trays — Bow Island' })
    expect(overdueJobs([trays], TODAY, progress(done()))).toHaveLength(1)
  })

  it('lists the most recently missed first', () => {
    const older = job({ eventId: 'e2', lastDate: '2026-08-05' })
    const newer = job({ eventId: 'e3', lastDate: '2026-08-13' })
    expect(overdueJobs([older, newer], TODAY, progress(half())).map((j) => j.eventId)).toEqual([
      'e3',
      'e2',
    ])
  })
})
