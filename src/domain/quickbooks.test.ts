/**
 * Tests for the QuickBooks mapping.
 *
 * Most of these assert a REFUSAL. Getting a number wrong in an accounting
 * system is discovered months later by an accountant or the CRA, so the design
 * rule is that anything ambiguous blocks the push rather than being guessed —
 * and that rule is what needs locking down.
 */
import { describe, it, expect } from 'vitest'
import type { Product, SalesCustomer, SalesOrder } from '@/data/types'
import {
  type QboConfig,
  type QboLinks,
  buildCustomer,
  buildItem,
  buildTransaction,
  customerDisplayName,
  emptyLinks,
  hasBlocker,
  isTaxableSale,
  readInvoiceStatus,
} from './quickbooks'

// ═══════════════════════════════════════════════════════════════════════════
// Fixtures
// ═══════════════════════════════════════════════════════════════════════════

const customer = (over: Partial<SalesCustomer> = {}): SalesCustomer => ({
  id: 'c1',
  company: 'M&S Buckley Farms',
  contactName: 'Alyson Buckley',
  addressLines: ['763 Talbitt Road'],
  city: 'Walla Walla',
  region: 'WA',
  postalCode: '99362',
  country: 'US',
  taxId: '81-4440743',
  email: 'msbuckleyfarms@gmail.com',
  phone: '509-200-1183',
  gpsLink: '',
  notes: 'Bought 500 trays (2025)',
  ...over,
})

const product = (over: Partial<Product> = {}): Product => ({
  id: 'p1',
  sku: 'tray-top',
  name: 'Tray Top (air)',
  currency: 'USD',
  unit: 'each',
  labor: 0,
  markup: 0.25,
  roundTo: null,
  shipItem: 'Tray Tops',
  hsCode: null,
  countryOfOrigin: 'CA',
  active: true,
  notes: '',
  parts: [],
  tiers: [],
  ...over,
})

const order = (over: Partial<SalesOrder> = {}): SalesOrder => ({
  id: 'o1',
  number: 'INV-2026-014',
  kind: 'invoice',
  status: 'draft',
  fromEstimateId: null,
  customerId: 'c1',
  currency: 'CAD',
  fxRate: null,
  issuedDate: '2026-08-05',
  dueDate: '2026-09-04',
  poNumber: 'PO-4471',
  incoterm: null,
  incotermPlace: '',
  paymentTerms: '',
  transportMode: null,
  placeOfDirectShipment: '',
  countryOfTranshipment: '',
  reasonForExport: '',
  dateOfDirectShipment: null,
  carrier: '',
  freightTerms: null,
  declaredValue: null,
  specialInstructions: '',
  certifierRole: null,
  producer: '',
  signatoryName: '',
  signatoryTitle: '',
  shippingLogistics: null,
  notes: '',
  createdAt: '2026-08-05T00:00:00Z',
  updatedAt: '2026-08-05T00:00:00Z',
  lines: [
    {
      id: 'l1',
      productId: 'p1',
      description: 'Tray Top (air)',
      qty: 500,
      unit: 'each',
      unitPrice: 19.38,
      unitCost: 15.5,
      extended: 9690,
      hsCode: null,
      countryOfOrigin: 'CA',
      originCriterion: null,
      shipItem: 'Tray Tops',
      freightClass: null,
      nmfc: '',
      sort: 0,
    },
  ],
  charges: [],
  ...over,
})

const config = (over: Partial<QboConfig> = {}): QboConfig => ({
  homeCurrency: 'CAD',
  multicurrencyEnabled: true,
  defaultTaxCodeId: 'TAX-GST',
  exemptTaxCodeId: 'TAX-ZERO',
  shippingItemId: 'ITEM-SHIP',
  incomeAccountId: 'ACCT-SALES',
  ...over,
})

const links = (over: Partial<QboLinks> = {}): QboLinks => ({
  ...emptyLinks(),
  customers: { c1: 'QBO-CUST-1' },
  products: { p1: 'QBO-ITEM-1' },
  ...over,
})

/**
 * `customer` is passed through an options object rather than a defaulted
 * positional: `build(…, undefined)` would take the default and silently test
 * the wrong thing.
 */
const build = (
  o = order(),
  cfg = config(),
  lk = links(),
  taxable = true,
  opts: { customer?: SalesCustomer | undefined } = {},
) =>
  buildTransaction({
    order: o,
    customer: 'customer' in opts ? opts.customer : customer(),
    products: [product()],
    cfg,
    links: lk,
    taxable,
  })

// ═══════════════════════════════════════════════════════════════════════════
// Customers
// ═══════════════════════════════════════════════════════════════════════════

describe('customerDisplayName', () => {
  it('uses the company name when it is unique', () => {
    expect(customerDisplayName(customer(), [customer()])).toBe('M&S Buckley Farms')
  })

  it('disambiguates two customers at the SAME company', () => {
    // Real case: Stuart and Dennis are both "SD Custom Pollination Ltd.".
    // QuickBooks rejects a duplicate DisplayName, and the second push would
    // fail with an error that reads like a bug.
    const stuart = customer({ id: 'a', company: 'SD Custom Pollination Ltd.', contactName: 'Stuart Brummelhuis' })
    const dennis = customer({ id: 'b', company: 'SD Custom Pollination Ltd.', contactName: 'Dennis Unruh' })
    const all = [stuart, dennis]
    expect(customerDisplayName(stuart, all)).toBe('SD Custom Pollination Ltd. (Stuart Brummelhuis)')
    expect(customerDisplayName(dennis, all)).toBe('SD Custom Pollination Ltd. (Dennis Unruh)')
  })

  it('falls back to the contact when there is no company', () => {
    expect(customerDisplayName(customer({ company: '', contactName: 'Chris Siemens' }))).toBe('Chris Siemens')
  })

  it('is case-insensitive about the duplicate check', () => {
    const a = customer({ id: 'a', company: 'Witdouk', contactName: 'One' })
    const b = customer({ id: 'b', company: 'WITDOUK', contactName: 'Two' })
    expect(customerDisplayName(a, [a, b])).toBe('Witdouk (One)')
  })
})

describe('buildCustomer', () => {
  it('maps the address and splits the contact name', () => {
    const { payload, problems } = buildCustomer(customer())
    expect(payload.DisplayName).toBe('M&S Buckley Farms')
    expect(payload.GivenName).toBe('Alyson')
    expect(payload.FamilyName).toBe('Buckley')
    expect(payload.BillAddr).toEqual({
      Line1: '763 Talbitt Road',
      City: 'Walla Walla',
      CountrySubDivisionCode: 'WA',
      PostalCode: '99362',
      Country: 'US',
    })
    expect(hasBlocker(problems)).toBe(false)
  })

  it('handles a multi-word surname', () => {
    const { payload } = buildCustomer(customer({ contactName: 'Stuart Van Der Berg' }))
    expect(payload.GivenName).toBe('Stuart')
    expect(payload.FamilyName).toBe('Van Der Berg')
  })

  it('BLOCKS a customer with no name at all', () => {
    const { problems } = buildCustomer(customer({ company: '', contactName: '' }))
    expect(hasBlocker(problems)).toBe(true)
  })

  it('warns, but does not block, on a missing email', () => {
    const { problems } = buildCustomer(customer({ email: '' }))
    expect(hasBlocker(problems)).toBe(false)
    expect(problems.some((p) => p.field === 'email')).toBe(true)
  })

  it('omits an address block entirely when there is nothing to put in it', () => {
    const bare = customer({ addressLines: [], city: '', region: '', postalCode: '', country: '' })
    expect(buildCustomer(bare).payload.BillAddr).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Items
// ═══════════════════════════════════════════════════════════════════════════

describe('buildItem', () => {
  it('creates a NonInventory item against the configured income account', () => {
    const { payload } = buildItem(product(), config())
    expect(payload).toMatchObject({
      Name: 'Tray Top (air)',
      Sku: 'tray-top',
      Type: 'NonInventory',
      IncomeAccountRef: { value: 'ACCT-SALES' },
    })
  })

  it('BLOCKS without an income account rather than picking one', () => {
    // Posting revenue to a guessed account is an accounting problem someone
    // else has to unpick later.
    const { payload, problems } = buildItem(product(), config({ incomeAccountId: null }))
    expect(payload).toBeNull()
    expect(hasBlocker(problems)).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Transactions
// ═══════════════════════════════════════════════════════════════════════════

describe('buildTransaction', () => {
  it('builds a clean invoice', () => {
    const { payload, problems } = build()
    expect(problems).toEqual([])
    expect(payload).toMatchObject({
      DocNumber: 'INV-2026-014',
      TxnDate: '2026-08-05',
      DueDate: '2026-09-04',
      CustomerRef: { value: 'QBO-CUST-1' },
      CurrencyRef: { value: 'CAD' },
      GlobalTaxCalculation: 'TaxExcluded',
      CustomerMemo: { value: 'PO PO-4471' },
    })
    expect(payload!.Line).toHaveLength(1)
    expect(payload!.Line[0]).toMatchObject({
      Amount: 9690,
      SalesItemLineDetail: {
        ItemRef: { value: 'QBO-ITEM-1' },
        Qty: 500,
        UnitPrice: 19.38,
        TaxCodeRef: { value: 'TAX-GST' },
      },
    })
  })

  it('bills the STORED extended amount, not qty × unit price', () => {
    // The order carries what the customer was actually quoted. QuickBooks must
    // receive that same number, even if it doesn't multiply out exactly.
    const o = order({ lines: [{ ...order().lines[0], extended: 9687.5 }] })
    expect(build(o).payload!.Line[0].Amount).toBe(9687.5)
  })

  it('rounds money to cents so QuickBooks accepts it', () => {
    const o = order({ lines: [{ ...order().lines[0], extended: 1234.5678, unitPrice: 2.46913 }] })
    const line = build(o).payload!.Line[0]
    expect(line.Amount).toBe(1234.57)
    expect(line.SalesItemLineDetail.UnitPrice).toBe(2.47)
  })

  it('turns charges into lines, because QuickBooks has no free-text amount', () => {
    const o = order({
      charges: [{ id: 'ch1', label: 'Freight to border', amount: 2400, passThrough: true, isTransportToBorder: true, sort: 0 }],
    })
    const { payload } = build(o)
    expect(payload!.Line).toHaveLength(2)
    expect(payload!.Line[1]).toMatchObject({
      Amount: 2400,
      Description: 'Freight to border',
      SalesItemLineDetail: { ItemRef: { value: 'ITEM-SHIP' } },
    })
  })

  it('BLOCKS a charge when no shipping item is configured', () => {
    const o = order({
      charges: [{ id: 'ch1', label: 'Freight', amount: 100, passThrough: true, isTransportToBorder: false, sort: 0 }],
    })
    const { payload, problems } = build(o, config({ shippingItemId: null }))
    expect(payload).toBeNull()
    expect(problems.find((p) => p.field === 'charge')?.message).toContain('Freight')
  })

  it('BLOCKS an unlinked customer', () => {
    const { payload, problems } = build(order(), config(), links({ customers: {} }))
    expect(payload).toBeNull()
    expect(problems.find((p) => p.field === 'customer')?.message).toContain('Buckley')
  })

  it('BLOCKS an unlinked product', () => {
    const { payload, problems } = build(order(), config(), links({ products: {} }))
    expect(payload).toBeNull()
    expect(problems.find((p) => p.field === 'line')?.message).toContain('Tray Top')
  })

  it('BLOCKS a foreign-currency order when multicurrency is off', () => {
    // QuickBooks would reject it anyway, but with an opaque error. Better to
    // say which setting to change — and that it can't be undone.
    const { payload, problems } = build(
      order({ currency: 'USD' }),
      config({ multicurrencyEnabled: false }),
    )
    expect(payload).toBeNull()
    const m = problems.find((p) => p.field === 'currency')!.message
    expect(m).toContain('multicurrency')
    expect(m).toContain('cannot be undone')
  })

  it('allows a foreign-currency order when multicurrency IS on', () => {
    expect(hasBlocker(build(order({ currency: 'USD' })).problems)).toBe(false)
  })

  it('BLOCKS a taxable sale with no tax code, rather than posting zero GST', () => {
    const { payload, problems } = build(order(), config({ defaultTaxCodeId: null }), links(), true)
    expect(payload).toBeNull()
    expect(problems.find((p) => p.field === 'tax')?.message).toContain('filing problem')
  })

  it('only warns when the EXEMPT code is missing', () => {
    const { payload, problems } = build(order(), config({ exemptTaxCodeId: null }), links(), false)
    expect(payload).not.toBeNull()
    expect(hasBlocker(problems)).toBe(false)
  })

  it('marks a non-taxable sale NotApplicable and applies the exempt code', () => {
    const { payload } = build(order(), config(), links(), false)
    expect(payload!.GlobalTaxCalculation).toBe('NotApplicable')
    expect(payload!.Line[0].SalesItemLineDetail.TaxCodeRef).toEqual({ value: 'TAX-ZERO' })
  })

  it('BLOCKS an empty order', () => {
    const { payload, problems } = build(order({ lines: [], charges: [] }))
    expect(payload).toBeNull()
    expect(problems.some((p) => p.field === 'lines')).toBe(true)
  })

  it('BLOCKS with no customer at all', () => {
    const { payload } = build(order(), config(), links(), true, { customer: undefined })
    expect(payload).toBeNull()
  })

  it('reports every blocker at once rather than stopping at the first', () => {
    // An operator fixing these one round trip at a time is a bad afternoon.
    const { problems } = build(order(), config({ defaultTaxCodeId: null }), links({ customers: {}, products: {} }))
    expect(problems.filter((p) => p.severity === 'blocker').length).toBeGreaterThanOrEqual(3)
  })
})

describe('isTaxableSale', () => {
  it('treats a Canadian customer as taxable', () => {
    expect(isTaxableSale(customer({ country: 'CA' }))).toBe(true)
  })

  it('treats an export as zero-rated', () => {
    expect(isTaxableSale(customer({ country: 'US' }))).toBe(false)
  })

  it('defaults to taxable when the customer is unknown', () => {
    expect(isTaxableSale(undefined)).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Reading back
// ═══════════════════════════════════════════════════════════════════════════

describe('readInvoiceStatus', () => {
  it('reads a paid invoice off its balance', () => {
    // QuickBooks has no "paid" flag — Balance is the authority.
    expect(readInvoiceStatus({ Id: '42', DocNumber: 'INV-1', TotalAmt: 100, Balance: 0 })).toEqual({
      qboId: '42',
      docNumber: 'INV-1',
      totalAmt: 100,
      balance: 0,
      paid: true,
    })
  })

  it('reads a partly-paid invoice as unpaid', () => {
    expect(readInvoiceStatus({ Id: '42', TotalAmt: 100, Balance: 40 }).paid).toBe(false)
  })

  it('does NOT call a zero-total invoice paid', () => {
    // A $0 invoice has a $0 balance, which would otherwise read as settled.
    expect(readInvoiceStatus({ Id: '42', TotalAmt: 0, Balance: 0 }).paid).toBe(false)
  })

  it('survives missing fields', () => {
    expect(readInvoiceStatus({}).qboId).toBe('')
    expect(readInvoiceStatus({}).paid).toBe(false)
  })
})
