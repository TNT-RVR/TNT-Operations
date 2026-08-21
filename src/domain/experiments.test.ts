import { describe, it, expect } from 'vitest'
import {
  canSaveNote,
  addItem,
  removeItem,
  countItems,
  experimentNames,
  notesForExperiment,
  type NoteItem,
} from './experiments'

const tray = (label: string): NoteItem => ({ kind: 'tray', label })
const block = (label: string): NoteItem => ({ kind: 'block', label })

describe('canSaveNote', () => {
  it('saves a note that is only text', () => {
    expect(canSaveNote({ notes: 'Half the shelters got double trays.', items: [] }).ok).toBe(true)
  })

  it('saves a note that is only a scan', () => {
    // "This tray was in the trial" is a complete record on its own.
    expect(canSaveNote({ notes: '', items: [tray('Tray0007')] }).ok).toBe(true)
  })

  it('refuses an entirely empty note', () => {
    const r = canSaveNote({ notes: '   ', items: [] })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toContain('scan')
  })
})

describe('addItem', () => {
  it('adds a new scan', () => {
    const r = addItem([], tray('Tray0007'))
    expect(r.added).toBe(true)
    expect(r.items).toHaveLength(1)
  })

  it('ignores the same tag scanned twice', () => {
    // A camera fires repeatedly while a tag sits in frame. That is a slip.
    const r = addItem([tray('Tray0007')], tray('Tray0007'))
    expect(r.added).toBe(false)
    expect(r.items).toHaveLength(1)
  })

  it('treats case and stray spaces as the same tag', () => {
    expect(addItem([tray('Tray0007')], tray('  tray0007 ')).added).toBe(false)
  })

  it('keeps a block and a tray that happen to share a label', () => {
    // Different tag on a different object; only the kinds make them distinct.
    const r = addItem([tray('7')], block('7'))
    expect(r.added).toBe(true)
    expect(r.items).toHaveLength(2)
  })

  it('keeps an unresolved label rather than dropping it', () => {
    // A scan that matched nothing is exactly the one worth investigating.
    const r = addItem([], { kind: 'block', label: 'BLK-9999', blockId: null })
    expect(r.items[0].label).toBe('BLK-9999')
  })
})

describe('removeItem and countItems', () => {
  it('removes by position', () => {
    expect(removeItem([tray('a'), tray('b')], 0)).toEqual([tray('b')])
  })

  it('counts each kind', () => {
    expect(countItems([tray('a'), block('b'), block('c')])).toEqual({ blocks: 2, trays: 1 })
  })
})

describe('experimentNames', () => {
  const note = (experiment: string, observedAt: string) => ({ experiment, observedAt })

  it('lists names most recently used first', () => {
    expect(
      experimentNames([
        note('Old trial', '2026-05-01T00:00:00Z'),
        note('Tray density 2026', '2026-08-01T00:00:00Z'),
      ]),
    ).toEqual(['Tray density 2026', 'Old trial'])
  })

  it('collapses a name that drifted in case, keeping the latest spelling', () => {
    expect(
      experimentNames([
        note('tray density', '2026-05-01T00:00:00Z'),
        note('Tray Density', '2026-08-01T00:00:00Z'),
      ]),
    ).toEqual(['Tray Density'])
  })

  it('leaves unfiled notes out of the list', () => {
    expect(experimentNames([note('  ', '2026-08-01T00:00:00Z')])).toEqual([])
  })
})

describe('notesForExperiment', () => {
  const n = (experiment: string, observedAt: string) => ({ experiment, observedAt })

  it('gathers one experiment, newest first', () => {
    const rows = [n('A', '2026-08-01T00:00:00Z'), n('B', '2026-08-02T00:00:00Z'), n('a', '2026-08-03T00:00:00Z')]
    expect(notesForExperiment(rows, 'A').map((x) => x.observedAt)).toEqual([
      '2026-08-03T00:00:00Z',
      '2026-08-01T00:00:00Z',
    ])
  })

  it('finds the unfiled notes under a blank name', () => {
    const rows = [n('', '2026-08-01T00:00:00Z'), n('A', '2026-08-02T00:00:00Z')]
    expect(notesForExperiment(rows, '')).toHaveLength(1)
  })
})
