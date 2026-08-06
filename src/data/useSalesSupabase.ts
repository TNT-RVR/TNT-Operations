/**
 * The sales slice, on Supabase. Pairs 1:1 with `useSalesMock`.
 *
 * Row mappers live here rather than in `mappers.ts` because this slice has a
 * dozen tables of its own and nothing else touches them.
 *
 * Two behaviours worth reading before changing anything:
 *
 *  - Stock is written as a MOVEMENT plus a level update, never a level update
 *    alone. `sales_stock_movements` is the audit trail that explains every
 *    count; a level that changed with no movement behind it is unexplainable.
 *  - `convertEstimateToInvoice` copies line prices verbatim. The customer
 *    accepted a number; re-pricing from the catalogue at conversion time would
 *    quietly bill them something else.
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import type { SalesResult, SalesSlice } from './context'
import type {
  InventoryLevel,
  ItemSpecRow,
  OrderKind,
  Product,
  ProductPart,
  ProductTier,
  SalesCustomer,
  SalesOrder,
  SalesOrderCharge,
  SalesOrderLine,
  Shipment,
  StockMovement,
  StockReason,
  Supplier,
} from './types'
import { supabase } from './supabaseClient'
import { nextOrderNumber } from './useSalesMock'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>

// ── Mappers ────────────────────────────────────────────────────────────────

const toPart = (r: Row): ProductPart => ({
  id: r.id,
  part: r.part ?? '',
  qty: Number(r.qty ?? 0),
  // null must survive: it means "not costed", which the UI flags. Number(null)
  // would turn it into a confident zero.
  unitCost: r.unit_cost == null ? null : Number(r.unit_cost),
  freightPerUnit: Number(r.freight_per_unit ?? 0),
  note: r.note ?? '',
  sort: Number(r.sort ?? 0),
})

const toTier = (r: Row): ProductTier => ({
  id: r.id,
  minQty: Number(r.min_qty ?? 0),
  unitCost: Number(r.unit_cost ?? 0),
})

const toProduct = (r: Row, parts: Row[], tiers: Row[]): Product => ({
  id: r.id,
  sku: r.sku,
  name: r.name ?? '',
  currency: r.currency === 'USD' ? 'USD' : 'CAD',
  unit: r.unit ?? 'each',
  labor: Number(r.labor ?? 0),
  markup: Number(r.markup ?? 0),
  roundTo: r.round_to == null ? null : Number(r.round_to),
  shipItem: r.ship_item ?? null,
  hsCode: r.hs_code ?? null,
  countryOfOrigin: r.country_of_origin ?? null,
  active: r.active !== false,
  notes: r.notes ?? '',
  parts: parts.filter((p) => p.product_id === r.id).map(toPart).sort((a, b) => a.sort - b.sort),
  tiers: tiers.filter((t) => t.product_id === r.id).map(toTier).sort((a, b) => a.minQty - b.minQty),
})

const toItemSpec = (r: Row): ItemSpecRow => ({
  id: r.id,
  item: r.item,
  weightLbs: Number(r.weight_lbs ?? 0),
  lengthIn: Number(r.length_in ?? 0),
  widthIn: Number(r.width_in ?? 0),
  heightIn: Number(r.height_in ?? 0),
  stackedHeightIn: Number(r.stacked_height_in ?? 0),
  maxItemsOnPallet: Number(r.max_items_on_pallet ?? 1),
  palletSize: r.pallet_size ?? '48x40',
  stacksPerPallet: Number(r.stacks_per_pallet ?? 1),
})

const toCustomer = (r: Row): SalesCustomer => ({
  id: r.id,
  company: r.company ?? '',
  contactName: r.contact_name ?? '',
  addressLines: r.address_lines ?? [],
  city: r.city ?? '',
  region: r.region ?? '',
  postalCode: r.postal_code ?? '',
  country: r.country ?? 'CA',
  taxId: r.tax_id ?? '',
  email: r.email ?? '',
  phone: r.phone ?? '',
  gpsLink: r.gps_link ?? '',
  notes: r.notes ?? '',
})

const toSupplier = (r: Row): Supplier => ({
  id: r.id,
  part: r.part ?? '',
  forItem: r.for_item ?? '',
  company: r.company ?? '',
  contactName: r.contact_name ?? '',
  email: r.email ?? '',
  phone: r.phone ?? '',
  website: r.website ?? '',
  notes: r.notes ?? '',
})

const toLine = (r: Row): SalesOrderLine => ({
  id: r.id,
  productId: r.product_id ?? null,
  description: r.description ?? '',
  qty: Number(r.qty ?? 0),
  unit: r.unit ?? 'each',
  unitPrice: Number(r.unit_price ?? 0),
  unitCost: Number(r.unit_cost ?? 0),
  extended: Number(r.extended ?? 0),
  hsCode: r.hs_code ?? null,
  countryOfOrigin: r.country_of_origin ?? null,
  originCriterion: r.origin_criterion ?? null,
  shipItem: r.ship_item ?? null,
  sort: Number(r.sort ?? 0),
})

const toCharge = (r: Row): SalesOrderCharge => ({
  id: r.id,
  label: r.label ?? '',
  amount: Number(r.amount ?? 0),
  passThrough: r.pass_through !== false,
  isTransportToBorder: r.is_transport_to_border === true,
  sort: Number(r.sort ?? 0),
})

const toOrder = (r: Row, lines: Row[], charges: Row[]): SalesOrder => ({
  id: r.id,
  number: r.number,
  kind: r.kind,
  status: r.status,
  fromEstimateId: r.from_estimate_id ?? null,
  customerId: r.customer_id ?? null,
  currency: r.currency === 'USD' ? 'USD' : 'CAD',
  fxRate: r.fx_rate == null ? null : Number(r.fx_rate),
  issuedDate: r.issued_date,
  dueDate: r.due_date ?? null,
  poNumber: r.po_number ?? '',
  incoterm: r.incoterm ?? null,
  incotermPlace: r.incoterm_place ?? '',
  paymentTerms: r.payment_terms ?? '',
  transportMode: r.transport_mode ?? null,
  placeOfDirectShipment: r.place_of_direct_shipment ?? '',
  countryOfTranshipment: r.country_of_transhipment ?? '',
  reasonForExport: r.reason_for_export ?? '',
  dateOfDirectShipment: r.date_of_direct_shipment ?? null,
  carrier: r.carrier ?? '',
  freightTerms: r.freight_terms ?? null,
  declaredValue: r.declared_value == null ? null : Number(r.declared_value),
  specialInstructions: r.special_instructions ?? '',
  certifierRole: r.certifier_role ?? null,
  producer: r.producer ?? '',
  signatoryName: r.signatory_name ?? '',
  signatoryTitle: r.signatory_title ?? '',
  notes: r.notes ?? '',
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  lines: lines.filter((l) => l.order_id === r.id).map(toLine).sort((a, b) => a.sort - b.sort),
  charges: charges.filter((c) => c.order_id === r.id).map(toCharge).sort((a, b) => a.sort - b.sort),
})

const toShipment = (r: Row): Shipment => ({
  id: r.id,
  orderId: r.order_id,
  shippedAt: r.shipped_at,
  carrier: r.carrier ?? '',
  tracking: r.tracking ?? '',
  palletCount: r.pallet_count == null ? null : Number(r.pallet_count),
  netWeightLbs: r.net_weight_lbs == null ? null : Number(r.net_weight_lbs),
  grossWeightLbs: r.gross_weight_lbs == null ? null : Number(r.gross_weight_lbs),
  notes: r.notes ?? '',
})

const toInventory = (r: Row): InventoryLevel => ({
  id: r.id,
  productId: r.product_id,
  onHand: Number(r.on_hand ?? 0),
  reserved: Number(r.reserved ?? 0),
  available: Number(r.available ?? 0),
  reorderPoint: r.reorder_point == null ? null : Number(r.reorder_point),
  location: r.location ?? '',
  updatedAt: r.updated_at,
})

const toMovement = (r: Row): StockMovement => ({
  id: r.id,
  productId: r.product_id,
  delta: Number(r.delta ?? 0),
  reason: r.reason,
  orderId: r.order_id ?? null,
  note: r.note ?? '',
  at: r.at,
})

/** Order header → row. Only the columns the UI can edit. */
const orderPatchToRow = (p: Partial<SalesOrder>): Row => {
  const r: Row = {}
  const set = (k: string, v: unknown) => { if (v !== undefined) r[k] = v }
  set('status', p.status)
  set('customer_id', p.customerId)
  set('currency', p.currency)
  set('fx_rate', p.fxRate)
  set('issued_date', p.issuedDate)
  set('due_date', p.dueDate)
  set('po_number', p.poNumber)
  set('incoterm', p.incoterm)
  set('incoterm_place', p.incotermPlace)
  set('payment_terms', p.paymentTerms)
  set('transport_mode', p.transportMode)
  set('place_of_direct_shipment', p.placeOfDirectShipment)
  set('country_of_transhipment', p.countryOfTranshipment)
  set('reason_for_export', p.reasonForExport)
  set('date_of_direct_shipment', p.dateOfDirectShipment)
  set('carrier', p.carrier)
  set('freight_terms', p.freightTerms)
  set('declared_value', p.declaredValue)
  set('special_instructions', p.specialInstructions)
  set('certifier_role', p.certifierRole)
  set('producer', p.producer)
  set('signatory_name', p.signatoryName)
  set('signatory_title', p.signatoryTitle)
  set('notes', p.notes)
  return r
}

const lineToRow = (orderId: string, l: SalesOrderLine, sort: number): Row => ({
  order_id: orderId,
  product_id: l.productId,
  description: l.description,
  qty: l.qty,
  unit: l.unit,
  unit_price: l.unitPrice,
  unit_cost: l.unitCost,
  extended: l.extended,
  hs_code: l.hsCode,
  country_of_origin: l.countryOfOrigin,
  origin_criterion: l.originCriterion,
  ship_item: l.shipItem,
  sort,
})

const chargeToRow = (orderId: string, c: SalesOrderCharge, sort: number): Row => ({
  order_id: orderId,
  label: c.label,
  amount: c.amount,
  pass_through: c.passThrough,
  is_transport_to_border: c.isTransportToBorder,
  sort,
})

// ── The slice ──────────────────────────────────────────────────────────────

export function useSalesSupabase(): SalesSlice {
  const [products, setProducts] = useState<Product[]>([])
  const [itemSpecs, setItemSpecs] = useState<ItemSpecRow[]>([])
  const [salesCustomers, setSalesCustomers] = useState<SalesCustomer[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>([])
  const [shipments, setShipments] = useState<Shipment[]>([])
  const [inventory, setInventory] = useState<InventoryLevel[]>([])
  const [stockMovements, setStockMovements] = useState<StockMovement[]>([])
  const [salesLoading, setSalesLoading] = useState(false)

  /** One-shot guard — every Sales tab calls loadSales() on mount. */
  const promiseRef = useRef<Promise<void> | null>(null)

  const loadSales = useCallback((): Promise<void> => {
    if (promiseRef.current) return promiseRef.current
    if (!supabase) return Promise.resolve()
    setSalesLoading(true)

    const run = (async () => {
      const sb = supabase!
      const [prod, parts, tiers, specs, cust, supp, ord, lines, charges, ship, inv, mv] = await Promise.all([
        sb.from('sales_products').select('*').order('name'),
        sb.from('sales_product_parts').select('*'),
        sb.from('sales_price_tiers').select('*'),
        sb.from('sales_item_specs').select('*').order('item'),
        sb.from('sales_customers').select('*').order('company'),
        sb.from('sales_suppliers').select('*').order('part'),
        sb.from('sales_orders').select('*').order('created_at', { ascending: false }),
        sb.from('sales_order_lines').select('*'),
        sb.from('sales_order_charges').select('*'),
        sb.from('sales_shipments').select('*').order('shipped_at', { ascending: false }),
        sb.from('sales_inventory').select('*'),
        sb.from('sales_stock_movements').select('*').order('at', { ascending: false }).limit(500),
      ])

      const err = [prod, parts, tiers, specs, cust, supp, ord, lines, charges, ship, inv, mv].find((r) => r.error)
      if (err?.error) {
        // Most likely cause by far: migration 0015 hasn't been run yet. Say so
        // rather than leaving an empty screen with no explanation.
        console.error('[data] loadSales:', err.error.message, '— has migration 0015_sales.sql been applied?')
        promiseRef.current = null // let it retry
        setSalesLoading(false)
        return
      }

      const partRows = (parts.data as Row[]) ?? []
      const tierRows = (tiers.data as Row[]) ?? []
      const lineRows = (lines.data as Row[]) ?? []
      const chargeRows = (charges.data as Row[]) ?? []

      setProducts(((prod.data as Row[]) ?? []).map((p) => toProduct(p, partRows, tierRows)))
      setItemSpecs(((specs.data as Row[]) ?? []).map(toItemSpec))
      setSalesCustomers(((cust.data as Row[]) ?? []).map(toCustomer))
      setSuppliers(((supp.data as Row[]) ?? []).map(toSupplier))
      setSalesOrders(((ord.data as Row[]) ?? []).map((o) => toOrder(o, lineRows, chargeRows)))
      setShipments(((ship.data as Row[]) ?? []).map(toShipment))
      setInventory(((inv.data as Row[]) ?? []).map(toInventory))
      setStockMovements(((mv.data as Row[]) ?? []).map(toMovement))
      setSalesLoading(false)
    })()

    promiseRef.current = run
    return run
  }, [])

  /** Re-read inventory + movements after a stock change. */
  const refreshStock = useCallback(async () => {
    if (!supabase) return
    const [inv, mv] = await Promise.all([
      supabase.from('sales_inventory').select('*'),
      supabase.from('sales_stock_movements').select('*').order('at', { ascending: false }).limit(500),
    ])
    if (!inv.error) setInventory(((inv.data as Row[]) ?? []).map(toInventory))
    if (!mv.error) setStockMovements(((mv.data as Row[]) ?? []).map(toMovement))
  }, [])

  /**
   * Write one stock change: a movement row for the audit trail, then the level.
   *
   * Not a transaction — PostgREST has no multi-statement call — so the movement
   * is written FIRST. If the level update then fails, the trail records an
   * intent that didn't land, which is recoverable. The reverse order would
   * leave a changed count with nothing explaining it.
   */
  const writeStock = useCallback(
    async (
      productId: string,
      changes: { onHand?: number; reserved?: number },
      reason: StockReason,
      note = '',
      orderId: string | null = null,
    ): Promise<SalesResult> => {
      if (!supabase) return { ok: false, error: 'Not connected' }
      const delta = changes.onHand ?? changes.reserved ?? 0

      if (delta !== 0) {
        const m = await supabase
          .from('sales_stock_movements')
          .insert({ product_id: productId, delta, reason, order_id: orderId, note })
        if (m.error) return { ok: false, error: m.error.message }
      }

      const cur = await supabase
        .from('sales_inventory')
        .select('on_hand, reserved')
        .eq('product_id', productId)
        .maybeSingle()
      if (cur.error) return { ok: false, error: cur.error.message }

      const onHand = Number(cur.data?.on_hand ?? 0) + (changes.onHand ?? 0)
      const reserved = Math.max(0, Number(cur.data?.reserved ?? 0) + (changes.reserved ?? 0))

      const up = await supabase
        .from('sales_inventory')
        .upsert({ product_id: productId, on_hand: onHand, reserved }, { onConflict: 'product_id' })
      if (up.error) return { ok: false, error: up.error.message }
      return { ok: true }
    },
    [],
  )

  const saveProduct = useCallback(async (id: string, patch: Partial<Product>): Promise<SalesResult> => {
    if (!supabase) return { ok: false, error: 'Not connected' }
    const row: Row = {}
    const set = (k: string, v: unknown) => { if (v !== undefined) row[k] = v }
    set('name', patch.name)
    set('currency', patch.currency)
    set('unit', patch.unit)
    set('labor', patch.labor)
    set('markup', patch.markup)
    set('round_to', patch.roundTo)
    set('ship_item', patch.shipItem)
    set('hs_code', patch.hsCode)
    set('country_of_origin', patch.countryOfOrigin)
    set('active', patch.active)
    set('notes', patch.notes)

    if (Object.keys(row).length) {
      const { error } = await supabase.from('sales_products').update(row).eq('id', id)
      if (error) return { ok: false, error: error.message }
    }

    // Parts replace wholesale — editing a BOM is a small, whole-list operation
    // and diffing it would be more code for no benefit.
    if (patch.parts) {
      await supabase.from('sales_product_parts').delete().eq('product_id', id)
      if (patch.parts.length) {
        const { error } = await supabase.from('sales_product_parts').insert(
          patch.parts.map((p, i) => ({
            product_id: id,
            part: p.part,
            qty: p.qty,
            unit_cost: p.unitCost,
            freight_per_unit: p.freightPerUnit,
            note: p.note,
            sort: i,
          })),
        )
        if (error) return { ok: false, error: error.message }
      }
    }

    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)))
    return { ok: true }
  }, [])

  const saveSalesCustomer = useCallback(async (id: string, patch: Partial<SalesCustomer>): Promise<SalesResult> => {
    if (!supabase) return { ok: false, error: 'Not connected' }
    const row: Row = {}
    const set = (k: string, v: unknown) => { if (v !== undefined) row[k] = v }
    set('company', patch.company)
    set('contact_name', patch.contactName)
    set('address_lines', patch.addressLines)
    set('city', patch.city)
    set('region', patch.region)
    set('postal_code', patch.postalCode)
    set('country', patch.country)
    set('tax_id', patch.taxId)
    set('email', patch.email)
    set('phone', patch.phone)
    set('gps_link', patch.gpsLink)
    set('notes', patch.notes)

    const { error } = await supabase.from('sales_customers').update(row).eq('id', id)
    if (error) return { ok: false, error: error.message }
    setSalesCustomers((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
    return { ok: true }
  }, [])

  const addSalesCustomer = useCallback(async (input: Partial<SalesCustomer>) => {
    if (!supabase) return { ok: false, error: 'Not connected' }
    const { data, error } = await supabase
      .from('sales_customers')
      .insert({
        company: input.company ?? '',
        contact_name: input.contactName ?? '',
        address_lines: input.addressLines ?? [],
        city: input.city ?? '',
        region: input.region ?? '',
        postal_code: input.postalCode ?? '',
        country: input.country ?? 'CA',
        tax_id: input.taxId ?? '',
        email: input.email ?? '',
        phone: input.phone ?? '',
        gps_link: input.gpsLink ?? '',
        notes: input.notes ?? '',
      })
      .select()
      .single()
    if (error) return { ok: false, error: error.message }
    setSalesCustomers((prev) => [toCustomer(data as Row), ...prev])
    return { ok: true, id: (data as Row).id }
  }, [])

  const createOrder = useCallback(
    async (input: Partial<SalesOrder> & { kind: OrderKind }) => {
      if (!supabase) return { ok: false, error: 'Not connected' }
      const number = input.number ?? nextOrderNumber(salesOrders, input.kind)
      const { data, error } = await supabase
        .from('sales_orders')
        .insert({ number, kind: input.kind, ...orderPatchToRow(input) })
        .select()
        .single()
      if (error) return { ok: false, error: error.message }
      setSalesOrders((prev) => [toOrder(data as Row, [], []), ...prev])
      return { ok: true, id: (data as Row).id }
    },
    [salesOrders],
  )

  const saveOrder = useCallback(
    async (
      id: string,
      patch: Partial<SalesOrder>,
      lines?: SalesOrderLine[],
      charges?: SalesOrderCharge[],
    ): Promise<SalesResult> => {
      if (!supabase) return { ok: false, error: 'Not connected' }
      const row = orderPatchToRow(patch)
      if (Object.keys(row).length) {
        const { error } = await supabase.from('sales_orders').update(row).eq('id', id)
        if (error) return { ok: false, error: error.message }
      }

      if (lines) {
        await supabase.from('sales_order_lines').delete().eq('order_id', id)
        if (lines.length) {
          const { error } = await supabase
            .from('sales_order_lines')
            .insert(lines.map((l, i) => lineToRow(id, l, i)))
          if (error) return { ok: false, error: error.message }
        }
      }
      if (charges) {
        await supabase.from('sales_order_charges').delete().eq('order_id', id)
        if (charges.length) {
          const { error } = await supabase
            .from('sales_order_charges')
            .insert(charges.map((c, i) => chargeToRow(id, c, i)))
          if (error) return { ok: false, error: error.message }
        }
      }

      setSalesOrders((prev) =>
        prev.map((o) =>
          o.id === id ? { ...o, ...patch, lines: lines ?? o.lines, charges: charges ?? o.charges } : o,
        ),
      )
      return { ok: true }
    },
    [],
  )

  const deleteOrder = useCallback(
    async (id: string): Promise<SalesResult> => {
      if (!supabase) return { ok: false, error: 'Not connected' }
      const order = salesOrders.find((o) => o.id === id)
      // Release the reservation first — deleting the order cascades its lines
      // away, and after that there is nothing left to tell us what to release.
      if (order?.kind === 'invoice' && order.status !== 'shipped' && order.status !== 'paid') {
        for (const l of order.lines) {
          if (l.productId) await writeStock(l.productId, { reserved: -l.qty }, 'release', `Order ${order.number} deleted`, id)
        }
      }
      const { error } = await supabase.from('sales_orders').delete().eq('id', id)
      if (error) return { ok: false, error: error.message }
      setSalesOrders((prev) => prev.filter((o) => o.id !== id))
      await refreshStock()
      return { ok: true }
    },
    [salesOrders, writeStock, refreshStock],
  )

  const convertEstimateToInvoice = useCallback(
    async (estimateId: string) => {
      if (!supabase) return { ok: false, error: 'Not connected' }
      const est = salesOrders.find((o) => o.id === estimateId)
      if (!est) return { ok: false, error: 'Estimate not found' }
      if (est.kind !== 'estimate') return { ok: false, error: 'That is already an invoice' }

      const number = nextOrderNumber(salesOrders, 'invoice')
      const { data, error } = await supabase
        .from('sales_orders')
        .insert({
          ...orderPatchToRow(est),
          number,
          kind: 'invoice',
          status: 'draft',
          from_estimate_id: est.id,
        })
        .select()
        .single()
      if (error) return { ok: false, error: error.message }
      const id = (data as Row).id

      // Prices copy across verbatim — see the module note.
      if (est.lines.length) {
        const { error: le } = await supabase
          .from('sales_order_lines')
          .insert(est.lines.map((l, i) => lineToRow(id, l, i)))
        if (le) return { ok: false, error: le.message }
      }
      if (est.charges.length) {
        await supabase.from('sales_order_charges').insert(est.charges.map((c, i) => chargeToRow(id, c, i)))
      }
      await supabase.from('sales_orders').update({ status: 'invoiced' }).eq('id', estimateId)

      for (const l of est.lines) {
        if (l.productId) await writeStock(l.productId, { reserved: l.qty }, 'reserve', `Invoice ${number}`, id)
      }

      const invoice = toOrder(data as Row, [], [])
      invoice.lines = est.lines.map((l) => ({ ...l }))
      invoice.charges = est.charges.map((c) => ({ ...c }))
      setSalesOrders((prev) => [
        invoice,
        ...prev.map((o) => (o.id === estimateId ? { ...o, status: 'invoiced' as const } : o)),
      ])
      await refreshStock()
      return { ok: true, id }
    },
    [salesOrders, writeStock, refreshStock],
  )

  const markShipped = useCallback(
    async (orderId: string, input: Parameters<SalesSlice['markShipped']>[1]): Promise<SalesResult> => {
      if (!supabase) return { ok: false, error: 'Not connected' }
      const order = salesOrders.find((o) => o.id === orderId)
      if (!order) return { ok: false, error: 'Order not found' }
      if (order.status === 'shipped') return { ok: false, error: 'Already marked shipped' }

      const { data, error } = await supabase
        .from('sales_shipments')
        .insert({
          order_id: orderId,
          carrier: input.carrier ?? order.carrier,
          tracking: input.tracking ?? '',
          pallet_count: input.palletCount ?? null,
          net_weight_lbs: input.netWeightLbs ?? null,
          gross_weight_lbs: input.grossWeightLbs ?? null,
          notes: input.notes ?? '',
        })
        .select()
        .single()
      if (error) return { ok: false, error: error.message }

      for (const l of order.lines) {
        if (!l.productId) continue
        await writeStock(l.productId, { onHand: -l.qty, reserved: -l.qty }, 'ship', `Shipped on ${order.number}`, orderId)
      }
      await supabase.from('sales_orders').update({ status: 'shipped' }).eq('id', orderId)

      setShipments((prev) => [toShipment(data as Row), ...prev])
      setSalesOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status: 'shipped' as const } : o)))
      await refreshStock()
      return { ok: true }
    },
    [salesOrders, writeStock, refreshStock],
  )

  const adjustStock = useCallback(
    async (input: { productId: string; delta: number; reason: StockReason; note?: string }): Promise<SalesResult> => {
      const r = await writeStock(input.productId, { onHand: input.delta }, input.reason, input.note ?? '')
      if (r.ok) await refreshStock()
      return r
    },
    [writeStock, refreshStock],
  )

  const setReorderPoint = useCallback(
    async (productId: string, reorderPoint: number | null): Promise<SalesResult> => {
      if (!supabase) return { ok: false, error: 'Not connected' }
      const { error } = await supabase
        .from('sales_inventory')
        .upsert({ product_id: productId, reorder_point: reorderPoint }, { onConflict: 'product_id' })
      if (error) return { ok: false, error: error.message }
      setInventory((prev) => prev.map((i) => (i.productId === productId ? { ...i, reorderPoint } : i)))
      return { ok: true }
    },
    [],
  )

  const saveItemSpec = useCallback(async (item: string, patch: Partial<ItemSpecRow>): Promise<SalesResult> => {
    if (!supabase) return { ok: false, error: 'Not connected' }
    const row: Row = { item }
    const set = (k: string, v: unknown) => { if (v !== undefined) row[k] = v }
    set('weight_lbs', patch.weightLbs)
    set('length_in', patch.lengthIn)
    set('width_in', patch.widthIn)
    set('height_in', patch.heightIn)
    set('stacked_height_in', patch.stackedHeightIn)
    set('max_items_on_pallet', patch.maxItemsOnPallet)
    set('pallet_size', patch.palletSize)
    set('stacks_per_pallet', patch.stacksPerPallet)

    const { data, error } = await supabase
      .from('sales_item_specs')
      .upsert(row, { onConflict: 'item' })
      .select()
      .single()
    if (error) return { ok: false, error: error.message }
    const saved = toItemSpec(data as Row)
    setItemSpecs((prev) => {
      const i = prev.findIndex((s) => s.item === item)
      if (i < 0) return [...prev, saved].sort((a, b) => a.item.localeCompare(b.item))
      const next = [...prev]
      next[i] = saved
      return next
    })
    return { ok: true }
  }, [])

  return useMemo<SalesSlice>(
    () => ({
      products,
      itemSpecs,
      salesCustomers,
      suppliers,
      salesOrders,
      shipments,
      inventory,
      stockMovements,
      salesLoading,
      loadSales,
      saveProduct,
      saveSalesCustomer,
      addSalesCustomer,
      createOrder,
      saveOrder,
      deleteOrder,
      convertEstimateToInvoice,
      markShipped,
      adjustStock,
      setReorderPoint,
      saveItemSpec,
    }),
    [
      products, itemSpecs, salesCustomers, suppliers, salesOrders, shipments, inventory,
      stockMovements, salesLoading, loadSales, saveProduct, saveSalesCustomer, addSalesCustomer,
      createOrder, saveOrder, deleteOrder, convertEstimateToInvoice, markShipped, adjustStock,
      setReorderPoint, saveItemSpec,
    ],
  )
}
