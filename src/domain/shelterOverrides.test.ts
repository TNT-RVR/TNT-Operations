import { describe, it, expect } from 'vitest'
import { comboKey, applyShelterOverrides, syncComboAdjustments, reflowToGrid } from './shelterOverrides'

const P = [
  { lat: 49.1, lng: -111.1 },
  { lat: 49.2, lng: -111.2 },
  { lat: 49.3, lng: -111.3 },
]

describe('comboKey (mirrors desktop _combo_key)', () => {
  it('encodes mode + typed count + outside-pass + spray-both', () => {
    expect(comboKey({ shelter_mode: 'total', num_structures: '24' })).toBe('total|num_structures=24|out=Yes|both=0')
    expect(
      comboKey({ shelter_mode: 'per_acre', shelters_per_acre: '0.5', shelters_in_outside_pass: 'No', spray_both_ways: true }),
    ).toBe('per_acre|shelters_per_acre=0.5|out=No|both=1')
  })
  it('derived modes (trays) have no count key', () => {
    expect(comboKey({ shelter_mode: 'trays_2' })).toBe('trays_2|undefined=|out=Yes|both=0')
  })
})

describe('applyShelterOverrides', () => {
  it('replaces moved pins and drops deleted ones, keeping grid indices', () => {
    const out = applyShelterOverrides(P, { '0': [50.0, -112.0], '2': null })
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({ lat: 50.0, lng: -112.0, gridIdx: 0 })
    expect(out[1].gridIdx).toBe(1)
  })
  it('ignores out-of-range and malformed entries', () => {
    const out = applyShelterOverrides(P, { '99': [1, 2], 'x': [1, 2] } as never)
    expect(out).toHaveLength(3)
  })
  it('no overrides → identity with indices', () => {
    expect(applyShelterOverrides(P, null).map((p) => p.gridIdx)).toEqual([0, 1, 2])
  })
})

describe('syncComboAdjustments (stash + swap per combo)', () => {
  it('same combo just registers the live set', () => {
    const f = { shelter_mode: 'total', num_structures: '24', shelter_overrides: { '1': null } }
    const { patch, combo } = syncComboAdjustments(f, comboKey(f))
    expect(patch.shelter_overrides).toBeUndefined() // live set untouched
    expect((patch.adjust_by_combo as Record<string, { shelter_overrides: unknown }>)[combo].shelter_overrides).toEqual({ '1': null })
  })
  it('combo change stashes the old set and swaps in the new (empty if none)', () => {
    const oldCombo = comboKey({ shelter_mode: 'total', num_structures: '24' })
    const f = {
      shelter_mode: 'total',
      num_structures: '30', // count changed → new combo
      shelter_overrides: { '2': [50, -112] },
      adjust_by_combo: {},
    }
    const { patch, combo } = syncComboAdjustments(f, oldCombo)
    expect(combo).not.toBe(oldCombo)
    const store = patch.adjust_by_combo as Record<string, { shelter_overrides: unknown }>
    expect(store[oldCombo].shelter_overrides).toEqual({ '2': [50, -112] }) // stashed
    expect(patch.shelter_overrides).toEqual({}) // new combo starts empty
  })
  it('switching back restores the stashed set', () => {
    const comboA = comboKey({ shelter_mode: 'total', num_structures: '24' })
    const f = {
      shelter_mode: 'total',
      num_structures: '24', // back to combo A
      shelter_overrides: {},
      adjust_by_combo: { [comboA]: { shelter_overrides: { '0': null }, tray_overrides: {} } },
    }
    const { patch } = syncComboAdjustments(f, comboKey({ shelter_mode: 'total', num_structures: '30' }))
    expect(patch.shelter_overrides).toEqual({ '0': null })
  })
})

describe('reflowToGrid', () => {
  it('clears the live + stored overrides for the current combo only', () => {
    const comboA = comboKey({ shelter_mode: 'total', num_structures: '24' })
    const f = {
      shelter_mode: 'total',
      num_structures: '24',
      shelter_overrides: { '0': null },
      adjust_by_combo: { [comboA]: { shelter_overrides: { '0': null }, tray_overrides: {} }, other: { shelter_overrides: { '5': null }, tray_overrides: {} } },
    }
    const patch = reflowToGrid(f)
    expect(patch.shelter_overrides).toEqual({})
    const store = patch.adjust_by_combo as Record<string, { shelter_overrides: unknown }>
    expect(store[comboA].shelter_overrides).toEqual({})
    expect(store.other.shelter_overrides).toEqual({ '5': null }) // untouched
  })
})
