/**
 * Finished-goods stock: what's on hand, what's spoken for, and what can still
 * be promised.
 *
 * `available` is the number that matters and it is never stored — it comes from
 * `onHand − reserved`, computed in the database. A row showing 620 on hand and
 * 500 reserved can only promise 120, and quoting off the 620 is how you sell
 * the same trays twice.
 */
import { useState } from 'react'
import { useData } from '@/data/context'
import { useSession } from '@/auth/session'
import { Badge, Button, EmptyState, Input, Modal } from '@/components/ui'
import { History, Plus } from 'lucide-react'
import type { Product } from '@/data/types'
import { SalesChrome, fmtNum } from './SalesChrome'

export function InventoryHome() {
  const { products, inventory, stockMovements, adjustStock, setReorderPoint } = useData()
  const s = useSession()
  const canEdit = s.can('sales', 'edit')
  const [adjusting, setAdjusting] = useState<Product | null>(null)
  const [historyFor, setHistoryFor] = useState<Product | null>(null)

  const rows = products
    .filter((p) => p.active)
    .map((p) => ({ product: p, level: inventory.find((i) => i.productId === p.id) }))

  return (
    <SalesChrome
      title="Inventory"
      subtitle="Finished goods. Invoicing reserves stock; marking a shipment draws it down."
    >
      {rows.length === 0 ? (
        <EmptyState>No products in the catalogue yet.</EmptyState>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="th text-left">Product</th>
                <th className="th text-right">On hand</th>
                <th className="th text-right">Reserved</th>
                <th className="th text-right">Available</th>
                <th className="th text-right">Reorder at</th>
                <th className="th text-left">Status</th>
                {canEdit && <th className="th" />}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ product, level }) => {
                const available = level?.available ?? 0
                const low = level?.reorderPoint != null && available < level.reorderPoint
                return (
                  <tr key={product.id} className="border-t border-subtle">
                    <td className="px-3 py-2">
                      <div className="font-medium text-primary">{product.name}</div>
                      <div className="text-xs text-faint">{product.sku}</div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-secondary">
                      {fmtNum(level?.onHand ?? 0)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-secondary">
                      {fmtNum(level?.reserved ?? 0)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums font-medium ${
                        available <= 0 ? 'text-danger' : low ? 'text-warn' : 'text-primary'
                      }`}
                    >
                      {fmtNum(available)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {canEdit ? (
                        <Input
                          className="w-24 text-right"
                          value={level?.reorderPoint ?? ''}
                          placeholder="—"
                          inputMode="numeric"
                          onChange={(e) => {
                            const v = e.target.value.trim()
                            void setReorderPoint(product.id, v === '' ? null : Number(v))
                          }}
                        />
                      ) : (
                        <span className="tabular-nums text-secondary">
                          {level?.reorderPoint ?? '—'}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {available <= 0 ? (
                        <Badge tone="red">Out</Badge>
                      ) : low ? (
                        <Badge tone="amber">Low</Badge>
                      ) : (
                        <Badge tone="green">OK</Badge>
                      )}
                    </td>
                    {canEdit && (
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-1">
                          <button
                            className="rounded p-1 text-faint hover:text-secondary"
                            title="Movement history"
                            onClick={() => setHistoryFor(product)}
                          >
                            <History size={15} />
                          </button>
                          <Button variant="ghost" onClick={() => setAdjusting(product)}>
                            Adjust
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {adjusting && (
        <AdjustModal
          product={adjusting}
          onClose={() => setAdjusting(null)}
          onSubmit={async (delta, reason, note) => {
            await adjustStock({ productId: adjusting.id, delta, reason, note })
            setAdjusting(null)
          }}
        />
      )}

      {historyFor && (
        <Modal title={`Stock history — ${historyFor.name}`} onClose={() => setHistoryFor(null)}>
          {(() => {
            const rows = stockMovements.filter((m) => m.productId === historyFor.id)
            if (rows.length === 0) return <p className="text-sm text-muted">No movements recorded yet.</p>
            return (
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="th text-left">When</th>
                    <th className="th text-left">Reason</th>
                    <th className="th text-right">Change</th>
                    <th className="th text-left">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((m) => (
                    <tr key={m.id} className="border-t border-subtle">
                      <td className="px-3 py-2 text-secondary tabular-nums">{m.at.slice(0, 10)}</td>
                      <td className="px-3 py-2 text-secondary">{m.reason}</td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums ${
                          m.delta < 0 ? 'text-danger' : 'text-primary'
                        }`}
                      >
                        {m.delta > 0 ? '+' : ''}
                        {fmtNum(m.delta)}
                      </td>
                      <td className="px-3 py-2 text-xs text-faint">{m.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          })()}
        </Modal>
      )}
    </SalesChrome>
  )
}

function AdjustModal({
  product,
  onClose,
  onSubmit,
}: {
  product: Product
  onClose: () => void
  onSubmit: (delta: number, reason: 'receive' | 'adjust' | 'count' | 'build', note: string) => void
}) {
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState<'receive' | 'adjust' | 'count' | 'build'>('receive')
  const [note, setNote] = useState('')
  const n = Number(qty)
  const valid = Number.isFinite(n) && n !== 0

  return (
    <Modal title={`Adjust stock — ${product.name}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="flex gap-2">
          {(['receive', 'build', 'adjust', 'count'] as const).map((r) => (
            <button
              key={r}
              onClick={() => setReason(r)}
              className={`rounded px-3 py-1.5 text-sm capitalize ${
                reason === r ? 'bg-brand text-on-brand' : 'bg-overlay text-secondary'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        <label className="block">
          <span className="label">Change (negative to remove)</span>
          <Input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" placeholder="e.g. 50 or -12" />
        </label>
        <label className="block">
          <span className="label">Note</span>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why" />
        </label>
        <p className="text-xs text-muted">
          Recorded as a movement, so the count always has a reason behind it.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSubmit(n, reason, note)} disabled={!valid}>
            <Plus size={16} /> Apply
          </Button>
        </div>
      </div>
    </Modal>
  )
}
