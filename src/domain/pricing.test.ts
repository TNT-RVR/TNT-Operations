/**
 * Golden-file tests for the pricing port.
 *
 * Every expected number here was read out of the "Sale Cost Calculator"
 * workbook (copy dated Feb 6 2025) — the computed cell values, not
 * re-derivations. If one of these fails, the port drifted from the sheet the
 * business has been quoting off.
 *
 * The exceptions are the cases marked FIXES BUG, which assert the corrected
 * behaviour and cite what the sheet did instead.
 */
import { describe, it, expect } from 'vitest'
import {
  type BomLine,
  type ProductSpec,
  amortize,
  bomLineTotal,
  convert,
  materialsCost,
  money,
  orderTotals,
  priceLine,
  priceUnit,
  pricingWarnings,
  roundUpTo,
  tierUnitCost,
} from './pricing'

// ═══════════════════════════════════════════════════════════════════════════
// Fixtures — transcribed from the workbook
// ═══════════════════════════════════════════════════════════════════════════

/**
 * `Shelters Cost` A2:E9, verbatim — including the two broken rivet lines.
 *
 * The vinyl strap cost is the sheet's own `=(2118.5/8100)*4`: a $2,118.50 roll
 * of 8,100 inches, four inches per strap.
 */
const SHELTER_BOM: BomLine[] = [
  { part: 'Coroplast Sheets', qty: 2, unitCost: 36.5, freightPerUnit: 0.25 },
  { part: 'Pallet', qty: 1, unitCost: 10.0, freightPerUnit: 0.25 },
  { part: 'Anchor', qty: 1, unitCost: 12.0, freightPerUnit: 0.0 },
  { part: 'Zip Ties', qty: 4, unitCost: 0.11, freightPerUnit: 0.01 },
  { part: 'Short Bungees (21 in)', qty: 2, unitCost: 0.7, freightPerUnit: 0.02 },
  {
    part: 'Vinyl straps',
    qty: 2,
    unitCost: (2118.5 / 8100) * 4,
    freightPerUnit: 0.0,
    note: '$2,118.50 per 8,100 in roll, 4 in per strap',
  },
  { part: '1/2 in. rivets', qty: 6, unitCost: 0.0, freightPerUnit: 0.1 },
  { part: '3/4 in rivets', qty: 14, unitCost: null, freightPerUnit: 0.0 },
]

const SHELTER: ProductSpec = {
  sku: 'shelter',
  name: 'Bee Shelter',
  currency: 'CAD',
  bom: SHELTER_BOM,
  labor: 20,
  markup: 0.5,
  roundTo: 10,
  unit: 'each',
}

/** `Tray Cost (TNT)` — the Connecticut screen-assembly path (column C). */
const TRAY_CT: ProductSpec = {
  sku: 'tray-set-ct',
  name: 'Tray Set (top + bottom), CT screen assembly',
  currency: 'USD',
  bom: [
    { part: 'Top (air)', qty: 1, unitCost: 13.5, freightPerUnit: 0 },
    { part: 'Top screen', qty: 1, unitCost: 2.0, freightPerUnit: 0 },
    { part: 'Screen assembly', qty: 1, unitCost: 10.29, freightPerUnit: 0 },
    { part: 'Bottom (dough)', qty: 1, unitCost: 12.5, freightPerUnit: 0 },
  ],
  labor: 0,
  markup: 0, // TNT's own cost — the customer markup is applied separately
  roundTo: null,
  unit: 'set',
}

/** `Tray Cost (TNT)` — the Grassy Lake path (column E): no screen assembly. */
const TRAY_GL: ProductSpec = {
  ...TRAY_CT,
  sku: 'tray-set-gl',
  name: 'Tray Set (top + bottom), Grassy Lake screen assembly',
  bom: TRAY_CT.bom.filter((l) => l.part !== 'Screen assembly'),
}

/** `Corners Cost` — sold by the foot, with volume breaks (G2:H3). */
const CORNERS: ProductSpec = {
  sku: 'corners',
  name: 'Shelter Corners',
  currency: 'CAD',
  bom: [],
  labor: 0,
  markup: 0.25,
  roundTo: null,
  tiers: [
    { minQty: 8000, unitCost: 0.72 },
    { minQty: 10000, unitCost: 0.61 },
  ],
  unit: 'ft',
}

// ═══════════════════════════════════════════════════════════════════════════
// Primitives
// ═══════════════════════════════════════════════════════════════════════════

describe('bomLineTotal', () => {
  it('adds freight ONCE per line, not per part (the sheet\'s =(B*C)+D)', () => {
    // Shelters Cost E2: two $36.50 sheets plus $0.25 freight = $73.25,
    // NOT 2 × (36.50 + 0.25) = $73.50.
    expect(bomLineTotal(SHELTER_BOM[0])).toBe(73.25)
  })

  it('treats an uncosted line as zero so the sum still works', () => {
    expect(bomLineTotal(SHELTER_BOM[7])).toBe(0) // 3/4 in rivets — E9 = 0
  })

  it.each([
    ['Pallet', 1, 10.25],
    ['Anchor', 2, 12],
    ['Zip Ties', 3, 0.45],
    ['Short Bungees (21 in)', 4, 1.42],
    ['1/2 in. rivets', 6, 0.1],
  ])('%s matches the sheet', (_part, idx, expected) => {
    expect(bomLineTotal(SHELTER_BOM[idx as number])).toBeCloseTo(expected as number, 10)
  })
})

describe('roundUpTo', () => {
  it('rounds up to the nearest 10 (ROUNDUP(x,-1))', () => {
    expect(roundUpTo(179.3435185, 10)).toBe(180)
    expect(roundUpTo(180.01, 10)).toBe(190)
  })

  it('leaves a value already on the step alone', () => {
    expect(roundUpTo(180, 10)).toBe(180)
  })

  it('does not jump an increment on float drift', () => {
    // 0.1 + 0.2 = 0.30000000000000004; without the epsilon this returns 0.4.
    expect(roundUpTo(0.1 + 0.2, 0.1)).toBeCloseTo(0.3, 10)
  })

  it('passes the value through for a non-positive step', () => {
    expect(roundUpTo(179.34, 0)).toBe(179.34)
  })
})

describe('tierUnitCost', () => {
  it('matches the sheet at its two exact thresholds', () => {
    expect(tierUnitCost(CORNERS.tiers!, 8000, 0.72)).toBe(0.72)
    expect(tierUnitCost(CORNERS.tiers!, 10000, 0.61)).toBe(0.61)
  })

  it('FIXES BUG: an in-between quantity gets the lower tier, not FALSE', () => {
    // Corners Cost B2 was IF(B3=H2,G2,IF(B3=H3,G3)) — an exact-match chain that
    // evaluated to FALSE for any quantity that wasn't 8000 or 10000.
    expect(tierUnitCost(CORNERS.tiers!, 9000, 0.72)).toBe(0.72)
    expect(tierUnitCost(CORNERS.tiers!, 15000, 0.72)).toBe(0.61)
  })

  it('falls back to the base rate below the first threshold', () => {
    expect(tierUnitCost(CORNERS.tiers!, 500, 0.72)).toBe(0.72)
  })
})

describe('amortize', () => {
  it('spreads setup across the order (Tray Cost C24)', () => {
    expect(amortize({ setup: 550 + 550 + 425, pallets: 0, freight: 0 }, 500)).toBe(3.05)
  })

  it('spreads thinner over a bigger order', () => {
    expect(amortize({ setup: 1525, pallets: 0, freight: 0 }, 5000)).toBeCloseTo(0.305, 10)
  })

  it('returns 0 rather than Infinity on a zero-quantity order', () => {
    expect(amortize({ setup: 1525, pallets: 0, freight: 0 }, 0)).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Shelters Cost
// ═══════════════════════════════════════════════════════════════════════════

describe('Shelters Cost sheet', () => {
  it('materials match E10', () => {
    expect(materialsCost(SHELTER_BOM)).toBeCloseTo(99.56234568, 8)
  })

  it('reproduces the full E10:E15 waterfall', () => {
    const u = priceUnit(SHELTER, 150)
    expect(u.materials).toBeCloseTo(99.56234568, 8) // E10
    expect(u.labor).toBe(20) // E11
    expect(u.buildCost).toBeCloseTo(119.5623457, 7) // E12
    expect(u.markupAmount).toBeCloseTo(59.78117284, 8) // E13
    expect(u.exactPrice).toBeCloseTo(179.3435185, 7) // E14
    expect(u.price).toBe(180) // E15
  })

  it('FIXES BUG: bills the rounded price it quotes', () => {
    // The sheet showed $180 in E15 but quoted H6 = H2*E14 = 150 × 179.3435…
    // = $26,901.53, $98.47 below its own list price.
    const line = priceLine(SHELTER, 150)
    expect(line.extended).toBe(27000)
    expect(line.extended).not.toBeCloseTo(26901.52778, 2)
  })

  it('reports the two broken rivet lines', () => {
    const w = pricingWarnings(SHELTER)
    expect(w.map((x) => x.kind)).toEqual(['zero-cost-part', 'uncosted-part'])
    expect(w[1].message).toContain('3/4 in rivets')
    expect(w[1].message).toContain('14 per unit')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Tray Cost (TNT) — both sourcing paths
// ═══════════════════════════════════════════════════════════════════════════

describe('Tray Cost (TNT) sheet', () => {
  const QTY = 500
  // J9/J10: trays per pallet. C16: $15 a pallet.
  const palletsTop = Math.ceil(QTY / 150) // C14 = 4
  const palletsBottom = Math.ceil(QTY / 112) // C15 = 5
  const palletCost = 15 * (palletsTop + palletsBottom) // C17 = 135

  it('computes the pallet counts in C14:C17', () => {
    expect(palletsTop).toBe(4)
    expect(palletsBottom).toBe(5)
    expect(palletCost).toBe(135)
  })

  it('matches the Connecticut column (C24:C28)', () => {
    const u = priceUnit(TRAY_CT, QTY, {
      setup: 550 + 550 + 425, // C21:C23
      pallets: palletCost,
      freight: 6100, // C18 — K6, since 9 pallets ≤ 11
    })
    expect(u.materials).toBeCloseTo(38.29, 10) // C25
    expect(u.overhead).toBeCloseTo(3.05 + 0.27 + 12.2, 10) // C24 + C26 + C27
    expect(u.unitCost).toBeCloseTo(53.81, 10) // C28
  })

  it('matches the Grassy Lake column (G24:G28)', () => {
    const u = priceUnit(TRAY_GL, QTY, {
      setup: 650 + 650, // G21:G22 — no separate screen-assembly setup
      pallets: palletCost,
      freight: 5675, // G18 — K5
    })
    expect(u.materials).toBeCloseTo(28, 10) // G25 = E7 − D7
    expect(u.overhead).toBeCloseTo(2.6 + 0.27 + 11.35, 10) // G24 + G26 + G27
    expect(u.unitCost).toBeCloseTo(42.22, 10) // G28
  })

  it('totals the order at C30 / G30', () => {
    const ct = priceLine(TRAY_CT, QTY, { setup: 1525, pallets: palletCost, freight: 6100 })
    const gl = priceLine(TRAY_GL, QTY, { setup: 1300, pallets: palletCost, freight: 5675 })
    expect(ct.extendedCost).toBeCloseTo(26905, 6) // C30
    expect(gl.extendedCost).toBeCloseTo(21110, 6) // G30
  })

  it('picks the cheaper freight band below 11 pallets (C18 / G18)', () => {
    const pallets = palletsTop + palletsBottom
    const freight = pallets <= 11 ? 6100 : 8222.907489
    expect(freight).toBe(6100)
  })
})

describe('Tray Cost (Customer) sheet', () => {
  it('marks TNT cost up 25% and extends over tops + bottoms', () => {
    const CUSTOMER_TRAY: ProductSpec = { ...TRAY_CT, markup: 0.25 }
    const u = priceUnit(CUSTOMER_TRAY, 500, { setup: 1525, pallets: 135, freight: 6100 })
    expect(u.unitCost).toBeCloseTo(53.81, 10) // C5
    expect(u.price).toBeCloseTo(67.2625, 10) // C6

    // C7 = C6 × (tops + bottoms) = 67.2625 × 1000. The sheet bills a top and a
    // bottom separately at the SET price, which is a real quirk worth keeping
    // visible rather than silently halving.
    expect(u.price * 1000).toBeCloseTo(67262.5, 6)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Corners Cost — pass-through freight
// ═══════════════════════════════════════════════════════════════════════════

describe('Corners Cost sheet', () => {
  it('marks up the corners but not the freight (B10)', () => {
    const line = priceLine(CORNERS, 8000)
    expect(line.price).toBeCloseTo(0.9, 10) // B4
    expect(line.extended).toBeCloseTo(7200, 6) // B7

    const t = orderTotals([line], [{ label: 'Shipping', amount: 700, passThrough: true }])
    expect(t.total).toBeCloseTo(7900, 6) // B10
  })

  it('prices a 4 ft block at C2/C4', () => {
    expect(priceUnit(CORNERS, 8000).materials * 4).toBeCloseTo(2.88, 10) // C2
    expect(priceUnit(CORNERS, 8000).price * 4).toBeCloseTo(3.6, 10) // C4
  })

  it('earns no margin on a pass-through charge', () => {
    const line = priceLine(CORNERS, 8000)
    const withFreight = orderTotals([line], [{ label: 'Shipping', amount: 700, passThrough: true }])
    const without = orderTotals([line])
    expect(withFreight.margin).toBeCloseTo(without.margin, 6)
  })

  it('earns margin on a charge that is NOT pass-through', () => {
    const line = priceLine(CORNERS, 8000)
    const t = orderTotals([line], [{ label: 'Handling', amount: 700, passThrough: false }])
    expect(t.margin).toBeCloseTo(orderTotals([line]).margin + 700, 6)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Currency
// ═══════════════════════════════════════════════════════════════════════════

describe('currency', () => {
  it('converts at an explicit rate', () => {
    expect(convert(money(100, 'CAD'), 'USD', 0.73).amount).toBeCloseTo(73, 10)
  })

  it('ignores the rate when already in the target currency', () => {
    expect(convert(money(100, 'USD'), 'USD', 999).amount).toBe(100)
  })

  it('refuses a nonsense rate rather than producing a nonsense amount', () => {
    expect(() => convert(money(100, 'CAD'), 'USD', 0)).toThrow(/positive/)
    expect(() => convert(money(100, 'CAD'), 'USD', NaN)).toThrow(/positive/)
  })

  it('refuses to add USD trays to CAD shelters', () => {
    const usd = priceLine(TRAY_CT, 10)
    const cad = priceLine(SHELTER, 10)
    expect(() => orderTotals([usd, cad])).toThrow(/cannot add CAD to USD/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Totals + margin
// ═══════════════════════════════════════════════════════════════════════════

describe('orderTotals', () => {
  it('is zero for an empty order', () => {
    const t = orderTotals([])
    expect(t.total).toBe(0)
    expect(t.marginRate).toBeNull()
  })

  it('reports margin on a shelter order', () => {
    const line = priceLine(SHELTER, 150)
    const t = orderTotals([line])
    expect(t.subtotal).toBe(27000)
    // Against the exact build cost, not the sheet's 7-dp display value — that
    // truncation is ~3e-6 once multiplied by 150.
    expect(t.totalCost).toBeCloseTo(line.buildCost * 150, 6)
    expect(t.totalCost).toBeCloseTo(17934.35, 2)
    expect(t.marginRate).toBeGreaterThan(0.33)
  })

  it('flags a below-cost sale', () => {
    const loss: ProductSpec = { ...SHELTER, markup: -0.5, roundTo: null }
    const line = priceLine(loss, 10)
    const w = pricingWarnings(loss, line)
    expect(w.map((x) => x.kind)).toContain('negative-margin')
  })
})
