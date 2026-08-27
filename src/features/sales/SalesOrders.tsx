/**
 * Estimates and invoices — the list, and the builder behind it.
 *
 * One component serves both, because the only real differences are the
 * document number prefix and which actions are available. An estimate can be
 * converted; an invoice can be shipped.
 */
import { useMemo, useState } from 'react'
import { useData } from '@/data/context'
import { useSession } from '@/auth/session'
import type { OrderKind, SalesOrder, SalesOrderCharge, SalesOrderLine } from '@/data/types'
import { Badge, Button, EmptyState, InfoDot, Input, Modal, Select, Stat } from '@/components/ui'
import { BookUp, FileText, Package, Plus, Trash2, Truck } from 'lucide-react'
import { SalesChrome, fmtMoney, fmtNum } from './SalesChrome'
import { freightGapAdvice, lineFreightGap } from '@/domain/itemSpecs'
import { lineFromProduct, toItemSpec, useOrderComputed } from './useOrderPricing'
import { DocumentsModal } from './SalesDocuments'
import { NewCustomerModal } from './NewCustomerModal'

/** Sentinel value for the "add new customer" option — never a real customer id. */
const NEW_CUSTOMER = '__new_customer__'
import { callQboFn } from './QuickBooksHome'

const STATUS_TONE: Record<string, 'neutral' | 'green' | 'amber' | 'red'> = {
  draft: 'neutral',
  sent: 'amber',
  accepted: 'green',
  declined: 'red',
  invoiced: 'green',
  shipped: 'green',
  paid: 'green',
  void: 'red',
}

export function EstimatesHome() {
  return <OrdersScreen kind="estimate" />
}
export function InvoicesHome() {
  return <OrdersScreen kind="invoice" />
}

function OrdersScreen({ kind }: { kind: OrderKind }) {
  const { salesOrders, salesCustomers, createOrder } = useData()
  const s = useSession()
  const canEdit = s.can('sales', 'edit')
  const [openId, setOpenId] = useState<string | null>(null)

  const rows = useMemo(
    () => salesOrders.filter((o) => o.kind === kind),
    [salesOrders, kind],
  )
  const open = salesOrders.find((o) => o.id === openId)
  const label = kind === 'estimate' ? 'Estimate' : 'Invoice'

  const create = async () => {
    const r = await createOrder({ kind })
    if (r.ok && r.id) setOpenId(r.id)
  }

  return (
    <SalesChrome
      title={kind === 'estimate' ? 'Estimates' : 'Invoices'}
      subtitle={
        kind === 'estimate'
          ? 'Quote a job from the product catalogue — pricing, pallets and weight update as you build it'
          : 'Issued invoices, their shipping paperwork, and what they have reserved in stock'
      }
      actions={
        canEdit ? (
          <Button onClick={create}>
            <Plus size={16} /> New {label.toLowerCase()}
          </Button>
        ) : undefined
      }
    >
      {rows.length === 0 ? (
        <EmptyState>No {label.toLowerCase()}s yet.</EmptyState>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="th text-left">Number</th>
                <th className="th text-left">Customer</th>
                <th className="th text-left">Date</th>
                <th className="th text-right">Lines</th>
                <th className="th text-right">Total</th>
                <th className="th text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => {
                const c = salesCustomers.find((x) => x.id === o.customerId)
                const total =
                  o.lines.reduce((sum, l) => sum + l.extended, 0) +
                  o.charges.reduce((sum, ch) => sum + ch.amount, 0)
                return (
                  <tr
                    key={o.id}
                    className="cursor-pointer border-t border-subtle hover:bg-overlay"
                    onClick={() => setOpenId(o.id)}
                  >
                    <td className="px-3 py-2 font-medium text-primary">{o.number}</td>
                    <td className="px-3 py-2 text-secondary">{c?.company || c?.contactName || '—'}</td>
                    <td className="px-3 py-2 text-secondary tabular-nums">{o.issuedDate}</td>
                    <td className="px-3 py-2 text-right text-secondary tabular-nums">{o.lines.length}</td>
                    <td className="px-3 py-2 text-right text-primary tabular-nums">
                      {fmtMoney(total, o.currency)}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={STATUS_TONE[o.status] ?? 'neutral'}>{o.status}</Badge>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {open && <OrderEditor order={open} onClose={() => setOpenId(null)} />}
    </SalesChrome>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Editor
// ═══════════════════════════════════════════════════════════════════════════

function OrderEditor({ order, onClose }: { order: SalesOrder; onClose: () => void }) {
  const { products, salesCustomers, saveOrder, deleteOrder, convertEstimateToInvoice, markShipped } = useData()
  const s = useSession()
  const canEdit = s.can('sales', 'edit')
  const computed = useOrderComputed(order)
  const [showDocs, setShowDocs] = useState(false)
  const [addSku, setAddSku] = useState('')
  const [addQty, setAddQty] = useState('1')
  const [busy, setBusy] = useState('')
  const [addingCustomer, setAddingCustomer] = useState(false)

  const patch = (p: Partial<SalesOrder>) => void saveOrder(order.id, p)
  const setLines = (lines: SalesOrderLine[]) => void saveOrder(order.id, {}, lines)
  const setCharges = (charges: SalesOrderCharge[]) => void saveOrder(order.id, {}, undefined, charges)

  const addLine = () => {
    const p = products.find((x) => x.id === addSku)
    const qty = Number(addQty)
    if (!p || !Number.isFinite(qty) || qty <= 0) return
    // The order carries one currency; a product priced in another has to be
    // converted at a stated rate, which is a decision, not a default.
    if (order.lines.length === 0 && p.currency !== order.currency) patch({ currency: p.currency })
    const line = lineFromProduct(p, qty, order.lines.length)
    setLines([...order.lines, { ...line, id: `ln_${Date.now()}` }])
    setAddQty('1')
  }

  const removeLine = (id: string) => setLines(order.lines.filter((l) => l.id !== id))

  const convert = async () => {
    setBusy('convert')
    const r = await convertEstimateToInvoice(order.id)
    setBusy('')
    if (r.ok) onClose()
  }

  const ship = async () => {
    setBusy('ship')
    await markShipped(order.id, {
      palletCount: computed.packing.totalPallets,
      netWeightLbs: computed.packing.netWeightLbs,
      grossWeightLbs: computed.packing.grossWeightLbs,
    })
    setBusy('')
  }

  const mixedCurrency = order.lines.some((l) => {
    const p = products.find((x) => x.id === l.productId)
    return p && p.currency !== order.currency
  })

  return (
    <Modal title={`${order.number}`} onClose={onClose} wide>
      <div className="space-y-5">
        {/* ── Header ── */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className="label">Customer</span>
            <Select
              value={order.customerId ?? ''}
              onChange={(e) => {
                // The sentinel is an action, not a value — opening the modal
                // without patching leaves the select showing whatever was
                // chosen before, so cancelling changes nothing.
                if (e.target.value === NEW_CUSTOMER) return setAddingCustomer(true)
                patch({ customerId: e.target.value || null })
              }}
              disabled={!canEdit}
            >
              <option value="">— select —</option>
              {salesCustomers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.company || c.contactName} {c.country !== 'CA' ? `(${c.country})` : ''}
                </option>
              ))}
              {canEdit && <option value={NEW_CUSTOMER}>+ Add new customer…</option>}
            </Select>
          </label>
          <label className="block">
            <span className="label">Issued</span>
            <Input
              type="date"
              value={order.issuedDate}
              onChange={(e) => patch({ issuedDate: e.target.value })}
              disabled={!canEdit}
            />
          </label>
          <label className="block">
            <span className="label">PO number</span>
            <Input value={order.poNumber} onChange={(e) => patch({ poNumber: e.target.value })} disabled={!canEdit} />
          </label>
          <label className="block">
            <span className="label">Currency</span>
            <Select
              value={order.currency}
              onChange={(e) => patch({ currency: e.target.value as 'CAD' | 'USD' })}
              disabled={!canEdit}
            >
              <option value="CAD">CAD</option>
              <option value="USD">USD</option>
            </Select>
          </label>
        </div>

        {mixedCurrency && (
          <p className="rounded border border-warn/40 bg-warn/10 p-2 text-xs text-warn">
            A line's product is priced in a different currency than this order. Convert it at a stated rate
            before issuing — the totals below add the numbers as entered.
          </p>
        )}

        {/* ── Lines ── */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-muted">Lines</h3>
          </div>
          {order.lines.length === 0 ? (
            <p className="text-sm text-muted">No lines yet.</p>
          ) : (
            <div className="card overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="th text-left">Item</th>
                    <th className="th text-right">Qty</th>
                    <th className="th text-right">Unit</th>
                    <th className="th text-right">Extended</th>
                    <th className="th text-right">Margin</th>
                    {canEdit && <th className="th" />}
                  </tr>
                </thead>
                <tbody>
                  {order.lines.map((l) => {
                    const margin = l.extended - l.unitCost * l.qty
                    return (
                      <tr key={l.id} className="border-t border-subtle">
                        <td className="px-3 py-2 text-primary">
                          <div className="flex flex-wrap items-center gap-2">
                            {l.description}
                            {/*
                              Said HERE, on the line, at the moment somebody is
                              building the quote. The same fact reaches the
                              totals panel as a warning, but by then it is a
                              sentence about the order rather than a mark
                              against the line that caused it.
                            */}
                            <FreightGapMark line={l} />
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-secondary">
                          {fmtNum(l.qty)} {l.unit}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-secondary">
                          {fmtMoney(l.unitPrice, order.currency)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-primary">
                          {fmtMoney(l.extended, order.currency)}
                        </td>
                        <td
                          className={`px-3 py-2 text-right tabular-nums ${margin < 0 ? 'text-danger' : 'text-secondary'}`}
                        >
                          {fmtMoney(margin, order.currency)}
                        </td>
                        {canEdit && (
                          <td className="px-3 py-2 text-right">
                            <button
                              className="rounded p-1 text-faint hover:text-danger"
                              onClick={() => removeLine(l.id)}
                              title="Remove line"
                            >
                              <Trash2 size={15} />
                            </button>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {canEdit && (
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <label className="block min-w-48 flex-1">
                <span className="label">Add product</span>
                <Select value={addSku} onChange={(e) => setAddSku(e.target.value)}>
                  <option value="">— select —</option>
                  {products.filter((p) => p.active).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.currency}/{p.unit})
                    </option>
                  ))}
                </Select>
              </label>
              <label className="block w-28">
                <span className="label">Qty</span>
                <Input value={addQty} onChange={(e) => setAddQty(e.target.value)} inputMode="decimal" />
              </label>
              <Button variant="ghost" onClick={addLine} disabled={!addSku}>
                <Plus size={16} /> Add
              </Button>
            </div>
          )}
        </div>

        {/* ── Charges ── */}
        <ChargesEditor order={order} canEdit={canEdit} onChange={setCharges} />

        {/* ── Totals + packing ── */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Subtotal" value={fmtMoney(computed.totals.subtotal, order.currency)} />
          <Stat label="Total" value={fmtMoney(computed.totals.total, order.currency)} />
          <Stat
            label="Margin"
            value={fmtMoney(computed.totals.margin, order.currency)}
            hint={
              computed.totals.marginRate == null
                ? undefined
                : `${(computed.totals.marginRate * 100).toFixed(1)}%`
            }
          />
          <Stat
            label="Pallets / gross"
            value={`${computed.packing.totalPallets} · ${fmtNum(computed.packing.grossWeightLbs)} lb`}
          />
        </div>

        {/* ── Anything that makes this untrustworthy ── */}
        {(computed.packing.warnings.length > 0 || computed.warnings.length > 0) && (
          <div className="rounded border border-warn/40 bg-warn/10 p-3">
            <p className="mb-1 text-xs font-semibold text-warn">Check before sending</p>
            <ul className="list-disc space-y-0.5 pl-4 text-xs text-secondary">
              {[...computed.packing.warnings, ...new Set(computed.warnings)].map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        {/* ── Actions ── */}
        <div className="flex flex-wrap items-center gap-2 border-t border-subtle pt-4">
          <Button variant="ghost" onClick={() => setShowDocs(true)} disabled={order.lines.length === 0}>
            <FileText size={16} /> Paperwork
          </Button>
          {canEdit && <SendToQuickBooks order={order} />}
          {canEdit && order.kind === 'estimate' && (
            <Button onClick={convert} disabled={order.lines.length === 0 || busy === 'convert'}>
              <Package size={16} /> {busy === 'convert' ? 'Converting…' : 'Convert to invoice'}
            </Button>
          )}
          {canEdit && order.kind === 'invoice' && order.status !== 'shipped' && (
            <Button onClick={ship} disabled={order.lines.length === 0 || busy === 'ship'}>
              <Truck size={16} /> {busy === 'ship' ? 'Recording…' : 'Mark shipped'}
            </Button>
          )}
          <div className="flex-1" />
          {canEdit && (
            <Button
              variant="ghost"
              onClick={async () => {
                await deleteOrder(order.id)
                onClose()
              }}
            >
              <Trash2 size={16} /> Delete
            </Button>
          )}
        </div>
      </div>

      {showDocs && <DocumentsModal order={order} computed={computed} onClose={() => setShowDocs(false)} />}

      {addingCustomer && (
        <NewCustomerModal
          onClose={() => setAddingCustomer(false)}
          onCreated={(id) => {
            // Select it immediately, from the id the create returned. Looking
            // the new row up in `salesCustomers` instead would read the array
            // captured by this render, which does not have it yet.
            patch({ customerId: id })
            setAddingCustomer(false)
          }}
        />
      )}
    </Modal>
  )
}

function ChargesEditor({
  order,
  canEdit,
  onChange,
}: {
  order: SalesOrder
  canEdit: boolean
  onChange: (c: SalesOrderCharge[]) => void
}) {
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('')

  const add = () => {
    const n = Number(amount)
    if (!label.trim() || !Number.isFinite(n)) return
    onChange([
      ...order.charges,
      {
        id: `chg_${Date.now()}`,
        label: label.trim(),
        amount: n,
        passThrough: true,
        // Freight is the usual charge, and on a cross-border invoice CBSA needs
        // it broken out — defaulting this on saves the common case.
        isTransportToBorder: /freight|shipping|transport/i.test(label),
        sort: order.charges.length,
      },
    ])
    setLabel('')
    setAmount('')
  }

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-muted">Charges</h3>
      {order.charges.length > 0 && (
        <ul className="mb-2 space-y-1">
          {order.charges.map((c) => (
            <li key={c.id} className="flex items-center gap-2 text-sm">
              <span className="flex-1 text-secondary">
                {c.label}
                {c.passThrough && <span className="ml-2 text-xs text-faint">at cost</span>}
                {c.isTransportToBorder && <span className="ml-2 text-xs text-faint">· CI1 box 23</span>}
              </span>
              <span className="tabular-nums text-primary">{fmtMoney(c.amount, order.currency)}</span>
              {canEdit && (
                <button
                  className="rounded p-1 text-faint hover:text-danger"
                  onClick={() => onChange(order.charges.filter((x) => x.id !== c.id))}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block min-w-40 flex-1">
            <span className="label">Charge</span>
            {/* Not "Freight to border": most invoices never cross one. The
                CI1-box-23 flag below still detects freight from the wording. */}
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Freight" />
          </label>
          <label className="block w-32">
            <span className="label">Amount</span>
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
          </label>
          <Button variant="ghost" onClick={add} disabled={!label.trim()}>
            <Plus size={16} /> Add
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * Push one order to QuickBooks.
 *
 * The function syncs the customer and any unlinked products first — a
 * QuickBooks invoice references both by id — so this is one button, not three.
 * A second press UPDATES the QuickBooks record rather than creating a duplicate.
 */
/**
 * A line that will not appear on the freight documents, and why.
 *
 * Three different causes with three different fixes — the product never says
 * what it ships as, the item it names has never been measured, or the spec
 * exists but is unfinished — so the badge carries the specific one rather than
 * a general "check the shipping". See `lineFreightGap`.
 */
function FreightGapMark({ line }: { line: SalesOrderLine }) {
  const { itemSpecs } = useData()
  const specs = useMemo(() => itemSpecs.map(toItemSpec), [itemSpecs])
  const gap = lineFreightGap(line, specs)
  if (!gap) return null
  return (
    <span className="inline-flex items-center gap-1">
      <Badge tone="amber">No freight</Badge>
      <InfoDot note={{ title: 'Not in the pallet count', body: [freightGapAdvice(gap, line)] }} />
    </span>
  )
}


function SendToQuickBooks({ order }: { order: SalesOrder }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState('')

  const send = async () => {
    setState('sending')
    setError('')
    const r = await callQboFn('qbo-sync', { action: 'order', id: order.id })
    if (r.ok) {
      setState('sent')
    } else {
      setState('idle')
      setError(r.error ?? 'Push failed')
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button variant="ghost" onClick={send} disabled={state === 'sending' || order.lines.length === 0}>
        <BookUp size={16} />
        {state === 'sending' ? 'Sending…' : state === 'sent' ? 'Sent to QuickBooks' : 'Send to QuickBooks'}
      </Button>
      {error && <span className="max-w-xs text-xs text-danger">{error}</span>}
    </div>
  )
}
