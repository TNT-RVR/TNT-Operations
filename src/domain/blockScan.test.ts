import { describe, it, expect } from 'vitest'
import { resolveScanField, decideWeighScan } from './blockScan'
import type { Block, BlockPlacement } from '@/data/types'

const block = (id: string, label: string): Block => ({
  id,
  label,
  notes: '',
  createdAt: '2026-06-01T00:00:00Z',
})

const placement = (over: Partial<BlockPlacement> = {}): BlockPlacement => ({
  id: 'bp1',
  blockId: 'b1',
  season: 2026,
  fieldId: 'f1',
  shelterId: null,
  lat: 49.87,
  lng: -111.74,
  placedAt: '2026-06-10T00:00:00Z',
  placedBy: 'Darren',
  retrievedAt: null,
  grossWeightLbs: null,
  retrievedBy: '',
  strippedAt: null,
  strippedWeightLbs: null,
  strippedBy: '',
  notes: '',
  ...over,
})

describe('resolveScanField', () => {
  const base = {
    mode: 'auto' as const,
    detectedFieldId: null,
    pickedFieldId: '',
    lastFieldId: '',
    overrideConfirmed: false,
  }

  it('files under the field the fix falls inside', () => {
    const r = resolveScanField({ ...base, detectedFieldId: 'f1' })
    expect(r).toMatchObject({ fieldId: 'f1', source: 'gps', canScan: true })
  })

  it('prefers the detected field over one picked earlier', () => {
    // Someone picks a field, then drives to the next one. The phone is right.
    const r = resolveScanField({ ...base, detectedFieldId: 'f2', pickedFieldId: 'f1' })
    expect(r.fieldId).toBe('f2')
    expect(r.source).toBe('gps')
  })

  it('falls back to the last field used when the fix is outside every boundary', () => {
    // Routine on a poor signal mid-field. "The field you have been working all
    // morning" is the truthful answer, not "nowhere".
    const r = resolveScanField({ ...base, lastFieldId: 'f3' })
    expect(r).toMatchObject({ fieldId: 'f3', source: 'last-used', canScan: true })
  })

  it('prefers an explicit pick over the remembered field', () => {
    const r = resolveScanField({ ...base, pickedFieldId: 'f1', lastFieldId: 'f3' })
    expect(r).toMatchObject({ fieldId: 'f1', source: 'manual' })
  })

  it('cannot scan with no fix, no pick and nothing remembered', () => {
    const r = resolveScanField(base)
    expect(r.canScan).toBe(false)
    expect(r.fieldId).toBe('')
  })

  it('pauses when a hand-picked field contradicts the GPS', () => {
    const r = resolveScanField({
      ...base,
      mode: 'manual',
      pickedFieldId: 'f1',
      detectedFieldId: 'f2',
    })
    expect(r.canScan).toBe(false)
    expect(r.blockedReason).toMatch(/disagrees/)
    // The pick is still what WOULD be used — the UI names it in the prompt.
    expect(r.fieldId).toBe('f1')
  })

  it('proceeds once that disagreement is confirmed', () => {
    const r = resolveScanField({
      ...base,
      mode: 'manual',
      pickedFieldId: 'f1',
      detectedFieldId: 'f2',
      overrideConfirmed: true,
    })
    expect(r).toMatchObject({ fieldId: 'f1', source: 'manual', canScan: true })
  })

  it('does not pause when the manual pick agrees with the GPS', () => {
    const r = resolveScanField({
      ...base,
      mode: 'manual',
      pickedFieldId: 'f1',
      detectedFieldId: 'f1',
    })
    expect(r.canScan).toBe(true)
  })

  it('ignores the remembered field in manual mode', () => {
    // Manual means manual: silently filing under yesterday's field because
    // today's box is empty is exactly what the mode exists to prevent.
    const r = resolveScanField({ ...base, mode: 'manual', lastFieldId: 'f3' })
    expect(r.canScan).toBe(false)
  })
})

describe('decideWeighScan', () => {
  const blocks = [block('b1', 'Block1234')]
  const season = 2026

  it('takes the weight for a placed block with no caveat', () => {
    const d = decideWeighScan({
      label: 'Block1234',
      mode: 'retrieve',
      season,
      blocks,
      placements: [placement()],
    })
    expect(d).toEqual({ action: 'weigh', label: 'Block1234', caveat: null })
  })

  it('registers an unknown label rather than refusing it', () => {
    const d = decideWeighScan({
      label: 'Block9999',
      mode: 'retrieve',
      season,
      blocks,
      placements: [],
    })
    expect(d.action).toBe('weigh')
    expect(d.label).toBe('Block9999')
    expect(d).toHaveProperty('caveat', 'New label — it will be registered.')
  })

  it('accepts a block with no placement this season, warning that one is created', () => {
    const d = decideWeighScan({
      label: 'Block1234',
      mode: 'retrieve',
      season,
      blocks,
      placements: [placement({ season: 2025 })],
    })
    expect(d.action).toBe('weigh')
    expect(d).toHaveProperty('caveat', 'No 2026 placement on record — it will be created.')
  })

  it('accepts a weigh-out on a block that was never weighed in', () => {
    // It yields no return — that is the cost, and it is stated rather than
    // being turned into a refusal.
    const d = decideWeighScan({
      label: 'Block1234',
      mode: 'strip',
      season,
      blocks,
      placements: [placement()],
    })
    expect(d.action).toBe('weigh')
    expect(d).toHaveProperty('caveat', 'Never weighed in, so this block gives no return.')
  })

  it('asks before replacing a weight already on file', () => {
    // A stray scan off the next pallet must not overwrite a good weight.
    const d = decideWeighScan({
      label: 'Block1234',
      mode: 'retrieve',
      season,
      blocks,
      placements: [placement({ grossWeightLbs: 4.62 })],
    })
    expect(d).toEqual({
      action: 'confirm-replace',
      label: 'Block1234',
      existingLbs: 4.62,
      stageLabel: 'weigh-in',
    })
  })

  it('asks per stage, not per block', () => {
    // Weighed in already, but never weighed out: the weigh-out proceeds.
    const p = placement({ grossWeightLbs: 4.62 })
    expect(decideWeighScan({ label: 'Block1234', mode: 'strip', season, blocks, placements: [p] }).action).toBe('weigh')
    expect(decideWeighScan({ label: 'Block1234', mode: 'retrieve', season, blocks, placements: [p] }).action).toBe(
      'confirm-replace',
    )
  })

  it('treats a zero weight as recorded, not as missing', () => {
    // 0 is falsy and would slip through a truthiness check — a real weight of
    // zero is wrong, but it is ON FILE, and overwriting it silently hides that.
    const d = decideWeighScan({
      label: 'Block1234',
      mode: 'retrieve',
      season,
      blocks,
      placements: [placement({ grossWeightLbs: 0 })],
    })
    expect(d.action).toBe('confirm-replace')
  })

  it('matches labels case- and space-insensitively', () => {
    const d = decideWeighScan({
      label: '  block1234 ',
      mode: 'retrieve',
      season,
      blocks,
      placements: [placement({ grossWeightLbs: 3 })],
    })
    expect(d.action).toBe('confirm-replace')
    // Reports the label as RECORDED, not as scanned.
    expect(d.label).toBe('Block1234')
  })

  it('keeps seasons apart', () => {
    // Last season's weights must not make this season's scan look done.
    const d = decideWeighScan({
      label: 'Block1234',
      mode: 'retrieve',
      season: 2026,
      blocks,
      placements: [placement({ season: 2025, grossWeightLbs: 4.62 })],
    })
    expect(d.action).toBe('weigh')
  })
})
