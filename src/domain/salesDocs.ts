/**
 * Cross-border shipping paperwork, derived from an invoice + its packing plan.
 * Pure functions — no React, no DB, no PDF layout. This module decides WHAT
 * goes in each field; a renderer decides how it looks.
 *
 * Four documents, because a TNT shipment to a US grower needs all four:
 *
 *   Commercial Invoice   — the core customs document for any commercial export
 *   Canada Customs (CI1) — CBSA's own 25-field form, for goods entering Canada
 *                          (TNT's tray shipments from New Jersey)
 *   CUSMA certification  — the 9 minimum data elements that claim duty-free
 *                          treatment under the Canada–US–Mexico agreement
 *   Packing list + BOL   — the carrier-facing pair: what's on each pallet, and
 *                          the contract of carriage
 *
 * ── The design rule: never silently emit an incomplete document ──────────────
 *
 * Every builder returns `missing` alongside `fields`. A customs document with a
 * blank HS code or a guessed country of origin is worse than no document — it
 * delays the shipment at best, and a wrong origin claim on a CUSMA certification
 * is a false statement to two governments. So nothing here invents a value it
 * wasn't given. `isReady()` is the gate the UI should check before letting
 * anyone print or send.
 *
 * ── Scope note ───────────────────────────────────────────────────────────────
 *
 * The field lists follow each form's published requirements (CBSA form CI1, and
 * CUSMA Annex 5-A's minimum data elements). This module gets the RIGHT DATA into
 * the RIGHT FIELDS; it does not classify goods, determine an origin criterion,
 * or decide whether a good qualifies. Those are judgement calls that belong to
 * a customs broker, and `originCriterion` and `hsCode` are inputs here, never
 * derived. Have a broker review the first of each document type.
 */
import type { PackedShipment } from './packing'
import type { Currency } from './pricing'

// ═══════════════════════════════════════════════════════════════════════════
// Shared shapes
// ═══════════════════════════════════════════════════════════════════════════

/** ISO 3166-1 alpha-2, uppercase. 'CA', 'US', 'MX'. */
export type CountryCode = string

/** A named party on a document — shipper, consignee, purchaser, certifier. */
export interface Party {
  name: string
  contactName?: string
  addressLines: string[]
  city?: string
  /** Province or state. */
  region?: string
  postalCode?: string
  country: CountryCode
  /**
   * Business/tax number. Canada: BN (Business Number). US: EIN.
   * The `Customers` sheet already carried these in its EIN/BN column.
   */
  taxId?: string
  phone?: string
  email?: string
}

/** One good on the paperwork. */
export interface DocLine {
  description: string
  /**
   * Harmonized System code. Six digits is the international minimum and what
   * CUSMA requires; ten digits is the full national tariff line.
   * NEVER guessed — an input, or the line is reported incomplete.
   */
  hsCode?: string
  /** Where the good was made, not where it ships from. */
  countryOfOrigin?: CountryCode
  qty: number
  unit: string
  unitPrice: number
  extended: number
  netWeightLbs?: number
  /**
   * CUSMA origin criterion A–D. A = wholly obtained, B = produced from
   * originating materials, C = meets a product-specific rule, D = specific
   * assembly cases. A broker's call, never inferred here.
   */
  originCriterion?: 'A' | 'B' | 'C' | 'D'
}

/** An amount on the invoice that isn't a good — freight, tariffs, brokerage. */
export interface DocCharge {
  label: string
  amount: number
  /**
   * True when this is transport/insurance from the place of direct shipment.
   * CI1 field 23 has to break that out separately from the invoice total.
   */
  isTransportToBorder?: boolean
}

/** Incoterms 2020 — who bears cost and risk, and to what point. */
export type Incoterm = 'EXW' | 'FCA' | 'FAS' | 'FOB' | 'CFR' | 'CIF' | 'CPT' | 'CIP' | 'DAP' | 'DPU' | 'DDP'

export type TransportMode = 'road' | 'rail' | 'air' | 'marine' | 'courier'

/**
 * Everything the four documents draw on. Assembled from an invoice, its
 * customer, and the packing result.
 */
export interface DocContext {
  invoiceNumber: string
  /** ISO date. */
  invoiceDate: string
  /** ISO date the goods actually leave. CI1 field 2. */
  dateOfDirectShipment?: string
  purchaseOrder?: string

  /** The seller of record. CI1 field 1. */
  vendor: Party
  /** Who receives the goods. CI1 field 4. */
  consignee: Party
  /** The buyer, when that isn't the consignee. CI1 field 5. */
  purchaser?: Party
  /** The exporter, when that isn't the vendor. CI1 field 19. */
  exporter?: Party

  currency: Currency
  incoterm?: Incoterm
  /** The named place that completes the Incoterm — 'FCA Grassy Lake, AB'. */
  incotermPlace?: string
  paymentTerms?: string

  lines: DocLine[]
  charges: DocCharge[]
  /** Invoice total including charges. CI1 field 17. */
  total: number

  packing: PackedShipment
  /** How many physical packages/pallets. Defaults to the packing pallet count. */
  packageCount?: number
  /** 'Pallets', 'Cartons'. */
  packageKind?: string

  transportMode?: TransportMode
  /** Where the goods begin their direct trip to the destination. CI1 field 8. */
  placeOfDirectShipment?: string
  /** CI1 field 6 — only if the goods pass through a third country. */
  countryOfTranshipment?: CountryCode
  /** Why the goods are crossing: 'Sale', 'Sample, no commercial value', 'Repair'. */
  reasonForExport?: string

  // ── CUSMA certification ──
  /** Who is certifying. CUSMA data element 1. */
  certifierRole?: 'importer' | 'exporter' | 'producer'
  certifier?: Party
  /**
   * The producer, when not the certifier. 'VARIOUS' and
   * 'AVAILABLE UPON REQUEST' are both accepted values.
   */
  producer?: Party | 'VARIOUS' | 'AVAILABLE UPON REQUEST'
  /** For a blanket certification covering repeat shipments. */
  blanketPeriod?: { from: string; to: string }
  /** Who signs, and their title. */
  signatory?: { name: string; title: string }

  // ── Bill of lading ──
  carrier?: string
  /** Who pays the freight. */
  freightTerms?: 'prepaid' | 'collect' | 'third-party'
  /** Value declared to the carrier for liability. */
  declaredValue?: number
  specialInstructions?: string
}

// ═══════════════════════════════════════════════════════════════════════════
// Output shapes
// ═══════════════════════════════════════════════════════════════════════════

/** One rendered field: a label, a value, and where it belongs on the form. */
export interface DocField {
  /** Field label as the form prints it. */
  label: string
  value: string
  /** Form field number, for CI1's numbered boxes. */
  box?: number
}

export interface MissingField {
  label: string
  /**
   * `required` blocks the document. `recommended` is legal to omit but
   * commonly asked for, and its absence causes questions at the border.
   */
  severity: 'required' | 'recommended'
  why: string
}

export type DocKind = 'commercial-invoice' | 'canada-customs-invoice' | 'cusma-certificate' | 'packing-list' | 'bill-of-lading'

export interface BuiltDocument {
  kind: DocKind
  title: string
  fields: DocField[]
  /** Per-good rows, for the documents that itemize. */
  lines: Record<string, string>[]
  missing: MissingField[]
}

/** True when nothing required is missing — the gate before printing or sending. */
export function isReady(doc: BuiltDocument): boolean {
  return !doc.missing.some((m) => m.severity === 'required')
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

/** A party as a single address block. */
export function formatParty(p: Party): string {
  const region = [p.city, p.region, p.postalCode].filter(Boolean).join(', ')
  return [p.name, p.contactName, ...p.addressLines, region, p.country].filter(Boolean).join('\n')
}

const fmtMoney = (n: number, c: Currency): string =>
  `${n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c}`

const fmtNum = (n: number, dp = 2): string =>
  n.toLocaleString('en-CA', { minimumFractionDigits: 0, maximumFractionDigits: dp })

const packages = (ctx: DocContext): number => ctx.packageCount ?? ctx.packing.totalPallets

/** Incoterm plus its named place — 'FCA Grassy Lake, AB'. */
const terms = (ctx: DocContext): string =>
  [ctx.incoterm, ctx.incotermPlace].filter(Boolean).join(' ')

/**
 * Problems with the goods themselves, shared by every customs document.
 *
 * Split out because the same three gaps — no HS code, no origin, an item with
 * no shipping spec — sink all of them, and each document should report them in
 * its own `missing` list rather than the caller checking three times.
 */
function goodsProblems(ctx: DocContext, opts: { hsRequired: boolean }): MissingField[] {
  const out: MissingField[] = []

  const noHs = ctx.lines.filter((l) => !l.hsCode?.trim())
  if (noHs.length > 0) {
    out.push({
      label: `HS code (${noHs.length} line${noHs.length === 1 ? '' : 's'})`,
      severity: opts.hsRequired ? 'required' : 'recommended',
      why: `${noHs.map((l) => l.description).join(', ')} — customs classifies by HS code; without it the broker has to guess or the shipment waits.`,
    })
  }

  const noOrigin = ctx.lines.filter((l) => !l.countryOfOrigin?.trim())
  if (noOrigin.length > 0) {
    out.push({
      label: `Country of origin (${noOrigin.length} line${noOrigin.length === 1 ? '' : 's'})`,
      severity: 'required',
      why: `${noOrigin.map((l) => l.description).join(', ')} — origin sets the duty rate and is what a CUSMA claim rests on.`,
    })
  }

  if (ctx.packing.unspecced.length > 0) {
    out.push({
      label: 'Shipping specs',
      severity: 'required',
      why:
        `No weight or dimensions on file for ${ctx.packing.unspecced.map((u) => u.item).join(', ')}. ` +
        'The declared weight is understated, which is a misdeclaration.',
    })
  }

  return out
}

// ═══════════════════════════════════════════════════════════════════════════
// Commercial Invoice
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The general-purpose customs invoice, accepted by CBP and CBSA alike.
 *
 * When it carries all of CI1's fields 1–17, CBSA accepts it in place of the CI1
 * form itself (that's what CI1 field 18's checkbox is for), so this is usually
 * the only document a US-bound shipment needs.
 */
export function commercialInvoice(ctx: DocContext): BuiltDocument {
  const fields: DocField[] = [
    { label: 'Invoice number', value: ctx.invoiceNumber },
    { label: 'Invoice date', value: ctx.invoiceDate },
    { label: 'Shipper / Exporter', value: formatParty(ctx.exporter ?? ctx.vendor) },
    { label: 'Consignee', value: formatParty(ctx.consignee) },
    { label: 'Currency', value: ctx.currency },
    { label: 'Packages', value: `${packages(ctx)} ${ctx.packageKind ?? 'pallets'}` },
    { label: 'Net weight', value: `${fmtNum(ctx.packing.netWeightLbs)} lb (${fmtNum(ctx.packing.netWeightKg)} kg)` },
    { label: 'Gross weight', value: `${fmtNum(ctx.packing.grossWeightLbs)} lb (${fmtNum(ctx.packing.grossWeightKg)} kg)` },
    { label: 'Total value', value: fmtMoney(ctx.total, ctx.currency) },
  ]

  if (ctx.purchaser) fields.splice(4, 0, { label: 'Purchaser (if not consignee)', value: formatParty(ctx.purchaser) })
  if (ctx.purchaseOrder) fields.push({ label: 'Purchase order', value: ctx.purchaseOrder })
  if (terms(ctx)) fields.push({ label: 'Terms of sale (Incoterms 2020)', value: terms(ctx) })
  if (ctx.paymentTerms) fields.push({ label: 'Terms of payment', value: ctx.paymentTerms })
  if (ctx.reasonForExport) fields.push({ label: 'Reason for export', value: ctx.reasonForExport })
  if (ctx.transportMode) fields.push({ label: 'Mode of transport', value: ctx.transportMode })

  const lines = ctx.lines.map((l) => ({
    description: l.description,
    hsCode: l.hsCode ?? '',
    origin: l.countryOfOrigin ?? '',
    qty: `${fmtNum(l.qty)} ${l.unit}`,
    unitPrice: fmtMoney(l.unitPrice, ctx.currency),
    extended: fmtMoney(l.extended, ctx.currency),
  }))

  for (const c of ctx.charges) {
    lines.push({
      description: c.label,
      hsCode: '',
      origin: '',
      qty: '',
      unitPrice: '',
      extended: fmtMoney(c.amount, ctx.currency),
    })
  }

  const missing = goodsProblems(ctx, { hsRequired: true })
  if (!ctx.incoterm) {
    missing.push({
      label: 'Terms of sale',
      severity: 'recommended',
      why: 'Incoterms decide who pays duty and freight. Without one, the buyer and the broker will ask.',
    })
  }
  if (!ctx.reasonForExport) {
    missing.push({
      label: 'Reason for export',
      severity: 'recommended',
      why: 'Distinguishes a sale from a sample or a warranty replacement, which are valued differently.',
    })
  }
  if (!ctx.consignee.taxId) {
    missing.push({
      label: 'Consignee tax ID (EIN/BN)',
      severity: 'recommended',
      why: 'US customs entries are filed against the importer\'s EIN. Missing it can hold the shipment at the border.',
    })
  }

  return { kind: 'commercial-invoice', title: 'Commercial Invoice', fields, lines, missing }
}

// ═══════════════════════════════════════════════════════════════════════════
// Canada Customs Invoice (CBSA form CI1)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * CBSA's 25-field form, for goods entering Canada — TNT's tray shipments from
 * New Jersey rather than its outbound sales.
 *
 * Fields are emitted in the form's numbered order so the output maps box for
 * box onto the printed CI1.
 */
export function canadaCustomsInvoice(ctx: DocContext): BuiltDocument {
  const transportCharges = ctx.charges
    .filter((c) => c.isTransportToBorder)
    .reduce((s, c) => s + c.amount, 0)

  const fields: DocField[] = [
    { box: 1, label: 'Vendor (name and address)', value: formatParty(ctx.vendor) },
    { box: 2, label: 'Date of direct shipment to Canada', value: ctx.dateOfDirectShipment ?? '' },
    {
      box: 3,
      label: 'Other references',
      value: [ctx.purchaseOrder && `PO ${ctx.purchaseOrder}`, `Invoice ${ctx.invoiceNumber}`]
        .filter(Boolean)
        .join(' · '),
    },
    { box: 4, label: 'Consignee (name and address)', value: formatParty(ctx.consignee) },
    {
      box: 5,
      label: "Purchaser's name and address (if other than consignee)",
      value: ctx.purchaser ? formatParty(ctx.purchaser) : '',
    },
    { box: 6, label: 'Country of transhipment', value: ctx.countryOfTranshipment ?? '' },
    {
      box: 7,
      label: 'Country of origin of goods',
      value: [...new Set(ctx.lines.map((l) => l.countryOfOrigin).filter(Boolean))].join(', '),
    },
    {
      box: 8,
      label: 'Transportation: mode and place of direct shipment to Canada',
      value: [ctx.transportMode, ctx.placeOfDirectShipment].filter(Boolean).join(' — '),
    },
    { box: 9, label: 'Conditions of sale and terms of payment', value: [terms(ctx), ctx.paymentTerms].filter(Boolean).join(' · ') },
    { box: 10, label: 'Currency of settlement', value: ctx.currency },
    { box: 11, label: 'Number of packages', value: String(packages(ctx)) },
    {
      box: 16,
      label: 'Total weight',
      value: `Net ${fmtNum(ctx.packing.netWeightLbs)} lb · Gross ${fmtNum(ctx.packing.grossWeightLbs)} lb`,
    },
    { box: 17, label: 'Invoice total', value: fmtMoney(ctx.total, ctx.currency) },
    {
      box: 19,
      label: "Exporter's name and address (if other than vendor)",
      value: ctx.exporter ? formatParty(ctx.exporter) : '',
    },
    {
      box: 23,
      label: 'Transportation charges from the place of direct shipment to Canada',
      value: transportCharges > 0 ? fmtMoney(transportCharges, ctx.currency) : '',
    },
  ]

  // Boxes 12–15 are the itemized commodity table.
  const lines = ctx.lines.map((l) => ({
    specification: l.description, // box 12
    quantity: `${fmtNum(l.qty)} ${l.unit}`, // box 13
    unitPrice: fmtMoney(l.unitPrice, ctx.currency), // box 14
    total: fmtMoney(l.extended, ctx.currency), // box 15
    hsCode: l.hsCode ?? '',
    origin: l.countryOfOrigin ?? '',
  }))

  const missing = goodsProblems(ctx, { hsRequired: false })
  if (!ctx.dateOfDirectShipment) {
    missing.push({
      label: 'Date of direct shipment (box 2)',
      severity: 'required',
      why: 'CBSA uses it to set the exchange rate applied to the entry.',
    })
  }
  if (!ctx.placeOfDirectShipment) {
    missing.push({
      label: 'Place of direct shipment (box 8)',
      severity: 'required',
      why: 'Sets where transport charges start being dutiable — the split box 23 depends on.',
    })
  }
  if (!ctx.transportMode) {
    missing.push({ label: 'Mode of transport (box 8)', severity: 'required', why: 'Box 8 needs both mode and place.' })
  }
  if (!terms(ctx) && !ctx.paymentTerms) {
    missing.push({
      label: 'Conditions of sale and terms of payment (box 9)',
      severity: 'required',
      why: 'CBSA needs the sale terms to confirm the declared value is the transaction value.',
    })
  }

  return { kind: 'canada-customs-invoice', title: 'Canada Customs Invoice (CI1)', fields, lines, missing }
}

// ═══════════════════════════════════════════════════════════════════════════
// CUSMA / USMCA certification of origin
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The nine minimum data elements of a CUSMA certification of origin.
 *
 * There is no official form — the certification can live on the commercial
 * invoice or on its own sheet — but all nine elements must be present, along
 * with the prescribed certification statement.
 *
 * This claims duty-free treatment. An incorrect claim is a false statement to
 * customs, and the certifier is liable for it, so every element here is
 * required and none is inferred. In particular `originCriterion` is a
 * determination about how a good was produced; it must be supplied per line.
 */
export const CUSMA_CERTIFICATION_STATEMENT =
  'I certify that the goods described in this document qualify as originating and the information ' +
  'contained in this document is true and accurate. I assume responsibility for proving such ' +
  'representations and agree to maintain and present upon request or to make available during a ' +
  'verification visit, documentation necessary to support this certification.'

export function cusmaCertificate(ctx: DocContext): BuiltDocument {
  const certifier = ctx.certifier ?? ctx.vendor
  const producerValue =
    typeof ctx.producer === 'string' ? ctx.producer : ctx.producer ? formatParty(ctx.producer) : ''

  const fields: DocField[] = [
    { box: 1, label: 'Certifier role', value: ctx.certifierRole ? ctx.certifierRole.toUpperCase() : '' },
    { box: 2, label: 'Certifier', value: formatParty(certifier) },
    { box: 3, label: 'Exporter', value: formatParty(ctx.exporter ?? ctx.vendor) },
    { box: 4, label: 'Producer', value: producerValue },
    { box: 5, label: 'Importer', value: formatParty(ctx.consignee) },
    {
      box: 8,
      label: 'Blanket period',
      value: ctx.blanketPeriod ? `${ctx.blanketPeriod.from} to ${ctx.blanketPeriod.to}` : '',
    },
    { box: 9, label: 'Authorized signature', value: ctx.signatory ? `${ctx.signatory.name}, ${ctx.signatory.title}` : '' },
    { label: 'Certification statement', value: CUSMA_CERTIFICATION_STATEMENT },
  ]

  // Elements 6 and 7 are per-good.
  const lines = ctx.lines.map((l) => ({
    description: l.description,
    hsCode: l.hsCode ?? '',
    originCriterion: l.originCriterion ?? '',
    countryOfOrigin: l.countryOfOrigin ?? '',
  }))

  const missing: MissingField[] = []

  const noHs = ctx.lines.filter((l) => !l.hsCode?.trim())
  if (noHs.length > 0) {
    missing.push({
      label: `HS tariff classification (${noHs.length} line${noHs.length === 1 ? '' : 's'})`,
      severity: 'required',
      why: 'Data element 6 requires at least the 6-digit HS classification for every good certified.',
    })
  }

  const noCriterion = ctx.lines.filter((l) => !l.originCriterion)
  if (noCriterion.length > 0) {
    missing.push({
      label: `Origin criterion (${noCriterion.length} line${noCriterion.length === 1 ? '' : 's'})`,
      severity: 'required',
      why:
        `${noCriterion.map((l) => l.description).join(', ')} — data element 7. A, B, C or D is a determination ` +
        'about how the good was produced. Your broker sets it; it cannot be inferred from the invoice.',
    })
  }

  const nonNorthAmerican = ctx.lines.filter(
    (l) => l.countryOfOrigin && !['CA', 'US', 'MX'].includes(l.countryOfOrigin.toUpperCase()),
  )
  if (nonNorthAmerican.length > 0) {
    missing.push({
      label: 'Non-CUSMA origin on a certified line',
      severity: 'required',
      why:
        `${nonNorthAmerican.map((l) => `${l.description} (${l.countryOfOrigin})`).join(', ')} — ` +
        'goods originating outside Canada, the US or Mexico cannot be certified under CUSMA.',
    })
  }

  if (!ctx.certifierRole) {
    missing.push({
      label: 'Certifier role',
      severity: 'required',
      why: 'Data element 1 — the certification must state whether the certifier is the importer, exporter or producer.',
    })
  }
  if (!ctx.signatory) {
    missing.push({
      label: 'Authorized signature and title',
      severity: 'required',
      why: 'Data element 9. The signatory takes personal responsibility for the certification.',
    })
  }
  if (!producerValue) {
    missing.push({
      label: 'Producer',
      severity: 'required',
      why: 'Data element 4. Give the producer, or state "VARIOUS" or "AVAILABLE UPON REQUEST".',
    })
  }

  return { kind: 'cusma-certificate', title: 'CUSMA Certification of Origin', fields, lines, missing }
}

// ═══════════════════════════════════════════════════════════════════════════
// Packing list
// ═══════════════════════════════════════════════════════════════════════════

/**
 * What is physically in the shipment, pallet by pallet.
 *
 * Built straight off the packing result, so the weights here and the weights on
 * the customs paperwork come from one calculation and cannot disagree.
 */
export function packingList(ctx: DocContext): BuiltDocument {
  const fields: DocField[] = [
    { label: 'Packing list for invoice', value: ctx.invoiceNumber },
    { label: 'Date', value: ctx.invoiceDate },
    { label: 'Shipper', value: formatParty(ctx.exporter ?? ctx.vendor) },
    { label: 'Consignee', value: formatParty(ctx.consignee) },
    { label: 'Total packages', value: `${packages(ctx)} ${ctx.packageKind ?? 'pallets'}` },
    { label: 'Net weight', value: `${fmtNum(ctx.packing.netWeightLbs)} lb` },
    { label: 'Gross weight', value: `${fmtNum(ctx.packing.grossWeightLbs)} lb` },
    { label: 'Tallest pallet', value: `${fmtNum(ctx.packing.tallestPalletIn, 1)} in` },
  ]

  const lines = ctx.packing.lines.map((l) => ({
    item: l.item,
    qty: fmtNum(l.qty),
    pallets: String(l.pallets),
    perPallet: fmtNum(l.itemsPerPallet, 1),
    weightPerPallet: `${fmtNum(l.weightPerPalletLbs)} lb`,
    totalWeight: `${fmtNum(l.totalWeightLbs)} lb`,
    palletHeight: `${fmtNum(l.heightPerPalletIn, 1)} in`,
  }))

  const missing: MissingField[] = []
  if (ctx.packing.unspecced.length > 0) {
    missing.push({
      label: 'Items with no shipping spec',
      severity: 'required',
      why:
        `${ctx.packing.unspecced.map((u) => `${u.qty} × ${u.item}`).join(', ')} are on the order but not on ` +
        'this list, because nothing is on file for their weight or size.',
    })
  }
  if (ctx.packing.totalPallets === 0 && ctx.lines.length > 0) {
    missing.push({
      label: 'Nothing packed',
      severity: 'required',
      why: 'The order has lines but the packing plan is empty — no specs matched.',
    })
  }

  return { kind: 'packing-list', title: 'Packing List', fields, lines, missing }
}

// ═══════════════════════════════════════════════════════════════════════════
// Bill of lading
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A straight bill of lading — the contract of carriage the driver signs.
 *
 * Freight class is deliberately absent: NMFC classification depends on density,
 * stowability, handling and liability, and putting a guessed class on a BOL
 * gets the shipment reclassified and reweighed at the carrier's rate. Leave it
 * for the carrier or the broker to assign.
 */
export function billOfLading(ctx: DocContext): BuiltDocument {
  const fields: DocField[] = [
    { label: 'BOL reference', value: ctx.invoiceNumber },
    { label: 'Date', value: ctx.dateOfDirectShipment ?? ctx.invoiceDate },
    { label: 'Ship from', value: formatParty(ctx.exporter ?? ctx.vendor) },
    { label: 'Ship to', value: formatParty(ctx.consignee) },
    { label: 'Carrier', value: ctx.carrier ?? '' },
    { label: 'Freight terms', value: ctx.freightTerms ?? '' },
    { label: 'Total packages', value: `${packages(ctx)} ${ctx.packageKind ?? 'pallets'}` },
    { label: 'Gross weight', value: `${fmtNum(ctx.packing.grossWeightLbs)} lb` },
  ]

  if (ctx.declaredValue != null) {
    fields.push({ label: 'Declared value', value: fmtMoney(ctx.declaredValue, ctx.currency) })
  }
  if (ctx.specialInstructions) {
    fields.push({ label: 'Special instructions', value: ctx.specialInstructions })
  }

  const lines = ctx.packing.lines.map((l) => ({
    packages: String(l.pallets),
    kind: ctx.packageKind ?? 'Pallet',
    description: l.item,
    qty: fmtNum(l.qty),
    weight: `${fmtNum(l.totalWeightLbs)} lb`,
  }))

  const missing: MissingField[] = []
  if (!ctx.carrier) {
    missing.push({ label: 'Carrier', severity: 'required', why: 'A bill of lading is a contract with a named carrier.' })
  }
  if (!ctx.freightTerms) {
    missing.push({
      label: 'Freight terms',
      severity: 'required',
      why: 'Prepaid, collect or third-party decides who the carrier invoices.',
    })
  }
  if (ctx.packing.unspecced.length > 0) {
    missing.push({
      label: 'Understated weight',
      severity: 'required',
      why:
        `${ctx.packing.unspecced.map((u) => u.item).join(', ')} have no weight on file. Carriers reweigh, ` +
        'and a short-declared BOL gets reweigh charges.',
    })
  }

  return { kind: 'bill-of-lading', title: 'Bill of Lading', fields, lines, missing }
}

// ═══════════════════════════════════════════════════════════════════════════
// All of them
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build the documents a shipment actually needs.
 *
 * Two are conditional, because generating them unasked is worse than useless:
 *
 *  - The CI1 is CBSA's IMPORT form, so it only appears for goods entering
 *    Canada. On a US-bound sale it would be a confusing extra sheet.
 *  - The CUSMA certification only appears when `certifierRole` says someone
 *    intends to claim preferential treatment. A certification is a legal
 *    representation; nobody should find one in their packet by default.
 */
export function buildDocuments(ctx: DocContext): BuiltDocument[] {
  const docs: BuiltDocument[] = [commercialInvoice(ctx)]
  if (ctx.consignee.country.toUpperCase() === 'CA') docs.push(canadaCustomsInvoice(ctx))
  if (ctx.certifierRole) docs.push(cusmaCertificate(ctx))
  docs.push(packingList(ctx), billOfLading(ctx))
  return docs
}
