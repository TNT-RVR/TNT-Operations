import { describe, it, expect } from 'vitest'
import { parseGallons } from '../functions/qbo-purchases.mjs'

/**
 * The gallon rule exists TWICE and must not drift.
 *
 * A Netlify function is plain .mjs and cannot import the TypeScript domain, so
 * `parseGallons` is implemented in both `src/domain/beePurchases.ts` and
 * `netlify/functions/qbo-purchases.mjs`. The function's copy decides what gets
 * STORED; the domain's copy decides what gets DISPLAYED and totalled. If they
 * disagree, the sync writes one number and the screen computes another, and
 * nothing anywhere reports a conflict.
 *
 * These are the same cases as beePurchases.test.ts, run against the other copy.
 */
describe('parseGallons (function copy)', () => {
  it('reads the shapes a person actually types', () => {
    expect(parseGallons('Leafcutter bees 250 gal')).toBe(250)
    expect(parseGallons('500 gallons of bees')).toBe(500)
    expect(parseGallons('300gal @ $41.00')).toBe(300)
    expect(parseGallons('1,250 US gal')).toBe(1250)
    expect(parseGallons('62.5 Gallon lot')).toBe(62.5)
    expect(parseGallons('Bees - 40 GALS')).toBe(40)
  })

  it('sums a description that names a volume twice', () => {
    expect(parseGallons('200 gal early + 150 gal late')).toBe(350)
  })

  it('requires the unit', () => {
    expect(parseGallons('Bee larvae invoice 4471')).toBeNull()
    expect(parseGallons('Deposit $12,000')).toBeNull()
    expect(parseGallons('Lot 2026-14')).toBeNull()
  })

  it('returns null, never zero, when nothing is stated', () => {
    expect(parseGallons('')).toBeNull()
    expect(parseGallons('Bees')).toBeNull()
    expect(parseGallons(undefined)).toBeNull()
    expect(parseGallons('0 gal')).toBeNull()
  })
})
