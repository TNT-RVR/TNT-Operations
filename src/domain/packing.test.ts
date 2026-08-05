/**
 * Golden-file tests for the packing port.
 *
 * The expected values come from the "Sale Cost Calculator" workbook's
 * `Item Specs` and `Shipping Calculator` sheets, as the sheets computed them.
 * The live example in the workbook is 80 Tray Tops + 100 Tray Bottoms, which
 * it packs onto 2 pallets at 632 lb / 286.670144 kg.
 *
 * Cases marked FIXES BUG assert corrected behaviour and cite what the sheet did.
 */
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_ITEM_SPECS,
  type ItemSpec,
  freightFor,
  packLine,
  packShipment,
  toMetric,
} from './packing'

const spec = (item: string): ItemSpec => {
  const s = DEFAULT_ITEM_SPECS.find((x) => x.item === item)
  if (!s) throw new Error(`no fixture spec for ${item}`)
  return s
}

/** The workbook's own worked example (Shipping Calculator rows 2–3 / 13–14). */
const WORKBOOK_ORDER = [
  { item: 'Tray Tops', qty: 80 },
  { item: 'Tray Bottoms', qty: 100 },
]

// ═══════════════════════════════════════════════════════════════════════════
// Item Specs — metric derived from imperial
// ═══════════════════════════════════════════════════════════════════════════

describe('toMetric', () => {
  it('derives the Tray Tops metric row (Item Specs B3:F3)', () => {
    const m = toMetric(spec('Tray Tops'))
    // The sheet multiplied by a truncated 0.453592; we use the exact
    // 0.45359237. That is a 3.7e-7 relative difference, so kg figures agree
    // with the sheet to 5 decimal places and no further. Lengths are exact
    // (25.4 mm/in is a definition, not an approximation).
    expect(m.weightKg).toBeCloseTo(1.5422128, 5)
    expect(m.lengthMm).toBeCloseTo(654.05, 10)
    expect(m.widthMm).toBeCloseTo(457.2, 10)
    expect(m.heightMm).toBeCloseTo(88.9, 10)
    expect(m.stackedHeightMm).toBeCloseTo(62.992, 10)
  })

  it('derives the Tray Bottoms metric row (Item Specs B4:F4)', () => {
    const m = toMetric(spec('Tray Bottoms'))
    expect(m.weightKg).toBeCloseTo(1.6329312, 5)
    expect(m.stackedHeightMm).toBeCloseTo(76.2, 10)
  })

  it('carries the non-dimensional fields through unchanged', () => {
    const m = toMetric(spec('Cubee Bottoms'))
    expect(m.maxItemsOnPallet).toBe(25)
    expect(m.stacksPerPallet).toBe(1)
    expect(m.palletSize).toBe('48x40')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// packLine — Shipping Calculator columns G:L
// ═══════════════════════════════════════════════════════════════════════════

describe('packLine', () => {
  it('reproduces the Tray Tops row (G2:L2 / G13:L13)', () => {
    const p = packLine({ item: 'Tray Tops', qty: 80 }, spec('Tray Tops'))
    expect(p.palletsExact).toBeCloseTo(0.64, 10) // G
    expect(p.pallets).toBe(1) // H
    expect(p.itemsPerPallet).toBe(80) // I
    expect(p.weightPerPalletLbs).toBeCloseTo(272, 10) // J13
    expect(p.totalWeightLbs).toBeCloseTo(272, 10) // K13
    expect(p.heightPerPalletIn).toBeCloseTo(49.6, 10) // L13 = 80/4 × 2.48
  })

  it('reproduces the Tray Bottoms row (G3:L3 / G14:L14)', () => {
    const p = packLine({ item: 'Tray Bottoms', qty: 100 }, spec('Tray Bottoms'))
    expect(p.palletsExact).toBeCloseTo(1, 10)
    expect(p.pallets).toBe(1)
    expect(p.itemsPerPallet).toBe(100)
    expect(p.weightPerPalletLbs).toBeCloseTo(360, 10)
    expect(p.totalWeightLbs).toBeCloseTo(360, 10)
  })

  it('rounds a part pallet up to a whole one', () => {
    // 500 tops at 125/pallet = exactly 4; 501 needs a fifth.
    expect(packLine({ item: 'Tray Tops', qty: 500 }, spec('Tray Tops')).pallets).toBe(4)
    expect(packLine({ item: 'Tray Tops', qty: 501 }, spec('Tray Tops')).pallets).toBe(5)
  })

  it('spreads items evenly across pallets, as the sheet did', () => {
    // 501 over 5 pallets reports 100.2 each — the average, not 125/125/125/125/1.
    const p = packLine({ item: 'Tray Tops', qty: 501 }, spec('Tray Tops'))
    expect(p.itemsPerPallet).toBeCloseTo(100.2, 10)
  })

  it('packs a zero-quantity line to nothing instead of throwing', () => {
    const p = packLine({ item: 'Tray Tops', qty: 0 }, spec('Tray Tops'))
    expect(p.pallets).toBe(0)
    expect(p.itemsPerPallet).toBe(0)
    expect(p.totalWeightLbs).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// packShipment — the workbook's totals
// ═══════════════════════════════════════════════════════════════════════════

describe('packShipment', () => {
  it('matches the workbook totals N2/N3 and N13/N14', () => {
    const s = packShipment(WORKBOOK_ORDER)
    expect(s.totalPallets).toBe(2) // N2 / N13
    expect(s.netWeightLbs).toBeCloseTo(632, 10) // N14
    // N3. At 632 lb the truncated-constant gap is 2.3e-4 kg — a quarter of a
    // milligram, and the exact constant is the correct one.
    expect(s.netWeightKg).toBeCloseTo(286.670144, 3) // N3
  })

  it('reports goods weight only when no pallet tare is given', () => {
    const s = packShipment(WORKBOOK_ORDER)
    expect(s.grossWeightLbs).toBe(s.netWeightLbs)
    expect(s.warnings.some((w) => w.includes('Pallet weight is set to 0'))).toBe(true)
  })

  it('FIXES BUG: adds pallet decks to the gross weight', () => {
    // The sheet totalled goods only. Two 40 lb pallets is another 80 lb the
    // carrier bills for.
    const s = packShipment(WORKBOOK_ORDER, DEFAULT_ITEM_SPECS, { palletTareLbs: 40 })
    expect(s.netWeightLbs).toBeCloseTo(632, 10)
    expect(s.grossWeightLbs).toBeCloseTo(712, 10)
    expect(s.warnings.some((w) => w.includes('Pallet weight is set to 0'))).toBe(false)
  })

  it('FIXES BUG: an item with no spec is reported, not silently weightless', () => {
    // Item Specs has Corners as a label with no measurements, and every lookup
    // was iferror(…, 0) — so this order used to come back as 2 pallets / 632 lb
    // with 5,000 corners aboard and no indication anything was missing.
    const s = packShipment([...WORKBOOK_ORDER, { item: 'Corners', qty: 5000 }])
    expect(s.unspecced).toHaveLength(1)
    expect(s.unspecced[0].item).toBe('Corners')
    expect(s.unspecced[0].qty).toBe(5000)
    expect(s.warnings.some((w) => w.includes('Corners'))).toBe(true)
    // Excluded from the totals rather than counted as zero.
    expect(s.totalPallets).toBe(2)
    expect(s.lines).toHaveLength(2)
  })

  it('treats a spec that fits 0 per pallet as unusable', () => {
    const broken: ItemSpec[] = [{ ...spec('Tray Tops'), maxItemsOnPallet: 0 }]
    const s = packShipment([{ item: 'Tray Tops', qty: 10 }], broken)
    expect(s.unspecced).toHaveLength(1)
    expect(s.totalPallets).toBe(0)
  })

  it('skips zero-quantity lines without flagging them', () => {
    const s = packShipment([...WORKBOOK_ORDER, { item: 'Corners', qty: 0 }])
    expect(s.unspecced).toHaveLength(0)
    expect(s.totalPallets).toBe(2)
  })

  it('counts trucks at the workbook capacity of 28 pallets', () => {
    const big = [{ item: 'Tray Tops', qty: 125 * 30 }] // 30 pallets
    const s = packShipment(big, DEFAULT_ITEM_SPECS, { maxPalletsPerTruck: 28 })
    expect(s.totalPallets).toBe(30)
    expect(s.trucksRequired).toBe(2)
  })

  it('leaves trucksRequired null when no capacity is given', () => {
    expect(packShipment(WORKBOOK_ORDER).trucksRequired).toBeNull()
  })

  it('flags an over-height pallet', () => {
    // 125 tops over 4 stacks × 2.48 in = 77.5 in, over an 80 in limit? No —
    // push it to 500 on one pallet's worth of stacking to exceed it.
    const s = packShipment([{ item: 'Tray Tops', qty: 125 }], DEFAULT_ITEM_SPECS, {
      maxPalletHeightIn: 70,
    })
    expect(s.tallestPalletIn).toBeCloseTo(77.5, 10)
    expect(s.warnings.some((w) => w.includes('over the 70 in limit'))).toBe(true)
  })

  it('reports the tallest pallet across mixed lines', () => {
    const s = packShipment(WORKBOOK_ORDER)
    // Tops: 80/4 × 2.48 = 49.6. Bottoms: 100/4 × 3.0 = 75.
    expect(s.tallestPalletIn).toBeCloseTo(75, 10)
  })

  it('is empty for an empty order', () => {
    const s = packShipment([])
    expect(s.totalPallets).toBe(0)
    expect(s.netWeightLbs).toBe(0)
    expect(s.warnings).toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Freight bands — Tray Cost (TNT) J4:L6
// ═══════════════════════════════════════════════════════════════════════════

describe('freightFor', () => {
  // New Jersey → Grassy Lake, the sheet's K5/L5.
  const BANDS = [
    { maxPallets: 11, price: 5675 },
    { maxPallets: 22, price: 7650 },
  ]

  it('picks the 11-pallet band for the workbook order of 9 pallets', () => {
    expect(freightFor(BANDS, 9)).toBe(5675)
  })

  it('picks the next band up once the first is exceeded', () => {
    expect(freightFor(BANDS, 12)).toBe(7650)
  })

  it('includes the boundary in the band it names', () => {
    expect(freightFor(BANDS, 11)).toBe(5675)
    expect(freightFor(BANDS, 22)).toBe(7650)
  })

  it('FIXES BUG: returns null past the largest band instead of extrapolating', () => {
    // The sheet's if((C14+C15)<=11, K6, L6) charged the 22-pallet price for a
    // 40-pallet load, which is not a quote anyone gave.
    expect(freightFor(BANDS, 40)).toBeNull()
  })

  it('returns null with no bands on file', () => {
    expect(freightFor([], 1)).toBeNull()
  })
})
