import { describe, it, expect } from 'vitest'
import { guessColumns, toSamples, samplesCentre, type SheetTable } from './returnsImport'

describe('guessColumns', () => {
  it('finds the obvious names', () => {
    expect(guessColumns(['Block', 'Latitude', 'Longitude', 'Return lbs'])).toEqual({
      label: 0,
      lat: 1,
      lng: 2,
      value: 3,
    })
  })

  it('handles QGIS-style x/y columns', () => {
    const c = guessColumns(['id', 'X', 'Y', 'weight'])
    expect(c.lng).toBe(1)
    expect(c.lat).toBe(2)
  })

  it('prefers an exact match over a partial one', () => {
    // Both columns contain "weight"; the exact `lbs`-style name should win
    // rather than whichever appears first.
    const c = guessColumns(['lat', 'lng', 'gross_weight', 'return'])
    expect(c.value).toBe(3)
  })

  it('reports -1 for anything it cannot find', () => {
    const c = guessColumns(['alpha', 'beta'])
    expect(c.lat).toBe(-1)
    expect(c.value).toBe(-1)
  })
})

const table = (headers: string[], rows: unknown[][]): SheetTable => ({ headers, rows })

describe('toSamples', () => {
  const cols = { lat: 0, lng: 1, value: 2, label: 3 }

  it('reads valid rows', () => {
    const r = toSamples(table(['lat', 'lng', 'v', 'b'], [[49.83, -111.6, 8.1, 'BLK1']]), cols)
    expect(r.samples).toEqual([{ lat: 49.83, lng: -111.6, value: 8.1, label: 'BLK1' }])
    expect(r.skipped).toBe(0)
  })

  it('drops rows with no coordinate rather than defaulting them to 0,0', () => {
    // A block at 0,0 would drag the whole surface to the Gulf of Guinea.
    const r = toSamples(table(['lat', 'lng', 'v', 'b'], [[null, -111.6, 8, 'A'], [49.8, null, 8, 'B']]), cols)
    expect(r.samples).toHaveLength(0)
    expect(r.skipped).toBe(2)
    expect(r.reasons.join(' ')).toMatch(/coordinate/)
  })

  it('drops impossible coordinates', () => {
    const r = toSamples(table(['lat', 'lng', 'v', 'b'], [[999, -111.6, 8, 'A']]), cols)
    expect(r.samples).toHaveLength(0)
    expect(r.skipped).toBe(1)
  })

  it('drops rows with no weight rather than calling them zero', () => {
    // Zero is a real measurement; blank is not, and treating one as the other
    // would invent a dead patch in the field.
    const r = toSamples(table(['lat', 'lng', 'v', 'b'], [[49.83, -111.6, null, 'A']]), cols)
    expect(r.samples).toHaveLength(0)
    expect(r.reasons.join(' ')).toMatch(/no weight/)
  })

  it('keeps a genuine zero', () => {
    const r = toSamples(table(['lat', 'lng', 'v', 'b'], [[49.83, -111.6, 0, 'A']]), cols)
    expect(r.samples).toHaveLength(1)
    expect(r.samples[0].value).toBe(0)
  })

  it('works without a label column', () => {
    const r = toSamples(table(['lat', 'lng', 'v'], [[49.83, -111.6, 5]]), { ...cols, label: -1 })
    expect(r.samples[0].label).toBeUndefined()
  })

  it('counts partial imports so they are not silently lost', () => {
    const r = toSamples(
      table(['lat', 'lng', 'v', 'b'], [
        [49.83, -111.6, 5, 'A'],
        [null, null, null, 'B'],
        [49.84, -111.61, 6, 'C'],
      ]),
      cols,
    )
    expect(r.samples).toHaveLength(2)
    expect(r.skipped).toBe(1)
  })
})

describe('samplesCentre', () => {
  it('averages the points', () => {
    const c = samplesCentre([
      { lat: 49.8, lng: -111.6, value: 1 },
      { lat: 49.9, lng: -111.4, value: 2 },
    ])!
    expect(c.lat).toBeCloseTo(49.85, 6)
    expect(c.lng).toBeCloseTo(-111.5, 6)
  })

  it('is null with nothing to centre on', () => {
    expect(samplesCentre([])).toBeNull()
  })
})
