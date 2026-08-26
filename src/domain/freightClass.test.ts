import { describe, expect, it } from 'vitest'
import { classForDensity, classNote, cubicFeet, freightClassFor } from './freightClass'

describe('cubicFeet', () => {
  it('measures a standard pallet load', () => {
    // 48 × 40 × 82 in — the Estes bill of lading's handling unit.
    expect(cubicFeet(48, 40, 82)).toBeCloseTo(91.11, 2)
  })
})

describe('the real shipments', () => {
  // Every case here is taken from TNT's own paperwork, so the maths can be
  // checked against a document rather than against itself.

  it('matches the Estes bill of lading: 4,725 lb over 11 pallets', () => {
    const r = freightClassFor({ totalWeightLbs: 4725, lengthIn: 48, widthIn: 40, heightIn: 82, units: 11 })
    expect(r.cubicFeet).toBeCloseTo(1002.3, 0) // the BOL prints "Cube 1002.3 FT3"
    expect(r.density).toBeCloseTo(4.71, 2) // and "Density 4.7 PCF"
    expect(r.freightClass).toBe(200)
  })

  it('reads the Utah quote lines the same way', () => {
    const tops = freightClassFor({ totalWeightLbs: 272, lengthIn: 48, widthIn: 40, heightIn: 50, units: 1 })
    expect(tops.density).toBeCloseTo(4.9, 1)
    expect(tops.freightClass).toBe(200)

    const bottoms = freightClassFor({ totalWeightLbs: 288, lengthIn: 48, widthIn: 40, heightIn: 60, units: 1 })
    expect(bottoms.density).toBeCloseTo(4.32, 2)
    expect(bottoms.freightClass).toBe(200)
  })
})

describe('classForDensity', () => {
  it('walks the scale', () => {
    expect(classForDensity(60)).toBe(50)
    expect(classForDensity(20)).toBe(70)
    expect(classForDensity(9.5)).toBe(100)
    expect(classForDensity(4.5)).toBe(200)
    expect(classForDensity(2.5)).toBe(300)
    expect(classForDensity(0.5)).toBe(500)
  })

  // The trays sit at 4.9, so which side of 5.0 the boundary falls on is worth a
  // whole class of freight cost.
  it('treats a bracket edge as belonging to the denser class', () => {
    expect(classForDensity(5)).toBe(175)
    expect(classForDensity(4.999)).toBe(200)
    expect(classForDensity(50)).toBe(50)
  })

  it('gives the most expensive class to nonsense rather than a cheap guess', () => {
    expect(classForDensity(0)).toBe(500)
    expect(classForDensity(Number.NaN)).toBe(500)
  })
})

describe('freightClassFor — incomplete lines', () => {
  const base = { totalWeightLbs: 500, lengthIn: 48, widthIn: 40, heightIn: 60, units: 2 }

  // A class computed from a missing dimension would be 500 — the priciest there
  // is — printed as though it were a fact.
  it('says what is missing instead of computing from a zero', () => {
    expect(freightClassFor({ ...base, heightIn: 0 }).problem).toMatch(/Dimensions are missing/)
    expect(freightClassFor({ ...base, totalWeightLbs: 0 }).problem).toMatch(/Weight is missing/)
    expect(freightClassFor({ ...base, units: 0 }).problem).toMatch(/No handling units/)
  })

  it('reports no class at all when it cannot say', () => {
    expect(freightClassFor({ ...base, heightIn: 0 }).freightClass).toBe(0)
  })
})

describe('classNote', () => {
  const r = freightClassFor({ totalWeightLbs: 4725, lengthIn: 48, widthIn: 40, heightIn: 82, units: 11 })

  it('shows the arithmetic and what it means', () => {
    const text = classNote(r).join(' ')
    // 1002.2, not the 1002.3 the Estes BOL prints: 48×40×82 is 91.111 ft³ and
    // Estes rounds each pallet before multiplying by 11. Ours is the exact
    // figure; the 0.1 never changes a class and is not worth reproducing a
    // carrier's rounding to match.
    expect(text).toMatch(/1002\.2 cubic feet/)
    expect(text).toMatch(/4\.71 lb per cubic foot/)
    expect(text).toMatch(/class 200/)
  })

  // The caveat is the point: this scale said 200 and Estes billed 175.
  it('warns that a carrier may class it differently', () => {
    expect(classNote(r).join(' ')).toMatch(/Estes billed 175/)
  })

  it('explains an override rather than treating it as a mistake', () => {
    const text = classNote(r, 175).join(' ')
    expect(text).toMatch(/You have set this line to 175/)
    expect(text).toMatch(/negotiated class/)
  })

  it('says what to do when there is nothing to compute', () => {
    const bad = freightClassFor({ totalWeightLbs: 0, lengthIn: 48, widthIn: 40, heightIn: 60, units: 1 })
    expect(classNote(bad).join(' ')).toMatch(/Fill in the weight and dimensions/)
  })
})
