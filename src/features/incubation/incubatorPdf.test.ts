import { describe, it, expect } from 'vitest'
import { emergingLabel } from './incubatorPdf'

/**
 * The inspection form has two checkboxes, "Bees emerging" and "Parasites
 * emerging". The PDF column used to print a bare "bees", which said nothing
 * about what was being claimed. These cases pin what each state means.
 */
describe('emergingLabel', () => {
  it('names what was seen', () => {
    expect(emergingLabel(true, false)).toBe('Bees')
    expect(emergingLabel(false, true)).toBe('Parasites')
    expect(emergingLabel(true, true)).toBe('Bees + Parasites')
  })

  it('distinguishes "looked and saw none" from "nobody recorded it"', () => {
    // Both render as something in the column, but they are different claims and
    // collapsing them would put words in the inspector's mouth.
    expect(emergingLabel(false, false)).toBe('None')
    expect(emergingLabel(null, null)).toBe('—')
    expect(emergingLabel(undefined, undefined)).toBe('—')
  })

  it('treats a half-recorded round as recorded', () => {
    // One box ticked false and the other never filled in still means somebody
    // looked, so "None" is the honest reading rather than a dash.
    expect(emergingLabel(false, null)).toBe('None')
  })
})
