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
import type { ItemSpecRow, Product, SalesOrder, SalesOrderLine } from '@/data/types'
import {
  type LinePrice,
  type OrderCharge,
  type ProductSpec,
  orderTotals,
  priceLine,
  pricingWarnings,
} from '@/domain/pricing'
import { type ItemSpec, type PackLine, packShipment } from '@/domain/packing'
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
    sort,
  }
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
}

/** TNT as it appears on the paperwork. */
export const TNT_PARTY: Party = {
  name: 'TNT Pollination',
  addressLines: [],
  city: 'Grassy Lake',
  region: 'AB',
  country: 'CA',
}

export function useOrderComputed(order: SalesOrder | undefined): OrderComputed {
  const { products, itemSpecs, salesCustomers } = useData()

  return useMemo<OrderComputed>(() => {
    const empty: OrderComputed = {
      totals: orderTotals([]),
      packing: packShipment([]),
      warnings: [],
      documents: [],
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
    const packLines: PackLine[] = order.lines.map((l) => ({
      item: l.shipItem ?? l.description,
      qty: l.qty,
    }))
    const packing = packShipment(packLines, itemSpecs.map(toItemSpec), { palletTareLbs: 40 })

    for (const l of order.lines) {
      const p = products.find((x) => x.id === l.productId)
      if (p) warnings.push(...pricingWarnings(toProductSpec(p)).map((w) => `${p.name}: ${w.message}`))
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

    const ctx: DocContext = {
      invoiceNumber: order.number,
      invoiceDate: order.issuedDate,
      dateOfDirectShipment: order.dateOfDirectShipment ?? undefined,
      purchaseOrder: order.poNumber || undefined,
      vendor: TNT_PARTY,
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
      signatory: order.signatoryName
        ? { name: order.signatoryName, title: order.signatoryTitle }
        : undefined,
      carrier: order.carrier || undefined,
      freightTerms: order.freightTerms ?? undefined,
      declaredValue: order.declaredValue ?? undefined,
      specialInstructions: order.specialInstructions || undefined,
    }

    return { totals, packing, warnings, documents: buildDocuments(ctx) }
  }, [order, products, itemSpecs, salesCustomers])
}
