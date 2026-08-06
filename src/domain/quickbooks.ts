/**
 * Mapping between TNT's sales records and QuickBooks Online. Pure functions —
 * no React, no DB, no network. The Netlify functions do the talking; this
 * decides WHAT to say.
 *
 * ── The rule: refuse rather than approximate ─────────────────────────────────
 *
 * Everything here returns `{ payload, problems }`, and a caller must not push
 * when `problems` contains a blocker. Wrong numbers in an accounting system are
 * far worse than a failed sync: a silently untaxed invoice or a line posted to
 * the wrong income account is discovered by an accountant months later, or by
 * the CRA. So nothing here guesses a tax code, invents an account, or rounds a
 * total to make QuickBooks accept it.
 *
 * ── Three QuickBooks facts that shape all of this ────────────────────────────
 *
 * 1. EVERY sales line needs an ItemRef. There is no free-text line on a QBO
 *    invoice, so freight and tariff charges need a mapped service item too —
 *    not just products.
 * 2. DisplayName is UNIQUE per company. Two of TNT's customers are both
 *    "SD Custom Pollination Ltd." (Stuart and Dennis), which QuickBooks will
 *    reject as a duplicate. `customerDisplayName` disambiguates with the
 *    contact name.
 * 3. Updates need the current SyncToken. QBO uses it for optimistic
 *    concurrency; a stale one fails the write, which is why `qbo_links` stores
 *    it and every update round-trips through a read first.
 */
import type { Product, SalesCustomer, SalesOrder } from '@/data/types'

/** QuickBooks' minor-version pin. Bumping it can change response shapes. */
export const QBO_MINOR_VERSION = 70

// ═══════════════════════════════════════════════════════════════════════════
// Problems
// ═══════════════════════════════════════════════════════════════════════════

export interface QboProblem {
  /** `blocker` must stop the push. `warning` is worth showing but not fatal. */
  severity: 'blocker' | 'warning'
  field: string
  message: string
}

export const hasBlocker = (problems: readonly QboProblem[]): boolean =>
  problems.some((p) => p.severity === 'blocker')

// ═══════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════

/**
 * How this company's QuickBooks is set up. Everything here comes from the
 * connected company, never from a default — account names and tax codes differ
 * per file, and guessing one posts money to the wrong place.
 */
export interface QboConfig {
  /** The company's home currency, from QBO CompanyInfo. */
  homeCurrency: string
  /** Whether the QBO file has multicurrency turned on. */
  multicurrencyEnabled: boolean
  /**
   * Tax code applied to taxable lines — a QBO TaxCode id, not a rate.
   * Null means the operator hasn't chosen one yet.
   */
  defaultTaxCodeId: string | null
  /** Tax code for non-taxable lines (out-of-province, exports). */
  exemptTaxCodeId: string | null
  /** QBO Item used for freight/brokerage charge lines. */
  shippingItemId: string | null
  /** Income account new items are created against. */
  incomeAccountId: string | null
}

/** Local id → QuickBooks id, from the `qbo_links` table. */
export interface QboLinks {
  customers: Record<string, string>
  products: Record<string, string>
  orders: Record<string, string>
}

export const emptyLinks = (): QboLinks => ({ customers: {}, products: {}, orders: {} })

// ═══════════════════════════════════════════════════════════════════════════
// Customers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A DisplayName QuickBooks will accept.
 *
 * DisplayName is unique per company, and TNT's list has two customers at
 * "SD Custom Pollination Ltd." — Stuart and Dennis. Pushing both would fail the
 * second with a duplicate-name error that reads like a bug. Appending the
 * contact disambiguates them the way a human would.
 */
export function customerDisplayName(c: SalesCustomer, allCustomers: readonly SalesCustomer[] = []): string {
  const company = c.company.trim()
  const contact = c.contactName.trim()
  if (!company) return contact || 'Unnamed customer'

  const sharesCompany = allCustomers.some(
    (o) => o.id !== c.id && o.company.trim().toLowerCase() === company.toLowerCase(),
  )
  return sharesCompany && contact ? `${company} (${contact})` : company
}

export interface QboCustomerPayload {
  DisplayName: string
  CompanyName?: string
  GivenName?: string
  FamilyName?: string
  PrimaryEmailAddr?: { Address: string }
  PrimaryPhone?: { FreeFormNumber: string }
  BillAddr?: {
    Line1?: string
    City?: string
    CountrySubDivisionCode?: string
    PostalCode?: string
    Country?: string
  }
  Notes?: string
  CurrencyRef?: { value: string }
}

/**
 * A customer for QuickBooks.
 *
 * Takes no `QboConfig`: nothing about a customer depends on the company's tax
 * codes or accounts. `CurrencyRef` would — a QBO customer's currency is fixed
 * at creation and cannot be changed afterwards — but the app has no per-customer
 * currency to supply, and inferring one from their country is exactly the kind
 * of guess this module refuses to make. QuickBooks defaults them to the home
 * currency, which is correctable by a human before it matters.
 */
export function buildCustomer(
  c: SalesCustomer,
  allCustomers: readonly SalesCustomer[] = [],
): { payload: QboCustomerPayload; problems: QboProblem[] } {
  const problems: QboProblem[] = []
  const display = customerDisplayName(c, allCustomers)

  if (!display.trim() || display === 'Unnamed customer') {
    problems.push({
      severity: 'blocker',
      field: 'name',
      message: 'Customer has neither a company nor a contact name — QuickBooks needs one to identify them.',
    })
  }

  // Split "Alyson Buckley" into given/family. QBO stores them separately and
  // an unsplit name sorts badly in their UI.
  const nameParts = c.contactName.trim().split(/\s+/)
  const given = nameParts[0] || undefined
  const family = nameParts.length > 1 ? nameParts.slice(1).join(' ') : undefined

  const payload: QboCustomerPayload = {
    DisplayName: display,
    ...(c.company.trim() ? { CompanyName: c.company.trim() } : {}),
    ...(given ? { GivenName: given } : {}),
    ...(family ? { FamilyName: family } : {}),
    ...(c.email.trim() ? { PrimaryEmailAddr: { Address: c.email.trim() } } : {}),
    ...(c.phone.trim() ? { PrimaryPhone: { FreeFormNumber: c.phone.trim() } } : {}),
    ...(c.notes.trim() ? { Notes: c.notes.trim() } : {}),
  }

  const addr = {
    ...(c.addressLines[0] ? { Line1: c.addressLines[0] } : {}),
    ...(c.city ? { City: c.city } : {}),
    ...(c.region ? { CountrySubDivisionCode: c.region } : {}),
    ...(c.postalCode ? { PostalCode: c.postalCode } : {}),
    ...(c.country ? { Country: c.country } : {}),
  }
  if (Object.keys(addr).length > 0) payload.BillAddr = addr

  if (!c.email.trim()) {
    problems.push({
      severity: 'warning',
      field: 'email',
      message: 'No email — QuickBooks will not be able to send them the invoice.',
    })
  }

  return { payload, problems }
}

// ═══════════════════════════════════════════════════════════════════════════
// Items
// ═══════════════════════════════════════════════════════════════════════════

export interface QboItemPayload {
  Name: string
  Sku?: string
  Type: 'NonInventory' | 'Service' | 'Inventory'
  IncomeAccountRef: { value: string }
  UnitPrice?: number
  Description?: string
  Taxable?: boolean
}

/**
 * A product as a QuickBooks item.
 *
 * Created as NonInventory deliberately, even though TNT tracks stock: a QBO
 * Inventory item additionally requires an asset account, a COGS account, an
 * opening quantity and an as-of date, and getting those wrong writes journal
 * entries an accountant then has to unpick. Stock lives in this app; QuickBooks
 * only needs to know what was sold and where the revenue goes.
 */
export function buildItem(p: Product, cfg: QboConfig): { payload: QboItemPayload | null; problems: QboProblem[] } {
  const problems: QboProblem[] = []

  if (!cfg.incomeAccountId) {
    problems.push({
      severity: 'blocker',
      field: 'incomeAccount',
      message: 'Pick the income account new items post to, in the QuickBooks settings, before syncing products.',
    })
    return { payload: null, problems }
  }

  return {
    payload: {
      Name: p.name,
      Sku: p.sku,
      Type: 'NonInventory',
      IncomeAccountRef: { value: cfg.incomeAccountId },
      Description: p.notes || undefined,
      Taxable: true,
    },
    problems,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Invoices and estimates
// ═══════════════════════════════════════════════════════════════════════════

export interface QboLine {
  DetailType: 'SalesItemLineDetail'
  Amount: number
  Description?: string
  SalesItemLineDetail: {
    ItemRef: { value: string }
    Qty?: number
    UnitPrice?: number
    TaxCodeRef?: { value: string }
  }
}

export interface QboTxnPayload {
  DocNumber?: string
  TxnDate: string
  DueDate?: string
  CustomerRef: { value: string }
  CurrencyRef?: { value: string }
  Line: QboLine[]
  /**
   * Required outside the US. 'TaxExcluded' means the line amounts are net and
   * QuickBooks adds tax on top — which is how TNT quotes.
   */
  GlobalTaxCalculation?: 'TaxExcluded' | 'TaxInclusive' | 'NotApplicable'
  CustomerMemo?: { value: string }
  PrivateNote?: string
  BillEmail?: { Address: string }
}

/** Round to cents. QuickBooks rejects more precision on money fields. */
const cents = (n: number): number => Math.round(n * 100) / 100

export interface BuildTxnInput {
  order: SalesOrder
  customer: SalesCustomer | undefined
  products: readonly Product[]
  cfg: QboConfig
  links: QboLinks
  /** Whether this sale is taxable. Exports to the US generally are not. */
  taxable: boolean
}

/**
 * An invoice or estimate for QuickBooks.
 *
 * Amounts come from the order's STORED line prices, never re-derived — the
 * customer was billed a number and QuickBooks has to receive that same number.
 */
export function buildTransaction(input: BuildTxnInput): {
  payload: QboTxnPayload | null
  problems: QboProblem[]
} {
  const { order, customer, products, cfg, links, taxable } = input
  const problems: QboProblem[] = []

  // ── Customer ──
  const customerQboId = customer ? links.customers[customer.id] : undefined
  if (!customer) {
    problems.push({ severity: 'blocker', field: 'customer', message: 'No customer selected on this order.' })
  } else if (!customerQboId) {
    problems.push({
      severity: 'blocker',
      field: 'customer',
      message: `${customer.company || customer.contactName} isn't linked to a QuickBooks customer yet — sync them first.`,
    })
  }

  // ── Currency ──
  if (order.currency !== cfg.homeCurrency && !cfg.multicurrencyEnabled) {
    problems.push({
      severity: 'blocker',
      field: 'currency',
      message:
        `This order is in ${order.currency} but the QuickBooks file is ${cfg.homeCurrency} with multicurrency off. ` +
        'Turn on multicurrency in QuickBooks (Account and Settings → Advanced) — it cannot be undone — or invoice in ' +
        `${cfg.homeCurrency}.`,
    })
  }

  // ── Tax ──
  const taxCodeId = taxable ? cfg.defaultTaxCodeId : cfg.exemptTaxCodeId
  if (taxable && !cfg.defaultTaxCodeId) {
    problems.push({
      severity: 'blocker',
      field: 'tax',
      message:
        'No tax code chosen for taxable sales. Pushing without one posts the invoice with no GST, which is a ' +
        'filing problem, not a display one.',
    })
  }
  if (!taxable && !cfg.exemptTaxCodeId) {
    problems.push({
      severity: 'warning',
      field: 'tax',
      message: 'No exempt tax code chosen — QuickBooks will apply the customer default instead.',
    })
  }

  // ── Lines ──
  const Line: QboLine[] = []

  for (const l of order.lines) {
    const product = products.find((p) => p.id === l.productId)
    const itemId = product ? links.products[product.id] : undefined
    if (!itemId) {
      problems.push({
        severity: 'blocker',
        field: 'line',
        message: `"${l.description}" isn't linked to a QuickBooks item — every QuickBooks sales line needs one.`,
      })
      continue
    }
    Line.push({
      DetailType: 'SalesItemLineDetail',
      Amount: cents(l.extended),
      Description: l.description,
      SalesItemLineDetail: {
        ItemRef: { value: itemId },
        Qty: l.qty,
        UnitPrice: cents(l.unitPrice),
        ...(taxCodeId ? { TaxCodeRef: { value: taxCodeId } } : {}),
      },
    })
  }

  // Charges are lines too — QBO has no free-text amount.
  for (const c of order.charges) {
    if (!cfg.shippingItemId) {
      problems.push({
        severity: 'blocker',
        field: 'charge',
        message:
          `"${c.label}" needs a QuickBooks item. Pick the service item to use for freight and charges in the ` +
          'QuickBooks settings.',
      })
      continue
    }
    Line.push({
      DetailType: 'SalesItemLineDetail',
      Amount: cents(c.amount),
      Description: c.label,
      SalesItemLineDetail: {
        ItemRef: { value: cfg.shippingItemId },
        Qty: 1,
        UnitPrice: cents(c.amount),
        ...(taxCodeId ? { TaxCodeRef: { value: taxCodeId } } : {}),
      },
    })
  }

  if (Line.length === 0) {
    problems.push({ severity: 'blocker', field: 'lines', message: 'Nothing to invoice — the order has no lines.' })
  }

  if (hasBlocker(problems)) return { payload: null, problems }

  const payload: QboTxnPayload = {
    DocNumber: order.number,
    TxnDate: order.issuedDate,
    ...(order.dueDate ? { DueDate: order.dueDate } : {}),
    CustomerRef: { value: customerQboId! },
    CurrencyRef: { value: order.currency },
    Line,
    // TNT quotes net and adds freight/tax on top.
    GlobalTaxCalculation: taxable ? 'TaxExcluded' : 'NotApplicable',
    ...(order.poNumber ? { CustomerMemo: { value: `PO ${order.poNumber}` } } : {}),
    ...(order.notes ? { PrivateNote: order.notes } : {}),
    ...(customer?.email ? { BillEmail: { Address: customer.email } } : {}),
  }

  return { payload, problems }
}

/**
 * Whether a sale should carry Canadian sales tax.
 *
 * A shipment leaving Canada is a zero-rated export, so a US-bound sale is not
 * taxed here. This is the common case and the right default, but it is a
 * *default*, not a ruling — place of supply has genuine edge cases and the
 * operator can override it per order.
 */
export function isTaxableSale(customer: SalesCustomer | undefined): boolean {
  if (!customer) return true
  return customer.country.toUpperCase() === 'CA'
}

// ═══════════════════════════════════════════════════════════════════════════
// Reading back
// ═══════════════════════════════════════════════════════════════════════════

/** The bits of a QBO invoice the app cares about when pulling payment status. */
export interface QboInvoiceStatus {
  qboId: string
  docNumber: string | null
  totalAmt: number
  balance: number
  paid: boolean
}

/**
 * Read payment status off a QBO invoice.
 *
 * `Balance` is the authority, not a status field — QuickBooks has no "paid"
 * flag. Zero balance on a non-zero invoice means settled. A zero-total invoice
 * also has a zero balance, so that is excluded rather than reported as paid.
 */
export function readInvoiceStatus(row: Record<string, unknown>): QboInvoiceStatus {
  const totalAmt = Number(row.TotalAmt ?? 0)
  const balance = Number(row.Balance ?? 0)
  return {
    qboId: String(row.Id ?? ''),
    docNumber: row.DocNumber ? String(row.DocNumber) : null,
    totalAmt,
    balance,
    paid: totalAmt > 0 && balance === 0,
  }
}
