/**
 * Tests for the shipping-paperwork builders.
 *
 * The thing under test is mostly NOT the happy path — it's the refusal to emit
 * a complete-looking document from incomplete data. A commercial invoice with a
 * blank HS code still prints; the point of `missing` is that the UI knows not
 * to let it.
 *
 * The scenario throughout is a real one from the workbook's `Customers` sheet:
 * TNT in Grassy Lake, Alberta shipping trays to M&S Buckley Farms in Walla
 * Walla, Washington.
 */
import { describe, it, expect } from 'vitest'
import { packShipment } from './packing'
import {
  type DocContext,
  type Party,
  billOfLading,
  buildDocuments,
  canadaCustomsInvoice,
  commercialInvoice,
  cusmaCertificate,
  formatParty,
  isReady,
  packingList,
} from './salesDocs'

const TNT: Party = {
  name: 'TNT Pollination',
  addressLines: ['Box 123'],
  city: 'Grassy Lake',
  region: 'AB',
  postalCode: 'T0K 0Z0',
  country: 'CA',
  taxId: '123456789RC0001',
  email: 'office@tntpollination.com',
}

const BUCKLEY: Party = {
  name: 'M&S Buckley Farms',
  contactName: 'Alyson Buckley',
  addressLines: ['763 Talbitt Road'],
  city: 'Walla Walla',
  region: 'WA',
  postalCode: '99362',
  country: 'US',
  taxId: '81-4440743',
  phone: '509-200-1183',
}

const PACKING = packShipment(
  [
    { item: 'Tray Tops', qty: 500 },
    { item: 'Tray Bottoms', qty: 500 },
  ],
  undefined,
  { palletTareLbs: 40 },
)

/** A fully-specified shipment — nothing required missing. */
const COMPLETE: DocContext = {
  invoiceNumber: 'INV-2026-014',
  invoiceDate: '2026-08-05',
  dateOfDirectShipment: '2026-08-07',
  purchaseOrder: 'PO-4471',
  vendor: TNT,
  consignee: BUCKLEY,
  currency: 'USD',
  incoterm: 'FCA',
  incotermPlace: 'Grassy Lake, AB',
  paymentTerms: 'Net 30',
  lines: [
    {
      description: 'Leafcutter bee nesting tray, top (air)',
      hsCode: '392690',
      countryOfOrigin: 'CA',
      qty: 500,
      unit: 'each',
      unitPrice: 33.63,
      extended: 16815,
      originCriterion: 'B',
    },
    {
      description: 'Leafcutter bee nesting tray, bottom (dough)',
      hsCode: '392690',
      countryOfOrigin: 'CA',
      qty: 500,
      unit: 'each',
      unitPrice: 33.63,
      extended: 16815,
      originCriterion: 'B',
    },
  ],
  charges: [{ label: 'Freight to border', amount: 2400, isTransportToBorder: true }],
  total: 36030,
  packing: PACKING,
  packageKind: 'pallets',
  transportMode: 'road',
  placeOfDirectShipment: 'Grassy Lake, AB',
  reasonForExport: 'Sale',
  certifierRole: 'exporter',
  producer: 'VARIOUS',
  signatory: { name: 'Tyler Torrie', title: 'Owner' },
  carrier: 'Paige Logistics',
  freightTerms: 'prepaid',
}

/** Strip a key to simulate the field not having been filled in. */
const without = <K extends keyof DocContext>(k: K, v: DocContext[K] | undefined = undefined): DocContext => ({
  ...COMPLETE,
  [k]: v,
})

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

describe('formatParty', () => {
  it('builds a mailable address block', () => {
    expect(formatParty(BUCKLEY)).toBe(
      'M&S Buckley Farms\nAlyson Buckley\n763 Talbitt Road\nWalla Walla, WA, 99362\nUS',
    )
  })

  it('omits the parts a party does not have', () => {
    expect(formatParty({ name: 'Witdouk', addressLines: [], country: 'CA' })).toBe('Witdouk\nCA')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Commercial invoice
// ═══════════════════════════════════════════════════════════════════════════

describe('commercialInvoice', () => {
  it('is ready when everything is supplied', () => {
    const doc = commercialInvoice(COMPLETE)
    expect(isReady(doc)).toBe(true)
    expect(doc.missing).toEqual([])
  })

  it('carries the packing weights, not a separately-typed figure', () => {
    const doc = commercialInvoice(COMPLETE)
    const gross = doc.fields.find((f) => f.label === 'Gross weight')!.value
    // 500 tops (4 pallets) + 500 bottoms (5 pallets) = 9 pallets.
    // Goods 1700 + 1800 = 3500 lb, plus 9 × 40 lb of pallet = 3860 lb.
    expect(gross).toContain('3,860')
  })

  it('lists charges as their own rows so the total reconciles', () => {
    const doc = commercialInvoice(COMPLETE)
    expect(doc.lines).toHaveLength(3)
    expect(doc.lines[2].description).toBe('Freight to border')
    expect(doc.lines[2].extended).toContain('2,400.00')
  })

  it('BLOCKS on a missing HS code', () => {
    const ctx = { ...COMPLETE, lines: [{ ...COMPLETE.lines[0], hsCode: undefined }, COMPLETE.lines[1]] }
    const doc = commercialInvoice(ctx)
    expect(isReady(doc)).toBe(false)
    expect(doc.missing.find((m) => m.label.startsWith('HS code'))?.severity).toBe('required')
  })

  it('BLOCKS on a missing country of origin', () => {
    const ctx = { ...COMPLETE, lines: [{ ...COMPLETE.lines[0], countryOfOrigin: undefined }, COMPLETE.lines[1]] }
    expect(isReady(commercialInvoice(ctx))).toBe(false)
  })

  it('BLOCKS when an item on the order has no shipping spec', () => {
    // The workbook's silent failure: corners have no weight on file.
    const ctx: DocContext = {
      ...COMPLETE,
      packing: packShipment([{ item: 'Tray Tops', qty: 500 }, { item: 'Corners', qty: 8000 }]),
    }
    const doc = commercialInvoice(ctx)
    expect(isReady(doc)).toBe(false)
    expect(doc.missing.find((m) => m.label === 'Shipping specs')?.why).toContain('Corners')
  })

  it('only RECOMMENDS the softer fields', () => {
    const doc = commercialInvoice({ ...without('incoterm'), reasonForExport: undefined })
    expect(isReady(doc)).toBe(true)
    expect(doc.missing.map((m) => m.severity)).toEqual(['recommended', 'recommended'])
  })

  it('flags a consignee with no tax ID', () => {
    const doc = commercialInvoice({ ...COMPLETE, consignee: { ...BUCKLEY, taxId: undefined } })
    expect(doc.missing.some((m) => m.label.includes('EIN/BN'))).toBe(true)
    expect(isReady(doc)).toBe(true) // recommended, not blocking
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Canada Customs Invoice
// ═══════════════════════════════════════════════════════════════════════════

describe('canadaCustomsInvoice', () => {
  it('emits the numbered boxes in form order', () => {
    const doc = canadaCustomsInvoice(COMPLETE)
    const boxes = doc.fields.map((f) => f.box).filter((b): b is number => b != null)
    expect(boxes).toEqual([...boxes].sort((a, b) => a - b))
    expect(boxes).toContain(1)
    expect(boxes).toContain(17)
  })

  it('breaks transport-to-border charges out into box 23', () => {
    const doc = canadaCustomsInvoice(COMPLETE)
    expect(doc.fields.find((f) => f.box === 23)!.value).toContain('2,400.00')
  })

  it('leaves box 23 empty when no charge is marked as transport to border', () => {
    const doc = canadaCustomsInvoice({ ...COMPLETE, charges: [{ label: 'Handling', amount: 300 }] })
    expect(doc.fields.find((f) => f.box === 23)!.value).toBe('')
  })

  it('BLOCKS without the date of direct shipment (box 2)', () => {
    const doc = canadaCustomsInvoice(without('dateOfDirectShipment'))
    expect(isReady(doc)).toBe(false)
    expect(doc.missing.some((m) => m.label.includes('box 2'))).toBe(true)
  })

  it('BLOCKS without mode and place of shipment (box 8)', () => {
    expect(isReady(canadaCustomsInvoice(without('placeOfDirectShipment')))).toBe(false)
    expect(isReady(canadaCustomsInvoice(without('transportMode')))).toBe(false)
  })

  it('only RECOMMENDS the HS code — CI1 has no HS box', () => {
    const ctx = { ...COMPLETE, lines: COMPLETE.lines.map((l) => ({ ...l, hsCode: undefined })) }
    const doc = canadaCustomsInvoice(ctx)
    expect(doc.missing.find((m) => m.label.startsWith('HS code'))?.severity).toBe('recommended')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// CUSMA certification — the one with legal teeth
// ═══════════════════════════════════════════════════════════════════════════

describe('cusmaCertificate', () => {
  it('is ready with all nine data elements', () => {
    expect(isReady(cusmaCertificate(COMPLETE))).toBe(true)
  })

  it('includes the prescribed certification statement', () => {
    const doc = cusmaCertificate(COMPLETE)
    expect(doc.fields.find((f) => f.label === 'Certification statement')!.value).toContain(
      'qualify as originating',
    )
  })

  it('BLOCKS on a missing origin criterion and says whose call it is', () => {
    const ctx = { ...COMPLETE, lines: COMPLETE.lines.map((l) => ({ ...l, originCriterion: undefined })) }
    const doc = cusmaCertificate(ctx)
    expect(isReady(doc)).toBe(false)
    const m = doc.missing.find((x) => x.label.startsWith('Origin criterion'))!
    expect(m.why).toContain('cannot be inferred')
  })

  it('BLOCKS a good originating outside North America', () => {
    // Certifying a Chinese-made good under CUSMA is a false statement.
    const ctx = { ...COMPLETE, lines: [{ ...COMPLETE.lines[0], countryOfOrigin: 'CN' }] }
    const doc = cusmaCertificate(ctx)
    expect(isReady(doc)).toBe(false)
    expect(doc.missing.find((m) => m.label.includes('Non-CUSMA'))?.why).toContain('CN')
  })

  it('accepts US and Mexican origin alongside Canadian', () => {
    const ctx = {
      ...COMPLETE,
      lines: [
        { ...COMPLETE.lines[0], countryOfOrigin: 'US' },
        { ...COMPLETE.lines[1], countryOfOrigin: 'MX' },
      ],
    }
    expect(isReady(cusmaCertificate(ctx))).toBe(true)
  })

  it('BLOCKS without a signatory', () => {
    expect(isReady(cusmaCertificate(without('signatory')))).toBe(false)
  })

  it('BLOCKS without a certifier role', () => {
    expect(isReady(cusmaCertificate(without('certifierRole')))).toBe(false)
  })

  it('accepts the permitted producer placeholders', () => {
    expect(isReady(cusmaCertificate({ ...COMPLETE, producer: 'AVAILABLE UPON REQUEST' }))).toBe(true)
    expect(isReady(cusmaCertificate(without('producer')))).toBe(false)
  })

  it('requires an HS code on every certified line', () => {
    const ctx = { ...COMPLETE, lines: [{ ...COMPLETE.lines[0], hsCode: undefined }] }
    expect(isReady(cusmaCertificate(ctx))).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Packing list + BOL
// ═══════════════════════════════════════════════════════════════════════════

describe('packingList', () => {
  it('itemizes each packed line', () => {
    const doc = packingList(COMPLETE)
    expect(doc.lines).toHaveLength(2)
    expect(doc.lines[0].item).toBe('Tray Tops')
    expect(doc.lines[0].pallets).toBe('4')
    expect(doc.lines[1].pallets).toBe('5')
  })

  it('BLOCKS when something on the order never made it onto a pallet', () => {
    const doc = packingList({
      ...COMPLETE,
      packing: packShipment([{ item: 'Tray Tops', qty: 500 }, { item: 'Bungees', qty: 1000 }]),
    })
    expect(isReady(doc)).toBe(false)
    expect(doc.missing[0].why).toContain('1000 × Bungees')
  })
})

/** One freight row, shaped as `buildFreightQuote` returns them. */
const FREIGHT = [
  {
    item: 'Tray Tops',
    description: 'Tray Tops',
    handlingUnitType: 'Pallet',
    units: 4,
    dimensions: '48x40x83',
    weightPerUnitLbs: 465,
    totalWeightLbs: 1860,
    dgUn: '',
    nmfc: '156600',
    stacksPerPallet: 4,
    freightClass: 175,
    computed: { cubicFeet: 307, density: 6.1, freightClass: 150, problem: null },
    overridden: true,
    stackable: 'no' as const,
    classExplanation: [],
  },
]

describe('billOfLading', () => {
  it('is ready with a carrier and freight terms', () => {
    expect(isReady(billOfLading(COMPLETE))).toBe(true)
  })

  it('BLOCKS without a carrier', () => {
    expect(isReady(billOfLading(without('carrier')))).toBe(false)
  })

  it('BLOCKS without freight terms', () => {
    expect(isReady(billOfLading(without('freightTerms')))).toBe(false)
  })

  it('declares gross weight, since that is what the carrier reweighs against', () => {
    const doc = billOfLading(COMPLETE)
    expect(doc.fields.find((f) => f.label === 'Gross weight')!.value).toContain('3,860')
  })

  // The rule is that a GUESSED class is worse than none - not that a class
  // never belongs on a BOL. With no freight table there is nothing to print.
  it('leaves the class column off entirely when nothing has been worked out', () => {
    const doc = billOfLading(COMPLETE)
    expect(JSON.stringify(doc)).not.toMatch(/nmfc|freightClass/i)
  })

  it('prints class, NMFC and dimensions when a freight table is supplied', () => {
    const doc = billOfLading({ ...COMPLETE, freight: FREIGHT })
    expect(doc.lines[0].freightClass).toBe('175')
    expect(doc.lines[0].nmfc).toBe('156600')
    expect(doc.lines[0].dimensions).toBe('48x40x83')
  })

  // A zero would read as an answer. A carrier seeing a blank asks; a carrier
  // seeing 0 classes it themselves.
  it('leaves the class cell blank rather than zero when a line has none', () => {
    const doc = billOfLading({ ...COMPLETE, freight: [{ ...FREIGHT[0], freightClass: null }] })
    expect(doc.lines[0].freightClass).toBe('')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// buildDocuments — which documents a shipment actually gets
// ═══════════════════════════════════════════════════════════════════════════

describe('buildDocuments', () => {
  it('gives a US-bound sale an invoice, CUSMA cert, packing list and BOL — no CI1', () => {
    const kinds = buildDocuments(COMPLETE).map((d) => d.kind)
    expect(kinds).toEqual(['commercial-invoice', 'cusma-certificate', 'packing-list', 'bill-of-lading'])
  })

  it('adds the CI1 for goods entering Canada', () => {
    const inbound: DocContext = { ...COMPLETE, consignee: { ...TNT }, vendor: BUCKLEY }
    expect(buildDocuments(inbound).map((d) => d.kind)).toContain('canada-customs-invoice')
  })

  it('omits the CUSMA certification unless someone is claiming preference', () => {
    const kinds = buildDocuments(without('certifierRole')).map((d) => d.kind)
    expect(kinds).not.toContain('cusma-certificate')
  })

  it('every document reports its own readiness', () => {
    const docs = buildDocuments(COMPLETE)
    expect(docs.every(isReady)).toBe(true)
  })
})
