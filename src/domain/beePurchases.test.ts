import { describe, it, expect } from 'vitest'
import {
  activeSeason,
  bySeason,
  parseGallons,
  priceChange,
  pricePerGallonSeries,
  seasonOf,
  gallonsFromUnitPrice,
  seasonRange,
  unitPriceOf,
  totalsFor,
  type BeePurchase,
} from './beePurchases'

const line = (over: Partial<BeePurchase> = {}): BeePurchase => ({
  id: 'p1',
  source: 'quickbooks',
  qboId: '101',
  date: '2026-02-10',
  vendor: 'Prairie Bee Co.',
  description: 'Leafcutter bees 250 gal',
  gallons: 250,
  amount: 10000,
  currency: 'CAD',
  season: 2026,
  notes: '',
  excludedAt: null,
  ...over,
})

describe('parseGallons', () => {
  it('reads the shapes a person actually types', () => {
    expect(parseGallons('Leafcutter bees 250 gal')).toBe(250)
    expect(parseGallons('500 gallons of bees')).toBe(500)
    expect(parseGallons('300gal @ $41.00')).toBe(300)
    expect(parseGallons('1,250 US gal')).toBe(1250)
    expect(parseGallons('62.5 Gallon lot')).toBe(62.5)
    expect(parseGallons('Bees - 40 GALS')).toBe(40)
  })

  it('SUMS a description that names a volume twice', () => {
    // A split or corrected line: "200 gal + 150 gal" is one line for 350.
    expect(parseGallons('200 gal early + 150 gal late')).toBe(350)
  })

  it('requires the unit, so prices and lot numbers are not mistaken for volume', () => {
    // The single most dangerous failure: taking the only number in the string.
    expect(parseGallons('Bee larvae invoice 4471')).toBeNull()
    expect(parseGallons('Deposit $12,000')).toBeNull()
    expect(parseGallons('Lot 2026-14')).toBeNull()
  })

  it('returns null rather than zero when nothing is stated', () => {
    // Zero would keep the dollars and drop the volume, inflating $/gal silently.
    expect(parseGallons('')).toBeNull()
    expect(parseGallons('Bees')).toBeNull()
    expect(parseGallons(undefined as unknown as string)).toBeNull()
  })

  it('ignores a zero volume', () => {
    expect(parseGallons('0 gal')).toBeNull()
  })
})

describe('seasonOf', () => {
  it('keeps a December-to-May run together', () => {
    // The whole point: these are one buying run, not two calendar years.
    expect(seasonOf('2025-12-15')).toBe(2026)
    expect(seasonOf('2026-01-20')).toBe(2026)
    expect(seasonOf('2026-05-31')).toBe(2026)
  })

  it('puts an off-cycle summer purchase in the season ahead', () => {
    expect(seasonOf('2026-06-01')).toBe(2027)
    expect(seasonOf('2026-08-14')).toBe(2027)
  })

  it('is stable across the boundary it exists to handle', () => {
    expect(seasonOf('2025-11-30')).toBe(2026)
    expect(seasonOf('2025-05-31')).toBe(2025)
  })

  it('survives a malformed date', () => {
    expect(Number.isNaN(seasonOf('not-a-date'))).toBe(true)
  })
})

describe('seasonRange', () => {
  it('spans June to May', () => {
    expect(seasonRange(2026)).toEqual({ from: '2025-06-01', to: '2026-05-31' })
  })

  it('round-trips with seasonOf at both ends', () => {
    const { from, to } = seasonRange(2026)
    expect(seasonOf(from)).toBe(2026)
    expect(seasonOf(to)).toBe(2026)
  })
})

describe('totalsFor', () => {
  it('computes cost per gallon', () => {
    const t = totalsFor([line({ gallons: 200, amount: 8000 }), line({ id: 'p2', gallons: 300, amount: 13000 })])
    expect(t.gallons).toBe(500)
    expect(t.amount).toBe(21000)
    expect(t.costPerGallon).toBe(42)
  })

  it('SURFACES lines with no readable volume instead of counting them as zero', () => {
    // 10000 over 200 gal reads as $50/gal, and the extra 5000 is called out
    // rather than folded in as though it bought nothing.
    const t = totalsFor([line({ gallons: 200, amount: 10000 }), line({ id: 'p2', gallons: null, amount: 5000 })])
    expect(t.unknownGallonLines).toBe(1)
    expect(t.unknownGallonAmount).toBe(5000)
    expect(t.amount).toBe(15000)
    expect(t.gallons).toBe(200)
    expect(t.costPerGallon).toBe(75)
  })

  it('gives no price at all when nothing measurable was bought', () => {
    const t = totalsFor([line({ gallons: null, amount: 5000 })])
    expect(t.costPerGallon).toBeNull()
  })

  it('handles an empty set', () => {
    expect(totalsFor([])).toMatchObject({ amount: 0, gallons: 0, costPerGallon: null, lines: 0 })
  })
})

describe('bySeason', () => {
  it('groups a straddling run into one season, newest first', () => {
    const rows = [
      line({ id: 'a', date: '2025-12-15', season: 2026, gallons: 100, amount: 4000 }),
      line({ id: 'b', date: '2026-03-02', season: 2026, gallons: 150, amount: 6300 }),
      line({ id: 'c', date: '2025-02-11', season: 2025, gallons: 200, amount: 7600 }),
    ]
    const out = bySeason(rows)
    expect(out.map((s) => s.season)).toEqual([2026, 2025])
    expect(out[0].gallons).toBe(250)
    expect(out[0].purchases.map((p) => p.id)).toEqual(['a', 'b'])
  })

  it('falls back to the date when a row carries no usable season', () => {
    const out = bySeason([line({ date: '2025-12-01', season: NaN as unknown as number })])
    expect(out[0].season).toBe(2026)
  })
})

describe('pricePerGallonSeries', () => {
  it('runs oldest first, for a chart', () => {
    const rows = [
      line({ id: 'a', season: 2026, gallons: 100, amount: 4200 }),
      line({ id: 'b', season: 2024, gallons: 100, amount: 3600 }),
      line({ id: 'c', season: 2025, gallons: 100, amount: 3900 }),
    ]
    expect(pricePerGallonSeries(rows).map((p) => [p.season, p.costPerGallon])).toEqual([
      [2024, 36],
      [2025, 39],
      [2026, 42],
    ])
  })

  it('DROPS a season with no measurable volume rather than plotting zero', () => {
    // A zero on a price chart reads as "bees were free that year".
    const rows = [line({ id: 'a', season: 2025, gallons: null, amount: 5000 }), line({ id: 'b', season: 2026, gallons: 100, amount: 4200 })]
    expect(pricePerGallonSeries(rows).map((p) => p.season)).toEqual([2026])
  })
})

describe('priceChange', () => {
  it('compares the last two seasons', () => {
    const rows = [
      line({ id: 'a', season: 2025, gallons: 100, amount: 4000 }),
      line({ id: 'b', season: 2026, gallons: 100, amount: 4600 }),
    ]
    expect(priceChange(rows)).toEqual({ season: 2026, change: 0.15 })
  })

  it('says nothing when there is nothing to compare', () => {
    expect(priceChange([line({ season: 2026 })])).toBeNull()
    expect(priceChange([])).toBeNull()
  })
})

describe('the June boundary, which has caused real confusion', () => {
  it('names a season whose buying has NOT started, for half the year', () => {
    // This is not a bug in seasonOf — it is the correct answer, and the trap.
    // In August 2026 the "current" season is 2027, whose December has not
    // arrived. A sync that reads only the current season finds an empty window
    // and reports "0 lines", which looks like a broken integration.
    expect(seasonOf('2026-08-17')).toBe(2027)
    const { from, to } = seasonRange(2027)
    expect(from).toBe('2026-06-01')
    expect(to).toBe('2027-05-31')
  })

  it('the season with buying in it is the PREVIOUS one, June to November', () => {
    // What the "Sync now" default has to pick, and what the weekly run has to
    // cover in addition to the current one.
    expect(activeSeason('2026-08-17')).toBe(2026) // August → last winter's run
    expect(activeSeason('2026-11-30')).toBe(2026)
    expect(activeSeason('2026-12-01')).toBe(2027) // buying starts
    expect(activeSeason('2027-03-15')).toBe(2027)
    expect(activeSeason('2027-05-31')).toBe(2027)
  })

  it('a December purchase lands in the season that ends the following May', () => {
    const { from, to } = seasonRange(seasonOf('2025-12-18'))
    expect(from <= '2025-12-18' && '2025-12-18' <= to).toBe(true)
  })
})

describe('editing the unit price', () => {
  it('back-solves the gallons, leaving the money alone', () => {
    // $13,200 at $44/gal must be 300 gal. The amount reconciles against
    // QuickBooks and is never what a typed unit price is allowed to change.
    expect(gallonsFromUnitPrice(13200, 44)).toBe(300)
  })

  it('round-trips: type a price, read the same price back', () => {
    const amount = 5000
    const typed = 41.5
    const gallons = gallonsFromUnitPrice(amount, typed)
    expect(gallons).not.toBeNull()
    expect(unitPriceOf({ amount, gallons })).toBeCloseTo(typed, 10)
  })

  it('refuses a price that would invent a nonsense volume', () => {
    // Zero or negative gives an infinite or negative volume. Leaving the line
    // marked unknown is far better than writing one of those.
    expect(gallonsFromUnitPrice(5000, 0)).toBeNull()
    expect(gallonsFromUnitPrice(5000, -12)).toBeNull()
    expect(gallonsFromUnitPrice(0, 44)).toBeNull()
    expect(gallonsFromUnitPrice(5000, Number.NaN)).toBeNull()
    expect(gallonsFromUnitPrice(Number.POSITIVE_INFINITY, 44)).toBeNull()
  })

  it('unitPriceOf says nothing when the volume is unknown or zero', () => {
    expect(unitPriceOf({ amount: 5000, gallons: null })).toBeNull()
    expect(unitPriceOf({ amount: 5000, gallons: 0 })).toBeNull()
    expect(unitPriceOf({ amount: 13200, gallons: 300 })).toBe(44)
  })

  it('a typed price makes an unknown line count toward the season', () => {
    // The point of the feature: a deposit line with no stated volume was
    // inflating $/gal for everything else. Naming its price fixes the average.
    const before = totalsFor([
      line({ id: 'a', gallons: 200, amount: 10000 }),
      line({ id: 'b', gallons: null, amount: 5000 }),
    ])
    expect(before.costPerGallon).toBe(75)
    expect(before.unknownGallonLines).toBe(1)

    const after = totalsFor([
      line({ id: 'a', gallons: 200, amount: 10000 }),
      line({ id: 'b', gallons: gallonsFromUnitPrice(5000, 50), amount: 5000 }),
    ])
    expect(after.gallons).toBe(300)
    expect(after.costPerGallon).toBe(50)
    expect(after.unknownGallonLines).toBe(0)
  })
})
