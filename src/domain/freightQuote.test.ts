import { describe, expect, it } from 'vitest'
import { buildFreightQuote, EMPTY_LOGISTICS, type QuoteInput } from './freightQuote'
import { DEFAULT_ITEM_SPECS, packShipment } from './packing'

const party = (over = {}) => ({
  company: 'TNT Pollination Ltd.',
  address: '134036 Township Road 110',
  cityRegion: 'Grassy Lake, AB',
  postalCode: 'T0K 0Z0',
  contactName: 'Tyler Torrie',
  contactPhone: '403-360-2528',
  contactEmail: 'tyler.torrie@tntpollination.com',
  ...over,
})

/** The Walla Walla shipment: 550 tops and 550 bottoms, as on the real BOL. */
function realShipment(over: Partial<QuoteInput> = {}): QuoteInput {
  const packing = packShipment(
    [
      { item: 'Tray Tops', qty: 550 },
      { item: 'Tray Bottoms', qty: 550 },
    ],
    DEFAULT_ITEM_SPECS,
  )
  return {
    shipper: party(),
    consignee: party({
      company: 'M&S Buckley Farms',
      address: '11537 Old Highway 12',
      cityRegion: 'Walla Walla, WA',
      postalCode: '99362',
      contactName: 'Alyson Buckley',
      contactPhone: '509-200-1183',
      contactEmail: 'msbuckleyfarms@gmail.com',
    }),
    incoterm: 'FCA',
    currency: 'USD',
    logistics: { ...EMPTY_LOGISTICS, pickupDate: '2026-02-25' },
    packing,
    lines: [
      { item: 'Tray Tops', description: 'Plastic bee incubator tray (tops)', qty: 550, hsCode: '3926.90', origin: 'USA', unitValue: 25 },
      { item: 'Tray Bottoms', description: 'Plastic bee incubator tray (bottoms)', qty: 550, hsCode: '3926.90', origin: 'USA', unitValue: 25 },
    ],
    ...over,
  }
}

describe('buildFreightQuote — the real shipment', () => {
  const q = buildFreightQuote(realShipment())

  // The Estes BOL for this load: 11 pallets, 4,725 lb, 48×40×82.
  it('lands on the pallet count from the real bill of lading', () => {
    expect(q.totals.units).toBe(11)
  })

  it('is within a few pounds of the weight the carrier billed', () => {
    expect(q.totals.weightLbs).toBeGreaterThan(3600)
    expect(q.totals.weightLbs).toBeLessThan(4900)
  })

  it('gives each line a pallet size the carrier would recognise', () => {
    for (const row of q.freight) expect(row.dimensions).toMatch(/^48x40x\d+$/)
  })

  it('values the goods off the order, not off the freight', () => {
    // 1,100 trays at $25 — the handwritten form totalled 13,750 per line.
    expect(q.totals.value).toBe(27500)
    expect(q.commercial[0].total).toBe(13750)
  })

  it('carries HS code and origin through from the lines', () => {
    expect(q.commercial.every((c) => c.hsCode === '3926.90' && c.origin === 'USA')).toBe(true)
  })
})

describe('freight class on the quote', () => {
  it('computes one per line, and can explain it', () => {
    const q = buildFreightQuote(realShipment())
    expect(q.freight[0].freightClass).toBeGreaterThan(0)
    expect(q.freight[0].classExplanation.join(' ')).toMatch(/lb per cubic foot/)
  })

  // The point of the override: Estes billed 175 where density says 200.
  it('prints the override and says it is one', () => {
    const input = realShipment()
    input.lines[0].freightClass = 175
    const q = buildFreightQuote(input)
    expect(q.freight[0].freightClass).toBe(175)
    expect(q.freight[0].overridden).toBe(true)
    expect(q.freight[0].classExplanation.join(' ')).toMatch(/You have set this line to 175/)
  })

  it('does not call an override an override when it agrees', () => {
    const input = realShipment()
    const computed = buildFreightQuote(input).freight[0].computed.freightClass
    input.lines[0].freightClass = computed
    expect(buildFreightQuote(input).freight[0].overridden).toBe(false)
  })
})

describe('blockers', () => {
  // Cole prices from this sheet: a blank field is a wrong quote or a phone call,
  // not a formatting problem.
  it('will not let a quote go out without a pickup date', () => {
    const q = buildFreightQuote({ ...realShipment(), logistics: EMPTY_LOGISTICS })
    expect(q.blockers.join(' ')).toMatch(/Pickup date/)
  })

  it('catches a missing HS code by name', () => {
    const input = realShipment()
    input.lines[0].hsCode = ''
    expect(buildFreightQuote(input).blockers.join(' ')).toMatch(/HS code for Plastic bee incubator tray \(tops\)/)
  })

  it('catches a missing destination', () => {
    const input = realShipment()
    input.consignee = { ...input.consignee, cityRegion: '' }
    expect(buildFreightQuote(input).blockers.join(' ')).toMatch(/Destination address/)
  })

  // An item with no spec is missing from the freight table entirely, which is
  // the kind of gap that reads as a complete form.
  it('says when an item is missing from the freight table', () => {
    const packing = packShipment([{ item: 'Corners', qty: 40 }], DEFAULT_ITEM_SPECS)
    const q = buildFreightQuote({
      ...realShipment(),
      packing,
      lines: [{ item: 'Corners', description: 'Corners', qty: 40, hsCode: '3926.90', origin: 'USA', unitValue: 5 }],
    })
    expect(q.blockers.join(' ')).toMatch(/no weight or dimensions on file/)
  })

  it('has nothing to say about a complete quote', () => {
    const q = buildFreightQuote(realShipment())
    expect(q.blockers).toEqual([])
  })
})
