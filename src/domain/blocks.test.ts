import { describe, it, expect } from 'vitest'
import {
  beeReturnLbs,
  hasImpossibleWeights,
  blockStage,
  nextAction,
  daysInField,
  returnsByField,
  seasonSummary,
  blockHistory,
  seasonsOf,
  findBlock,
  lbsToKgWeight,
  checkWeight,
} from './blocks'
import type { Block, BlockPlacement } from '@/data/types'

const p = (over: Partial<BlockPlacement> = {}): BlockPlacement => ({
  id: 'p1',
  blockId: 'b1',
  season: 2026,
  fieldId: 'f1',
  shelterId: null,
  lat: null,
  lng: null,
  placedAt: '2026-06-01T12:00:00Z',
  placedBy: '',
  retrievedAt: null,
  grossWeightLbs: null,
  retrievedBy: '',
  strippedAt: null,
  strippedWeightLbs: null,
  strippedBy: '',
  notes: '',
  ...over,
})

describe('beeReturnLbs', () => {
  it('is gross minus stripped', () => {
    expect(beeReturnLbs({ grossWeightLbs: 12.5, strippedWeightLbs: 4.5 })).toBe(8)
  })

  it('is null until BOTH weigh-ins exist', () => {
    // A partial answer would read as "no bees" instead of "not weighed yet".
    expect(beeReturnLbs({ grossWeightLbs: 12.5, strippedWeightLbs: null })).toBeNull()
    expect(beeReturnLbs({ grossWeightLbs: null, strippedWeightLbs: 4.5 })).toBeNull()
    expect(beeReturnLbs({ grossWeightLbs: null, strippedWeightLbs: null })).toBeNull()
  })

  it('treats a zero return as a real measurement, not a missing one', () => {
    expect(beeReturnLbs({ grossWeightLbs: 4.5, strippedWeightLbs: 4.5 })).toBe(0)
  })
})

describe('hasImpossibleWeights', () => {
  it('flags a stripped weight heavier than the gross', () => {
    expect(hasImpossibleWeights({ grossWeightLbs: 4, strippedWeightLbs: 9 })).toBe(true)
  })

  it('does not flag incomplete or valid weights', () => {
    expect(hasImpossibleWeights({ grossWeightLbs: 9, strippedWeightLbs: 4 })).toBe(false)
    expect(hasImpossibleWeights({ grossWeightLbs: 9, strippedWeightLbs: null })).toBe(false)
  })
})

describe('blockStage / nextAction', () => {
  it('advances with each scan', () => {
    expect(blockStage(p())).toBe('placed')
    expect(blockStage(p({ retrievedAt: '2026-08-01T00:00:00Z' }))).toBe('retrieved')
    expect(blockStage(p({ retrievedAt: '2026-08-01T00:00:00Z', strippedAt: '2026-08-05T00:00:00Z' }))).toBe(
      'stripped',
    )
  })

  it('reports stripped even if the retrieve scan was missed', () => {
    // Data beats process: a stripped block is stripped regardless.
    expect(blockStage(p({ strippedAt: '2026-08-05T00:00:00Z' }))).toBe('stripped')
  })

  it('names the scan a block is waiting for', () => {
    expect(nextAction(p())).toBe('retrieve')
    expect(nextAction(p({ retrievedAt: '2026-08-01T00:00:00Z' }))).toBe('strip')
    expect(nextAction(p({ strippedAt: '2026-08-05T00:00:00Z' }))).toBeNull()
  })
})

describe('daysInField', () => {
  it('counts to the retrieve date once retrieved', () => {
    expect(daysInField(p({ retrievedAt: '2026-06-11T12:00:00Z' }))).toBe(10)
  })

  it('counts to today while still out', () => {
    expect(daysInField(p(), new Date('2026-06-04T12:00:00Z'))).toBe(3)
  })

  it('is null with no placement date', () => {
    expect(daysInField(p({ placedAt: null }))).toBeNull()
  })
})

describe('returnsByField', () => {
  it('totals per field and averages over weighed blocks only', () => {
    const rows = returnsByField([
      p({ id: 'a', fieldId: 'f1', grossWeightLbs: 10, strippedWeightLbs: 4 }), // 6
      p({ id: 'b', fieldId: 'f1', grossWeightLbs: 12, strippedWeightLbs: 4 }), // 8
      p({ id: 'c', fieldId: 'f1' }), // not weighed yet
      p({ id: 'd', fieldId: 'f2', grossWeightLbs: 5, strippedWeightLbs: 4 }), // 1
    ])
    const f1 = rows.find((r) => r.fieldId === 'f1')!
    expect(f1.blocks).toBe(3)
    expect(f1.weighed).toBe(2)
    expect(f1.totalReturnLbs).toBe(14)
    // 14/2, NOT 14/3 — an un-weighed block would drag the average down.
    expect(f1.avgReturnLbs).toBe(7)
  })

  it('sorts the best-producing field first', () => {
    const rows = returnsByField([
      p({ id: 'a', fieldId: 'low', grossWeightLbs: 5, strippedWeightLbs: 4 }),
      p({ id: 'b', fieldId: 'high', grossWeightLbs: 20, strippedWeightLbs: 4 }),
    ])
    expect(rows[0].fieldId).toBe('high')
  })

  it('gives an un-weighed field a null average rather than zero', () => {
    expect(returnsByField([p({ fieldId: 'f1' })])[0].avgReturnLbs).toBeNull()
  })
})

describe('seasonSummary', () => {
  it('counts each block once, at its current stage', () => {
    const s = seasonSummary([
      p({ id: 'a' }),
      p({ id: 'b', retrievedAt: '2026-08-01T00:00:00Z', grossWeightLbs: 10 }),
      p({ id: 'c', retrievedAt: '2026-08-01T00:00:00Z', strippedAt: '2026-08-05T00:00:00Z', grossWeightLbs: 10, strippedWeightLbs: 4 }),
    ])
    expect(s).toMatchObject({ blocks: 3, placed: 1, retrieved: 1, stripped: 1, totalReturnLbs: 6 })
  })

  it('has no average before anything is weighed', () => {
    expect(seasonSummary([p(), p({ id: 'b' })]).avgReturnLbs).toBeNull()
  })
})

describe('blockHistory / seasonsOf', () => {
  const all = [
    p({ id: 'x', blockId: 'b1', season: 2025 }),
    p({ id: 'y', blockId: 'b1', season: 2026 }),
    p({ id: 'z', blockId: 'b2', season: 2026 }),
  ]

  it('returns one block’s seasons, newest first', () => {
    expect(blockHistory(all, 'b1').map((r) => r.season)).toEqual([2026, 2025])
  })

  it('lists distinct seasons newest first', () => {
    expect(seasonsOf(all)).toEqual([2026, 2025])
  })
})

describe('findBlock', () => {
  const blocks: Block[] = [
    { id: 'b1', label: 'BLK0421', notes: '', createdAt: '' },
    { id: 'b2', label: 'BLK0422', notes: '', createdAt: '' },
  ]

  it('matches case-insensitively and ignores surrounding space', () => {
    expect(findBlock(blocks, ' blk0421 ')?.id).toBe('b1')
  })

  it('returns nothing for an unknown or empty label', () => {
    expect(findBlock(blocks, 'BLK9999')).toBeUndefined()
    expect(findBlock(blocks, '  ')).toBeUndefined()
  })
})

describe('lbsToKgWeight', () => {
  it('converts, and passes null through', () => {
    expect(lbsToKgWeight(10)).toBeCloseTo(4.5359237, 6)
    expect(lbsToKgWeight(null)).toBeNull()
  })
})

describe('checkWeight', () => {
  const peers = [12.4, 12.8, 12.1, 13.0, 12.6, 12.9] // a normal season

  it('accepts an ordinary weight without comment', () => {
    expect(checkWeight(12.5, 'retrieve', null, peers)).toBeNull()
  })

  it('refuses zero or nonsense', () => {
    expect(checkWeight(0, 'retrieve', null, peers)?.level).toBe('error')
    expect(checkWeight(-3, 'retrieve', null, peers)?.level).toBe('error')
    expect(checkWeight(NaN, 'retrieve', null, peers)?.level).toBe('error')
  })

  it('refuses an empty weight at or above the full weight', () => {
    // Physically impossible, and it would store a negative bee return.
    const p = { grossWeightLbs: 12.5 }
    expect(checkWeight(12.5, 'strip', p, peers)?.level).toBe('error')
    expect(checkWeight(14, 'strip', p, peers)?.level).toBe('error')
    expect(checkWeight(4.5, 'strip', p, peers)).toBeNull()
  })

  it('catches a slipped decimal point against the season', () => {
    // 125 for 12.5 — the mistake this exists for. Nothing else would catch it:
    // it's a valid number in a valid field.
    expect(checkWeight(125, 'retrieve', null, peers)?.level).toBe('warn')
    expect(checkWeight(1.25, 'retrieve', null, peers)?.level).toBe('warn')
  })

  it('says nothing about a merely unusual block', () => {
    // Twice the usual is a real block having a good year, not a typo.
    expect(checkWeight(24, 'retrieve', null, peers)).toBeNull()
  })

  it('holds off judgement until the season has a normal', () => {
    // With four blocks weighed there is no "usual" yet, so only the absolute
    // bounds apply — better silent than crying wolf on the first day.
    expect(checkWeight(125, 'retrieve', null, [12, 13])).toBeNull()
    expect(checkWeight(500, 'retrieve', null, [12, 13])?.level).toBe('warn')
  })

  it('flags absolute nonsense whatever the season looks like', () => {
    expect(checkWeight(0.2, 'retrieve', null, [])?.level).toBe('warn')
    expect(checkWeight(900, 'retrieve', null, [])?.level).toBe('warn')
  })

  it('warns rather than refuses, so an odd block can still be recorded', () => {
    // The person holding the block knows more than the software does.
    expect(checkWeight(125, 'retrieve', null, peers)?.level).toBe('warn')
  })
})
