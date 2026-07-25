import { describe, expect, it } from 'vitest'
import {
  defaultCostPrefs,
  fieldCost,
  mathTrays,
  resolvePrefsForYear,
  totalGals,
  totalTrays,
  trayDistribution,
  type CostPrefs,
  type FieldCostInput,
} from './cost'

// ═══════════════════════════════════════════════════════════════════════════
// Reference case — every expected value hand-computed from the §8.2 formulas
// ═══════════════════════════════════════════════════════════════════════════

/** Prefs chosen so every intermediate is exactly computable by hand. */
function refPrefs(): CostPrefs {
  return {
    ...defaultCostPrefs(),
    costPerShelter: 500,
    shelterLifeYr: 5,
    costPerTray: 40,
    trayLifeYr: 5,
    costPerBlock: 20,
    blockLifeYr: 4,
    blocksPerShelter: 2,
    costPerFlag: 6,
    flagLifeYr: 3,
    costPerGalBee: 30,
    chemCostPerAcre: 12,
    fuelLPerKm: 0.35,
    fuelCostPerL: 1.5,
    payPerHour: 20,
    driveSpeedKmh: 15,
    crewsSetup: 2,
    empPerCrewSetup: 2,
    timeSetupMin: 12,
    loadSetupMinPerShelter: 6,
    crewsBees: 1,
    empPerCrewBees: 3,
    timeBeesMin: 6,
    loadBeesMinPerTray: 2,
    crewsRemoval: 1,
    empPerCrewRemoval: 2,
    timeRemovalMin: 9,
    loadRemovalMinPerShelter: 3,
    contractPerAcre: { ACME: 150 },
  }
}

/**
 * Field: 10 shelters, 100 ac at 3 gal/ac → 300 gal; 2 gal/tray → 150 trays.
 * Route 6 km in-field; home→parking 20 km / 24 min one way → rt_h = 0.8 h.
 */
function refInput(): FieldCostInput {
  return {
    shelters: 10,
    trays: 150,
    gallons: 300,
    acres: 100,
    routeKm: 6,
    rtKm: 20,
    rtMin: 24,
    company: 'ACME',
  }
}

describe('fieldCost — reference case (hand-computed)', () => {
  const r = fieldCost(refInput(), refPrefs())

  it('amortized items', () => {
    expect(r.items.shelter).toBeCloseTo(1000, 2) // 10 × 500 ÷ 5
    expect(r.items.bee).toBeCloseTo(9000, 2) // 300 gal × $30 (1-yr, no life)
    expect(r.items.tray).toBeCloseTo(1200, 2) // 150 × 40 ÷ 5
    expect(r.items.block).toBeCloseTo(100, 2) // 10 × 2 × 20 ÷ 4
    expect(r.items.flag).toBeCloseTo(20, 2) // 10 × 6 ÷ 3
    expect(r.items.total).toBeCloseTo(11320, 2)
    expect(r.chemical).toBeCloseTo(1200, 2) // 100 ac × $12
  })

  it('setup task (2 crews × 2 = 4 people)', () => {
    // work_h = 10×12/60 = 2 · load_h = 10×6/60 = 1 · drive_h = 6/2/15 = 0.2
    // dur_h = (2+1)/4 + 0.2 = 0.95
    // drive_labour = 4×0.2×20 = 16 → field_labour = 2×20 + 16 = 56
    // load_labour = 1×20 = 20 · travel = 4×0.8×20 = 64 → task_labour = 140
    // fuel_km = 20×2×2 + 6 = 86 → fuel = 86×0.35×1.5 = 45.15
    expect(r.setup.workH).toBeCloseTo(2, 6)
    expect(r.setup.loadH).toBeCloseTo(1, 6)
    expect(r.setup.driveH).toBeCloseTo(0.2, 6)
    expect(r.setup.durH).toBeCloseTo(0.95, 6)
    expect(r.setup.fieldLabour).toBeCloseTo(56, 2)
    expect(r.setup.loadLabour).toBeCloseTo(20, 2)
    expect(r.setup.travel).toBeCloseTo(64, 2)
    expect(r.setup.fuelKm).toBeCloseTo(86, 6)
    expect(r.setup.fuel).toBeCloseTo(45.15, 2)
    expect(r.setup.taskLabour).toBeCloseTo(140, 2)
  })

  it('bees task (1 crew × 3 = 3 people, units = trays)', () => {
    // work_h = 10×6/60 = 1 · load_h = 150×2/60 = 5 · drive_h = 6/1/15 = 0.4
    // dur_h = (1+5)/3 + 0.4 = 2.4
    // drive_labour = 3×0.4×20 = 24 → field_labour = 20 + 24 = 44
    // load_labour = 5×20 = 100 · travel = 3×0.8×20 = 48 → task_labour = 192
    // fuel_km = 20×2×1 + 6 = 46 → fuel = 46×0.35×1.5 = 24.15
    expect(r.bees.workH).toBeCloseTo(1, 6)
    expect(r.bees.loadH).toBeCloseTo(5, 6)
    expect(r.bees.driveH).toBeCloseTo(0.4, 6)
    expect(r.bees.durH).toBeCloseTo(2.4, 6)
    expect(r.bees.fieldLabour).toBeCloseTo(44, 2)
    expect(r.bees.loadLabour).toBeCloseTo(100, 2)
    expect(r.bees.travel).toBeCloseTo(48, 2)
    expect(r.bees.fuelKm).toBeCloseTo(46, 6)
    expect(r.bees.fuel).toBeCloseTo(24.15, 2)
    expect(r.bees.taskLabour).toBeCloseTo(192, 2)
  })

  it('removal task (1 crew × 2 = 2 people)', () => {
    // work_h = 10×9/60 = 1.5 · load_h = 10×3/60 = 0.5 · drive_h = 0.4
    // dur_h = (1.5+0.5)/2 + 0.4 = 1.4
    // drive_labour = 2×0.4×20 = 16 → field_labour = 30 + 16 = 46
    // load_labour = 10 · travel = 2×0.8×20 = 32 → task_labour = 88
    // fuel_km = 46 → fuel = 24.15
    expect(r.removal.durH).toBeCloseTo(1.4, 6)
    expect(r.removal.fieldLabour).toBeCloseTo(46, 2)
    expect(r.removal.loadLabour).toBeCloseTo(10, 2)
    expect(r.removal.travel).toBeCloseTo(32, 2)
    expect(r.removal.fuel).toBeCloseTo(24.15, 2)
    expect(r.removal.taskLabour).toBeCloseTo(88, 2)
  })

  it('totals + revenue', () => {
    expect(r.labourTotal).toBeCloseTo(420, 2) // 140 + 192 + 88
    expect(r.fuelTotal).toBeCloseTo(93.45, 2) // 45.15 + 24.15 + 24.15
    expect(r.travelTotal).toBeCloseTo(144, 2) // 64 + 48 + 32
    expect(r.total).toBeCloseTo(13033.45, 2) // 11320 + 1200 + 420 + 93.45
    expect(r.costPerAcre).toBeCloseTo(130.3345, 4)
    expect(r.contractRate).toBe(150)
    expect(r.contractValue).toBeCloseTo(15000, 2) // 150 × 100 ac
    expect(r.netProfit).toBeCloseTo(1966.55, 2)
    expect(r.profitPerAcre).toBeCloseTo(19.6655, 4)
  })
})

describe('fieldCost — crew-count behaviour (§8.2 key reasoning)', () => {
  const one = fieldCost(refInput(), { ...refPrefs(), crewsSetup: 1 })
  const two = fieldCost(refInput(), { ...refPrefs(), crewsSetup: 2 })

  it('work cost (field + loading labour) is crew-count invariant', () => {
    expect(two.setup.fieldLabour).toBeCloseTo(one.setup.fieldLabour, 6)
    expect(two.setup.loadLabour).toBeCloseTo(one.setup.loadLabour, 6)
  })

  it('wall-clock duration shrinks with a second crew', () => {
    expect(two.setup.durH).toBeLessThan(one.setup.durH)
  })

  it('travel labour and round-trip fuel scale with crews', () => {
    expect(two.setup.travel).toBeCloseTo(2 * one.setup.travel, 6)
    // fuel_km: rt doubles per crew, route km counted once (shared)
    const rtKm = refInput().rtKm
    expect(two.setup.fuelKm - one.setup.fuelKm).toBeCloseTo(rtKm * 2, 6)
  })
})

describe('fieldCost — guards', () => {
  it('acres 0 → per-acre figures null, rest still computed', () => {
    const r = fieldCost({ ...refInput(), acres: 0 }, refPrefs())
    expect(r.costPerAcre).toBeNull()
    expect(r.profitPerAcre).toBeNull()
    expect(r.chemical).toBe(0)
    expect(r.contractValue).toBe(0)
    expect(r.total).toBeGreaterThan(0) // items/labour/fuel unaffected
  })

  it('0 crews → no drive time, no people cost, no NaN', () => {
    const r = fieldCost(refInput(), { ...refPrefs(), crewsSetup: 0 })
    expect(r.setup.driveH).toBe(0)
    expect(r.setup.durH).toBe(0)
    expect(r.setup.travel).toBe(0)
    expect(r.setup.fuelKm).toBeCloseTo(refInput().routeKm, 6) // route still burned
    expect(Number.isFinite(r.total)).toBe(true)
  })

  it('life ≤ 0 counts as 1 year (full cost)', () => {
    const r = fieldCost(refInput(), { ...refPrefs(), shelterLifeYr: 0 })
    expect(r.items.shelter).toBeCloseTo(10 * 500, 2)
  })

  it('drive speed 0 falls back to 15 km/h', () => {
    const r = fieldCost(refInput(), { ...refPrefs(), driveSpeedKmh: 0, crewsSetup: 1 })
    expect(r.setup.driveH).toBeCloseTo(6 / 15, 6)
  })

  it('unknown company → contract rate 0, profit fully negative', () => {
    const r = fieldCost({ ...refInput(), company: 'NOBODY' }, refPrefs())
    expect(r.contractRate).toBe(0)
    expect(r.netProfit).toBeCloseTo(-r.total, 6)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Bee / tray derivation (§7.2)
// ═══════════════════════════════════════════════════════════════════════════

describe('bee/tray derivation', () => {
  it('totalGals / mathTrays / totalTrays chain', () => {
    expect(totalGals(3, 100)).toBe(300)
    expect(mathTrays(300, 2)).toBe(150)
    expect(mathTrays(301, 2)).toBe(151) // ceil
    expect(mathTrays(300, 0)).toBe(0) // no tray size → 0
    expect(totalTrays(150, 10)).toBe(150)
  })

  it('totalTrays never drops below the shelter count', () => {
    expect(totalTrays(3, 10)).toBe(10)
    expect(totalTrays(0, 7)).toBe(7)
  })

  it('trayDistribution spreads the remainder evenly and sums exactly', () => {
    // 17 trays / 5 shelters: base 3, extras 2 → [3,3,4,3,4]
    expect(trayDistribution(17, 5)).toEqual([3, 3, 4, 3, 4])
    // exact division → flat
    expect(trayDistribution(20, 5)).toEqual([4, 4, 4, 4, 4])
    // sums always match the total (contracted gallons must balance)
    for (const [t, n] of [[23, 7], [10, 10], [11, 10], [99, 8]] as const) {
      const per = trayDistribution(t, n)
      expect(per).toHaveLength(n)
      expect(per.reduce((a, b) => a + b, 0)).toBe(t)
      // even spread: counts differ by at most 1
      expect(Math.max(...per) - Math.min(...per)).toBeLessThanOrEqual(1)
    }
  })

  it('trayDistribution with no shelters → empty', () => {
    expect(trayDistribution(10, 0)).toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Per-year carry-forward (whole-form, mirrors _resolve_year_data)
// ═══════════════════════════════════════════════════════════════════════════

describe('resolvePrefsForYear', () => {
  const byYear = {
    '2024': { payPerHour: 25, contractPerAcre: { ACME: 140 } },
    '2026': { payPerHour: 30, contractPerAcre: { ACME: 160 } },
  }

  it('exact year wins', () => {
    expect(resolvePrefsForYear(byYear, 2026).payPerHour).toBe(30)
    expect(resolvePrefsForYear(byYear, '2024').contractPerAcre.ACME).toBe(140)
  })

  it('missing year carries the most recent EARLIER form forward — wholesale', () => {
    const p = resolvePrefsForYear(byYear, 2025)
    expect(p.payPerHour).toBe(25) // from 2024, NOT 2026
    expect(p.contractPerAcre.ACME).toBe(140)
  })

  it('year before any stored form → most recent stored year overall (Python tiebreak)', () => {
    expect(resolvePrefsForYear(byYear, 2023).payPerHour).toBe(30) // 2026 form
  })

  it('unstored keys fill from spec defaults', () => {
    const p = resolvePrefsForYear(byYear, 2025)
    expect(p.fuelLPerKm).toBe(0.35)
    expect(p.driveSpeedKmh).toBe(15)
    expect(p.timeSetupMin).toBe(10)
    expect(p.loadBeesMinPerTray).toBe(1.06)
  })

  it('nothing stored → pure defaults', () => {
    expect(resolvePrefsForYear({}, 2026)).toEqual(defaultCostPrefs())
  })
})
