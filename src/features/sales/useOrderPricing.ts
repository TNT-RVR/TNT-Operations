/**
 * Turns an order's stored lines into live pricing, packing and paperwork.
 *
 * This is the join between the three domain modules and the screen: it knows
 * how a `SalesOrderLine` maps onto a `ProductSpec`, a `PackLine` and a
 * `DocLine`, and nothing else does.
 *
 * The one subtlety worth knowing: a SAVED line carries the price it was quoted
 * at, and that is what gets billed. `livePricing` re-derives what the same line
 * WOULD cost from today's catalogue, purely so the editor can show the drift
 * ("costed at $179.34, catalogue now says $186.20"). It never overwrites the
 * stored figure — see the snapshot rule in migration 0015.
 */
import { useMemo } from 'react'
import { useData } from '@/data/context'
import type {
  CompanyDetails,
  ItemSpecRow,
  Product,
  SalesCustomer,
  SalesOrder,
  SalesOrderLine,
} from '@/data/types'
import {
  type LinePrice,
  type OrderCharge,
  type ProductSpec,
  orderTotals,
  priceLine,
  pricingWarnings,
} from '@/domain/pricing'
import { type ItemSpec, type PackLine, type PackedShipment, packShipment } from '@/domain/packing'
import { freightGapAdvice, lineFreightGap } from '@/domain/itemSpecs'
import {
  EMPTY_LOGISTICS,
  type FreightQuote,
  type QuoteLogistics,
  type QuoteParty,
  buildFreightQuote,
} from '@/domain/freightQuote'
import { type DocContext, type DocLine, type Party, buildDocuments } from '@/domain/salesDocs'

/** A catalogue `Product` as the pricing engine wants it. */
export function toProductSpec(p: Product): ProductSpec {
  return {
    sku: p.sku,
    name: p.name,
    currency: p.currency,
    bom: p.parts.map((part) => ({
      part: part.part,
      qty: part.qty,
      unitCost: part.unitCost,
      freightPerUnit: part.freightPerUnit,
      note: part.note || undefined,
    })),
    labor: p.labor,
    markup: p.markup,
    roundTo: p.roundTo,
    tiers: p.tiers.map((t) => ({ minQty: t.minQty, unitCost: t.unitCost })),
    unit: p.unit,
  }
}

export const toItemSpec = (s: ItemSpecRow): ItemSpec => ({
  item: s.item,
  weightLbs: s.weightLbs,
  lengthIn: s.lengthIn,
  widthIn: s.widthIn,
  heightIn: s.heightIn,
  stackedHeightIn: s.stackedHeightIn,
  maxItemsOnPallet: s.maxItemsOnPallet,
  palletSize: s.palletSize,
  stacksPerPallet: s.stacksPerPallet,
})

/**
 * Price a catalogue product at a quantity — what the editor calls when a line
 * is added or its quantity changes.
 */
export function quoteLine(product: Product, qty: number): LinePrice {
  return priceLine(toProductSpec(product), qty)
}

/** Build the order line a quote produces, with its price frozen in. */
export function lineFromProduct(product: Product, qty: number, sort: number): Omit<SalesOrderLine, 'id'> {
  const priced = quoteLine(product, qty)
  return {
    productId: product.id,
    description: product.name,
    qty,
    unit: product.unit,
    unitPrice: priced.price,
    unitCost: priced.unitCost,
    extended: priced.extended,
    hsCode: product.hsCode,
    countryOfOrigin: product.countryOfOrigin,
    originCriterion: null,
    shipItem: product.shipItem,
    // Left unset on purpose: null means "whatever the load works out to", which
    // keeps following the load if it is packed differently. The item's own
    // settled class, if it has one, is applied when the quote is built.
    freightClass: null,
    nmfc: '',
    sort,
  }
}

/** What an order with nothing on it quotes as. */
const EMPTY_QUOTE: FreightQuote = {
  shipper: toQuoteParty({ name: '' }),
  consignee: toQuoteParty({ name: '' }),
  logistics: EMPTY_LOGISTICS,
  incoterm: '',
  freight: [],
  commercial: [],
  totals: { units: 0, weightLbs: 0, value: 0 },
  blockers: [],
}

export interface OrderComputed {
  /** Totals from the STORED line prices — what the customer is billed. */
  totals: ReturnType<typeof orderTotals>
  /** Pallets, weights, and anything with no shipping spec on file. */
  packing: ReturnType<typeof packShipment>
  /** Problems with the underlying product costing. */
  warnings: string[]
  /** The four documents, each reporting its own missing fields. */
  documents: ReturnType<typeof buildDocuments>
  /**
   * The freight quote — the same numbers the bill of lading prints, built once
   * so the two documents cannot disagree about what is on the truck.
   */
  quote: FreightQuote
}

/**
 * The vendor block, from the company record.
 *
 * This used to be a hardcoded constant, which meant the vendor printed on every
 * commercial invoice and CUSMA certification could not be corrected without a
 * deploy. It now comes from Users & Settings → Company.
 */
/**
 * The same two parties again, in the shape the freight forms want.
 *
 * The customs documents and the freight forms describe a party differently —
 * customs wants a country code and a tax number, a carrier wants a phone number
 * and someone to call. Rather than widen one type to satisfy both, each gets
 * its own mapper off the same record, so there is still one place a name or an
 * address is kept.
 */
export function toQuoteParty(p: {
  name: string
  addressLines?: string[]
  city?: string
  region?: string
  postalCode?: string
  contactName?: string
  phone?: string
  email?: string
}): QuoteParty {
  const city = [p.city, p.region].filter(Boolean).join(', ')
  return {
    company: p.name,
    address: (p.addressLines ?? []).join(', '),
    cityRegion: city,
    postalCode: p.postalCode ?? '',
    contactName: p.contactName ?? '',
    contactPhone: p.phone ?? '',
    contactEmail: p.email ?? '',
  }
}

export function companyParty(c: CompanyDetails): Party {
  return {
    name: c.legalName || 'TNT Pollination',
    addressLines: c.addressLines ?? [],
    city: c.city,
    region: c.region,
    postalCode: c.postalCode || undefined,
    country: c.country || 'CA',
    taxId: c.businessNumber || undefined,
    email: c.email || undefined,
    phone: c.phone || undefined,
  }
}

/**
 * The freight quote for an order.
 *
 * Split out of `useOrderComputed` because the quote SCREEN has to be able to
 * recompute it from unsaved edits. Stacks per pallet is the reason: change it
 * from four to two and the pallet doubles in height, the density halves and the
 * class jumps — and a form where you answer a question and nothing moves until
 * you press Save is a form that looks broken.
 *
 * So the screen passes its in-progress answers, and the documents pass the
 * saved ones. Same function, so the two cannot drift apart in what they mean by
 * a pallet.
 *
 * Class comes from the line's own override, or failing that from the class
 * settled on the item — a product a carrier has already classed should not have
 * to be re-typed onto every shipment.
 */
export function buildOrderQuote(input: {
  order: SalesOrder
  logistics: QuoteLogistics
  lines: SalesOrderLine[]
  packing: PackedShipment
  itemSpecs: ItemSpecRow[]
  company: CompanyDetails
  customer: SalesCustomer | undefined
}): FreightQuote {
  const { order, logistics, lines, packing, itemSpecs, company, customer } = input
  const specByItem = new Map(itemSpecs.map((s) => [s.item, s]))
  return buildFreightQuote({
    shipper: toQuoteParty({
      name: company.legalName || 'TNT Pollination',
      addressLines: company.addressLines,
      city: company.city,
      region: company.region,
      postalCode: company.postalCode,
      contactName: company.signatoryName,
      phone: company.phone,
      email: company.email,
    }),
    consignee: customer
      ? toQuoteParty({
          name: customer.company || customer.contactName,
          addressLines: customer.addressLines,
          city: customer.city,
          region: customer.region,
          postalCode: customer.postalCode,
          contactName: customer.contactName,
          phone: customer.phone,
          email: customer.email,
        })
      : toQuoteParty({ name: '' }),
    incoterm: order.incoterm ?? '',
    currency: order.currency,
    logistics,
    packing,
    lines: lines.map((l) => {
      const item = l.shipItem ?? l.description
      const spec = specByItem.get(item)
      return {
        item,
        description: l.description,
        qty: l.qty,
        hsCode: l.hsCode ?? '',
        origin: l.countryOfOrigin ?? '',
        unitValue: l.unitPrice,
        freightClass: l.freightClass ?? spec?.freightClass ?? null,
        nmfc: l.nmfc || spec?.nmfc || '',
      }
    }),
  })
}

/**
 * The pallet plan for a set of lines, honouring this shipment's stacking.
 *
 * Also shared with the quote screen, for the same reason: the height on the
 * form has to answer to the stacks box beside it.
 */
export function packOrderLines(
  lines: SalesOrderLine[],
  logistics: QuoteLogistics,
  itemSpecs: ItemSpecRow[],
): PackedShipment {
  const packLines: PackLine[] = lines.map((l) => ({
    item: l.shipItem ?? l.description,
    qty: l.qty,
    // How high it is stacked on THIS shipment, when someone has said. It sets
    // the pallet height, which sets the density, which sets the class.
    stacksPerPallet: logistics.perItem?.[l.shipItem ?? l.description]?.stacksPerPallet,
  }))
  return packShipment(packLines, itemSpecs.map(toItemSpec), { palletTareLbs: 40 })
}

export function useOrderComputed(order: SalesOrder | undefined): OrderComputed {
  const { products, itemSpecs, salesCustomers, company } = useData()

  return useMemo<OrderComputed>(() => {
    const empty: OrderComputed = {
      totals: orderTotals([]),
      packing: packShipment([]),
      warnings: [],
      documents: [],
      quote: EMPTY_QUOTE,
    }
    if (!order) return empty

    // Totals come from the STORED prices, so an invoice always reconciles with
    // the figures printed on it.
    const priced: LinePrice[] = order.lines.map((l) => ({
      materials: 0,
      labor: 0,
      buildCost: l.unitCost,
      overhead: 0,
      unitCost: l.unitCost,
      markupAmount: l.unitPrice - l.unitCost,
      exactPrice: l.unitPrice,
      price: l.unitPrice,
      currency: order.currency,
      qty: l.qty,
      extended: l.extended,
      extendedCost: l.unitCost * l.qty,
      margin: l.extended - l.unitCost * l.qty,
      marginRate: l.extended === 0 ? null : (l.extended - l.unitCost * l.qty) / l.extended,
    }))

    const charges: OrderCharge[] = order.charges.map((c) => ({
      label: c.label,
      amount: c.amount,
      passThrough: c.passThrough,
    }))

    let totals = orderTotals([])
    const warnings: string[] = []
    try {
      totals = orderTotals(priced, charges)
    } catch (e) {
      // Mixed currencies. Surfaced rather than swallowed — a wrong total on a
      // customs document is a customs problem.
      warnings.push(e instanceof Error ? e.message : String(e))
    }

    // Only lines with a shipping item can be packed; the rest are reported by
    // packShipment as unspecced so nothing goes missing quietly.
    const logistics = order.shippingLogistics ?? EMPTY_LOGISTICS
    const specs = itemSpecs.map(toItemSpec)
    const packing = packOrderLines(order.lines, logistics, itemSpecs)

    for (const l of order.lines) {
      const p = products.find((x) => x.id === l.productId)
      if (p) warnings.push(...pricingWarnings(toProductSpec(p)).map((w) => `${p.name}: ${w.message}`))

      /*
       * Name the real cause. `packShipment` reports every gap as a missing
       * SPEC, because by the time it runs the line is just an item name — the
       * fallback to the description has already happened. That sends whoever
       * reads it off to write a spec for "Bee Shelter", a name that was never
       * meant to be one, when the actual fix is on the product.
       */
      const gap = lineFreightGap(l, specs)
      if (gap) warnings.push(freightGapAdvice(gap, l))
    }

    const customer = salesCustomers.find((c) => c.id === order.customerId)
    const docLines: DocLine[] = order.lines.map((l) => ({
      description: l.description,
      hsCode: l.hsCode ?? undefined,
      countryOfOrigin: l.countryOfOrigin ?? undefined,
      qty: l.qty,
      unit: l.unit,
      unitPrice: l.unitPrice,
      extended: l.extended,
      originCriterion: l.originCriterion ?? undefined,
    }))

    const quote = buildOrderQuote({
      order,
      logistics,
      lines: order.lines,
      packing,
      itemSpecs,
      company,
      customer,
    })

    const ctx: DocContext = {
      invoiceNumber: order.number,
      invoiceDate: order.issuedDate,
      dateOfDirectShipment: order.dateOfDirectShipment ?? undefined,
      purchaseOrder: order.poNumber || undefined,
      vendor: companyParty(company),
      consignee: customer
        ? {
            name: customer.company || customer.contactName,
            contactName: customer.company ? customer.contactName : undefined,
            addressLines: customer.addressLines,
            city: customer.city,
            region: customer.region,
            postalCode: customer.postalCode,
            country: customer.country,
            taxId: customer.taxId || undefined,
            email: customer.email || undefined,
            phone: customer.phone || undefined,
          }
        : { name: '(no customer selected)', addressLines: [], country: '' },
      currency: order.currency,
      incoterm: order.incoterm ?? undefined,
      incotermPlace: order.incotermPlace || undefined,
      paymentTerms: order.paymentTerms || undefined,
      lines: docLines,
      charges: order.charges.map((c) => ({
        label: c.label,
        amount: c.amount,
        isTransportToBorder: c.isTransportToBorder,
      })),
      total: totals.total,
      packing,
      packageKind: 'pallets',
      transportMode: order.transportMode ?? undefined,
      placeOfDirectShipment: order.placeOfDirectShipment || undefined,
      countryOfTranshipment: order.countryOfTranshipment || undefined,
      reasonForExport: order.reasonForExport || undefined,
      certifierRole: order.certifierRole ?? undefined,
      // The schema stores producer as free text, but the certification only
      // accepts a party or one of two exact phrases. Anything else is passed
      // through as a named party so salesDocs can still validate it.
      producer:
        order.producer === 'VARIOUS' || order.producer === 'AVAILABLE UPON REQUEST'
          ? order.producer
          : order.producer
            ? { name: order.producer, addressLines: [], country: 'CA' }
            : undefined,
      // The order may name its own signatory; otherwise fall back to the
      // company default so it is set once rather than on every document.
      signatory: (order.signatoryName || company.signatoryName)
        ? {
            name: order.signatoryName || company.signatoryName,
            title: order.signatoryTitle || company.signatoryTitle,
          }
        : undefined,
      carrier: order.carrier || undefined,
      freightTerms: order.freightTerms ?? undefined,
      declaredValue: order.declaredValue ?? undefined,
      specialInstructions: order.specialInstructions || undefined,
      // The BOL prints a class only because there is a real one here to print.
      freight: quote.freight,
    }

    return { totals, packing, warnings, documents: buildDocuments(ctx), quote }
  }, [order, products, itemSpecs, salesCustomers, company])
}
