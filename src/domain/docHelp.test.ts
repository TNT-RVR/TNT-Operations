import { describe, expect, it } from 'vitest'
import { DOC_HELP, helpFor } from './docHelp'

describe('DOC_HELP', () => {
  it('covers every section of the freight paperwork', () => {
    // The sections of the Cole quote and the bill of lading. A form section
    // with no info button is the one someone will guess at.
    for (const key of [
      'shipper',
      'consignee',
      'pickupDate',
      'incoterm',
      'logistics',
      'handlingUnits',
      'weight',
      'dimensions',
      'freightClass',
      'stackable',
      'dangerousGoods',
      'hsCode',
      'countryOfOrigin',
      'unitValue',
      'broker',
      'billingTerms',
    ]) {
      expect(helpFor(key), key).not.toBeNull()
    }
  })

  it('gives every note a title and something to read', () => {
    for (const [key, note] of Object.entries(DOC_HELP)) {
      expect(note.title.length, key).toBeGreaterThan(2)
      expect(note.body.length, key).toBeGreaterThan(0)
      for (const p of note.body) expect(p.trim().length, key).toBeGreaterThan(20)
    }
  })

  // The useful half of an explanation is what goes wrong. A note that only
  // defines the term tells someone nothing about whether to check it.
  it('says what happens when a field is wrong, not just what it is', () => {
    expect(DOC_HELP.weight.body.join(' ')).toMatch(/reweigh/i)
    expect(DOC_HELP.freightClass.body.join(' ')).toMatch(/175|override/i)
    expect(DOC_HELP.logistics.body.join(' ')).toMatch(/liftgate/i)
    expect(DOC_HELP.hsCode.body.join(' ')).toMatch(/duty/i)
  })

  it('has nothing for an unknown key rather than an empty box', () => {
    expect(helpFor('no-such-field')).toBeNull()
  })
})
