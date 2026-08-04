import { describe, it, expect } from 'vitest'
import { parseScan, findTrays } from './ScanHome'
import type { Tray } from '@/data/types'

const tray = (id: string, trayNumber: string, sampleId: string | null = 's1'): Tray => ({
  id,
  trayNumber,
  sampleId,
  incubationBatchId: null,
  incubatorId: null,
  weightLbs: null,
  liveCount: null,
  parasiteLevelPct: null,
  volumeGal: null,
  inDate: null,
  outDate: null,
  coolDate: null,
  status: 'active',
  notes: '',
})

describe('parseScan', () => {
  it('takes a plain label as-is', () => {
    expect(parseScan('Tray0417')).toBe('Tray0417')
    expect(parseScan('  Trays3001  ')).toBe('Trays3001')
  })

  it('pulls the id out of the old desktop app’s tray URL', () => {
    // qr_server.py encodes http://<lan-ip>:<port>/tray/<id>
    expect(parseScan('http://192.168.1.42:5151/tray/417')).toBe('417')
    expect(parseScan('https://host/tray/Tray0417?x=1')).toBe('Tray0417')
  })

  it('falls back to the last path segment of any other URL', () => {
    expect(parseScan('https://example.com/t/Trays3001')).toBe('Trays3001')
    expect(parseScan('https://example.com/Trays3001/')).toBe('Trays3001')
  })

  it('handles empty input without throwing', () => {
    expect(parseScan('')).toBe('')
    expect(parseScan('   ')).toBe('')
  })
})

describe('findTrays', () => {
  const all = [
    tray('a', 'Tray0417', 's1'),
    tray('b', 'Tray0417', 's2'), // same physical label, a different season/sample
    tray('c', 'Trays3001', 's1'),
  ]

  it('matches exactly, case-insensitively', () => {
    expect(findTrays(all, 'trays3001').map((t) => t.id)).toEqual(['c'])
  })

  it('returns every season a physical label has been used for', () => {
    // (sample_id, tray_number) is the identity — one label spans seasons.
    expect(findTrays(all, 'Tray0417').map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('tolerates the Tray/Trays prefix mismatch by falling back to the number', () => {
    // Real data mixes `Tray####` and `Trays####`; no numeric collisions exist.
    expect(findTrays(all, 'Trays0417').map((t) => t.id)).toEqual(['a', 'b'])
    expect(findTrays(all, '3001').map((t) => t.id)).toEqual(['c'])
    expect(findTrays(all, '417').map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('returns nothing for an unknown or empty label', () => {
    expect(findTrays(all, 'Tray9999')).toEqual([])
    expect(findTrays(all, '')).toEqual([])
  })
})
