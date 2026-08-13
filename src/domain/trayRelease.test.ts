import { describe, it, expect } from 'vitest'
import { decideTrayRelease } from './trayRelease'
import type { Tray, ShelterTrayLink } from '@/data/types'

const tray = (over: Partial<Tray> & { id: string; trayNumber: string }): Tray => ({
  sampleId: 's1',
  incubationBatchId: null,
  incubatorId: 'inc1',
  weightLbs: null,
  liveCount: null,
  parasiteLevelPct: null,
  volumeGal: null,
  inDate: null,
  outDate: null,
  coolDate: null,
  status: 'in_incubator',
  notes: '',
  ...over,
})

const link = (trayId: string, shelterId: string): ShelterTrayLink => ({
  id: `l_${trayId}`,
  trayId,
  shelterId,
  scannedAt: '2026-08-13T10:00:00Z',
  scannedBy: 'Darren',
})

const trays = [tray({ id: 't1', trayNumber: 'T-1001' }), tray({ id: 't2', trayNumber: 'T-1002' })]

describe('decideTrayRelease', () => {
  it('releases a tray into the shelter', () => {
    const d = decideTrayRelease({ label: 'T-1001', shelterId: 'sh1', trays, links: [] })
    expect(d).toMatchObject({ action: 'release', caveat: null })
  })

  it('matches the label case- and space-insensitively', () => {
    const d = decideTrayRelease({ label: '  t-1001 ', shelterId: 'sh1', trays, links: [] })
    expect(d.action).toBe('release')
  })

  it('refuses an unknown label instead of inventing a tray', () => {
    // A block can be registered by scanning it; a tray carries a sample, a
    // weight and an incubator, none of which a field scan can invent.
    expect(decideTrayRelease({ label: 'T-9999', shelterId: 'sh1', trays, links: [] }).action).toBe(
      'unknown',
    )
  })

  it('says nothing changed when re-scanned into the same shelter', () => {
    const d = decideTrayRelease({
      label: 'T-1001',
      shelterId: 'sh1',
      trays,
      links: [link('t1', 'sh1')],
    })
    expect(d.action).toBe('already-here')
  })

  it('asks before moving a tray that is already in another shelter', () => {
    // Two shelters both claiming the same trays is worse than a refused scan.
    const d = decideTrayRelease({
      label: 'T-1001',
      shelterId: 'sh2',
      trays,
      links: [link('t1', 'sh1')],
    })
    expect(d).toMatchObject({ action: 'confirm-move', fromShelterId: 'sh1' })
  })

  it('still records a tray that was not in an incubator, with a caveat', () => {
    const loose = [tray({ id: 't3', trayNumber: 'T-1003', incubatorId: null })]
    const d = decideTrayRelease({ label: 'T-1003', shelterId: 'sh1', trays: loose, links: [] })
    expect(d.action).toBe('release')
    expect(d).toHaveProperty('caveat', expect.stringContaining('not in an incubator'))
  })

  it('treats an empty scan as unknown', () => {
    expect(decideTrayRelease({ label: '   ', shelterId: 'sh1', trays, links: [] }).action).toBe('unknown')
  })
})
