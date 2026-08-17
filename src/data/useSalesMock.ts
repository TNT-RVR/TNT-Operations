/**
 * The sales slice, on in-memory mock data. Pairs with `useSalesSupabase`.
 *
 * Everything here mirrors what migration 0015 does server-side, including the
 * parts that are easy to skip in a mock: stock reserves on invoice and commits
 * on shipment, every movement is journalled, and `available` is always derived
 * from `onHand − reserved` rather than tracked separately.
 *
 * Seeded from the same rows the migration seeds, so `npm run dev` shows the
 * real catalogue and the real customer list without a backend.
 */
import { useCallback, useMemo, useState } from 'react'
import type { SalesResult, SalesSlice } from './context'
import { seasonOf, type BeePurchase } from '@/domain/beePurchases'
import type {
  InventoryLevel,
  ItemSpecRow,
  OrderKind,
  Product,
  SalesCustomer,
  SalesOrder,
  SalesOrderCharge,
  SalesOrderLine,
  Shipment,
  StockMovement,
  StockReason,
  Supplier,
} from './types'
import {
  SEED_ITEM_SPECS,
  SEED_PRODUCTS,
  SEED_SALES_CUSTOMERS,
  SEED_SALES_ORDERS,
  SEED_SUPPLIERS,
  seedInventory,
} from './salesSeed'

let n = 0
const nextId = (p: string) => `${p}_${Date.now().toString(36)}${(n++).toString(36)}`
const nowIso = () => new Date().toISOString()

/**
 * Next document number for the year — `EST-2026-003`, `INV-2026-014`.
 *
 * Counts existing numbers of the same kind and year rather than keeping a
 * counter, so it can't drift out of step with the list it names.
 */
export function nextOrderNumber(orders: readonly SalesOrder[], kind: OrderKind, year = new Date().getFullYear()): string {
  const prefix = kind === 'estimate' ? 'EST' : 'INV'
  const stem = `${prefix}-${year}-`
  const used = orders
    .filter((o) => o.number.startsWith(stem))
    .map((o) => Number(o.number.slice(stem.length)))
    .filter(Number.isFinite)
  const next = (used.length ? Math.max(...used) : 0) + 1
  return `${stem}${String(next).padStart(3, '0')}`
}

export function useSalesMock(): SalesSlice {
  const [products, setProducts] = useState<Product[]>(SEED_PRODUCTS)
  const [itemSpecs, setItemSpecs] = useState<ItemSpecRow[]>(SEED_ITEM_SPECS)
  const [salesCustomers, setSalesCustomers] = useState<SalesCustomer[]>(SEED_SALES_CUSTOMERS)
  const [suppliers] = useState<Supplier[]>(SEED_SUPPLIERS)
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>(SEED_SALES_ORDERS)
  const [shipments, setShipments] = useState<Shipment[]>([])
  const [inventory, setInventory] = useState<InventoryLevel[]>(() => seedInventory(SEED_PRODUCTS))
  const [stockMovements, setStockMovements] = useState<StockMovement[]>([])

  /**
   * Three seasons of purchases, including one line with NO stated volume —
   * the case the totals have to surface rather than swallow. Without it the
   * mock would never exercise the interesting path.
   */
  const [beePurchases, setBeePurchases] = useState<BeePurchase[]>([
    { id: 'bp1', source: 'manual', qboId: null, date: '2024-02-12', vendor: 'Prairie Bee Co.',
      description: 'Leafcutter bees 400 gal', gallons: 400, amount: 15200, currency: 'CAD', season: 2024, notes: '' },
    { id: 'bp2', source: 'manual', qboId: null, date: '2025-01-20', vendor: 'Prairie Bee Co.',
      description: 'Leafcutter bees 450 gal', gallons: 450, amount: 18450, currency: 'CAD', season: 2025, notes: '' },
    { id: 'bp3', source: 'quickbooks', qboId: 'Bill:9001:1', date: '2025-12-18', vendor: 'Northern Pollination',
      description: 'Leafcutter bees 300 gal', gallons: 300, amount: 13200, currency: 'CAD', season: 2026, notes: '' },
    { id: 'bp4', source: 'quickbooks', qboId: 'Bill:9014:1', date: '2026-03-04', vendor: 'Prairie Bee Co.',
      description: 'Bee larvae — deposit', gallons: null, amount: 5000, currency: 'CAD', season: 2026, notes: '' },
  ])

  /**
   * Apply a signed change to a product's stock and journal it.
   *
   * `onHand` and `reserved` move independently — a reservation touches only
   * `reserved`, a shipment moves both — but `available` is recomputed from the
   * pair every time, never stored as its own truth.
   */
  const move = useCallback(
    (
      productId: string,
      changes: { onHand?: number; reserved?: number },
      reason: StockReason,
      note = '',
      orderId: string | null = null,
    ) => {
      setInventory((prev) => {
        const existing = prev.find((i) => i.productId === productId)
        const row: InventoryLevel = existing ?? {
          id: nextId('inv'),
          productId,
          onHand: 0,
          reserved: 0,
          available: 0,
          reorderPoint: null,
          location: '',
          updatedAt: nowIso(),
        }
        const onHand = row.onHand + (changes.onHand ?? 0)
        // Clamped: releasing more than was reserved is a bug, but a negative
        // reservation would corrupt every later `available` silently.
        const reserved = Math.max(0, row.reserved + (changes.reserved ?? 0))
        const next: InventoryLevel = { ...row, onHand, reserved, available: onHand - reserved, updatedAt: nowIso() }
        return existing ? prev.map((i) => (i.productId === productId ? next : i)) : [...prev, next]
      })

      const delta = changes.onHand ?? changes.reserved ?? 0
      if (delta !== 0) {
        setStockMovements((prev) => [
          { id: nextId('mv'), productId, delta, reason, orderId, note, at: nowIso() },
          ...prev,
        ])
      }
    },
    [],
  )

  const saveProduct = useCallback(async (id: string, patch: Partial<Product>): Promise<SalesResult> => {
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)))
    return { ok: true }
  }, [])

  const saveSalesCustomer = useCallback(async (id: string, patch: Partial<SalesCustomer>): Promise<SalesResult> => {
    setSalesCustomers((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
    return { ok: true }
  }, [])

  const addSalesCustomer = useCallback(async (input: Partial<SalesCustomer>) => {
    const id = nextId('cus')
    setSalesCustomers((prev) => [
      {
        id,
        company: '',
        contactName: '',
        addressLines: [],
        city: '',
        region: '',
        postalCode: '',
        country: 'CA',
        taxId: '',
        email: '',
        phone: '',
        gpsLink: '',
        notes: '',
        ...input,
      },
      ...prev,
    ])
    return { ok: true, id }
  }, [])

  const createOrder = useCallback(
    async (input: Partial<SalesOrder> & { kind: OrderKind }) => {
      const id = nextId('ord')
      setSalesOrders((prev) => [
        {
          number: input.number ?? nextOrderNumber(prev, input.kind),
          status: 'draft',
          fromEstimateId: null,
          customerId: null,
          currency: 'CAD',
          fxRate: null,
          issuedDate: new Date().toISOString().slice(0, 10),
          dueDate: null,
          poNumber: '',
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
          notes: '',
          createdAt: nowIso(),
          updatedAt: nowIso(),
          lines: [],
          charges: [],
          ...input,
          // After the spread: the caller supplies `kind`, but `id` is ours and
          // a caller-supplied one would break the reference we return.
          id,
        },
        ...prev,
      ])
      return { ok: true, id }
    },
    [],
  )

  const saveOrder = useCallback(
    async (
      id: string,
      patch: Partial<SalesOrder>,
      lines?: SalesOrderLine[],
      charges?: SalesOrderCharge[],
    ): Promise<SalesResult> => {
      setSalesOrders((prev) =>
        prev.map((o) =>
          o.id === id
            ? {
                ...o,
                ...patch,
                lines: lines ?? o.lines,
                charges: charges ?? o.charges,
                updatedAt: nowIso(),
              }
            : o,
        ),
      )
      return { ok: true }
    },
    [],
  )

  const deleteOrder = useCallback(
    async (id: string): Promise<SalesResult> => {
      // Release anything this order had spoken for, or the stock stays
      // reserved against a document that no longer exists.
      const order = salesOrders.find((o) => o.id === id)
      if (order?.kind === 'invoice' && order.status !== 'shipped' && order.status !== 'paid') {
        for (const l of order.lines) {
          if (l.productId) move(l.productId, { reserved: -l.qty }, 'release', `Order ${order.number} deleted`, id)
        }
      }
      setSalesOrders((prev) => prev.filter((o) => o.id !== id))
      return { ok: true }
    },
    [salesOrders, move],
  )

  const convertEstimateToInvoice = useCallback(
    async (estimateId: string) => {
      const est = salesOrders.find((o) => o.id === estimateId)
      if (!est) return { ok: false, error: 'Estimate not found' }
      if (est.kind !== 'estimate') return { ok: false, error: 'That is already an invoice' }

      const id = nextId('ord')
      const invoice: SalesOrder = {
        ...est,
        id,
        // Lines carry their quoted prices across untouched — the customer
        // accepted a number, so that is the number they get billed.
        lines: est.lines.map((l) => ({ ...l, id: nextId('ln') })),
        charges: est.charges.map((c) => ({ ...c, id: nextId('chg') })),
        number: nextOrderNumber(salesOrders, 'invoice'),
        kind: 'invoice',
        status: 'draft',
        fromEstimateId: est.id,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      }
      setSalesOrders((prev) => [invoice, ...prev.map((o) => (o.id === estimateId ? { ...o, status: 'invoiced' as const } : o))])

      for (const l of invoice.lines) {
        if (l.productId) move(l.productId, { reserved: l.qty }, 'reserve', `Invoice ${invoice.number}`, id)
      }
      return { ok: true, id }
    },
    [salesOrders, move],
  )

  const markShipped = useCallback(
    async (orderId: string, input: Parameters<SalesSlice['markShipped']>[1]): Promise<SalesResult> => {
      const order = salesOrders.find((o) => o.id === orderId)
      if (!order) return { ok: false, error: 'Order not found' }
      if (order.status === 'shipped') return { ok: false, error: 'Already marked shipped' }

      setShipments((prev) => [
        {
          id: nextId('shp'),
          orderId,
          shippedAt: nowIso(),
          carrier: input.carrier ?? order.carrier,
          tracking: input.tracking ?? '',
          palletCount: input.palletCount ?? null,
          netWeightLbs: input.netWeightLbs ?? null,
          grossWeightLbs: input.grossWeightLbs ?? null,
          notes: input.notes ?? '',
        },
        ...prev,
      ])

      // Commit: the reservation becomes a real draw-down.
      for (const l of order.lines) {
        if (!l.productId) continue
        move(l.productId, { onHand: -l.qty, reserved: -l.qty }, 'ship', `Shipped on ${order.number}`, orderId)
      }

      setSalesOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status: 'shipped', updatedAt: nowIso() } : o)))
      return { ok: true }
    },
    [salesOrders, move],
  )

  const adjustStock = useCallback(
    async (input: { productId: string; delta: number; reason: StockReason; note?: string }): Promise<SalesResult> => {
      move(input.productId, { onHand: input.delta }, input.reason, input.note ?? '')
      return { ok: true }
    },
    [move],
  )

  const setReorderPoint = useCallback(
    async (productId: string, reorderPoint: number | null): Promise<SalesResult> => {
      setInventory((prev) => prev.map((i) => (i.productId === productId ? { ...i, reorderPoint } : i)))
      return { ok: true }
    },
    [],
  )

  const saveItemSpec = useCallback(async (item: string, patch: Partial<ItemSpecRow>): Promise<SalesResult> => {
    setItemSpecs((prev) => {
      const existing = prev.find((s) => s.item === item)
      if (existing) return prev.map((s) => (s.item === item ? { ...s, ...patch } : s))
      return [
        ...prev,
        {
          id: nextId('spec'),
          item,
          weightLbs: 0,
          lengthIn: 0,
          widthIn: 0,
          heightIn: 0,
          stackedHeightIn: 0,
          maxItemsOnPallet: 1,
          palletSize: '48x40',
          stacksPerPallet: 1,
          ...patch,
        },
      ]
    })
    return { ok: true }
  }, [])

  const addBeePurchase = useCallback(async (input: Partial<BeePurchase>) => {
    const id = nextId('bp')
    const date = input.date ?? new Date().toISOString().slice(0, 10)
    setBeePurchases((prev) =>
      [
        {
          id,
          source: 'manual' as const,
          qboId: null,
          date,
          vendor: input.vendor ?? '',
          description: input.description ?? '',
          gallons: input.gallons ?? null,
          amount: input.amount ?? 0,
          currency: input.currency ?? 'CAD',
          season: input.season ?? seasonOf(date),
          notes: input.notes ?? '',
        },
        ...prev,
      ].sort((a, b) => b.date.localeCompare(a.date)),
    )
    return { ok: true, id }
  }, [])

  const saveBeePurchase = useCallback(async (id: string, patch: Partial<BeePurchase>): Promise<SalesResult> => {
    setBeePurchases((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)))
    return { ok: true }
  }, [])

  const deleteBeePurchase = useCallback(async (id: string): Promise<SalesResult> => {
    setBeePurchases((prev) => prev.filter((b) => b.id !== id))
    return { ok: true }
  }, [])

  /** No QuickBooks in mock mode — say so rather than pretending it worked. */
  const syncBeePurchases = useCallback(async () => ({ ok: false, error: 'QuickBooks is not available on mock data.' }), [])

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
      salesLoading: false,
      // Mock holds everything already — nothing to fetch.
      loadSales: async () => {},
      beePurchases,
      addBeePurchase,
      saveBeePurchase,
      deleteBeePurchase,
      syncBeePurchases,
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
      products,
      itemSpecs,
      salesCustomers,
      suppliers,
      salesOrders,
      shipments,
      inventory,
      stockMovements,
      beePurchases,
      addBeePurchase,
      saveBeePurchase,
      deleteBeePurchase,
      syncBeePurchases,
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
    ],
  )
}
