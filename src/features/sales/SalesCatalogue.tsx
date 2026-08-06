/**
 * Products and customers — the two reference lists behind every quote.
 *
 * The products screen shows the cost waterfall the workbook computed in
 * columns: materials → labour → markup → price. It also shows what's wrong
 * with a BOM, because the source workbook shipped with an uncosted line that
 * understated every shelter quote and nothing on screen said so.
 */
import { useState } from 'react'
import { useData } from '@/data/context'
import { useSession } from '@/auth/session'
import { Badge, Button, EmptyState, Input, Modal } from '@/components/ui'
import { AlertTriangle, Plus } from 'lucide-react'
import type { Product, SalesCustomer } from '@/data/types'
import { priceUnit, pricingWarnings } from '@/domain/pricing'
import { SalesChrome, fmtMoney, fmtNum } from './SalesChrome'
import { toProductSpec } from './useOrderPricing'

// ═══════════════════════════════════════════════════════════════════════════
// Products
// ═══════════════════════════════════════════════════════════════════════════

export function ProductsHome() {
  const { products } = useData()
  const [open, setOpen] = useState<Product | null>(null)

  return (
    <SalesChrome title="Products" subtitle="The catalogue and how each item is costed">
      {products.length === 0 ? (
        <EmptyState>No products yet.</EmptyState>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="th text-left">Product</th>
                <th className="th text-right">Materials</th>
                <th className="th text-right">Labour</th>
                <th className="th text-right">Cost</th>
                <th className="th text-right">Markup</th>
                <th className="th text-right">Price</th>
                <th className="th text-left">Checks</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const spec = toProductSpec(p)
                // Quantity 1 for the list view; volume-tiered goods are priced
                // at their first break on the detail sheet.
                const u = priceUnit(spec, p.tiers.length ? p.tiers[0].minQty : 1)
                const warn = pricingWarnings(spec)
                return (
                  <tr
                    key={p.id}
                    className="cursor-pointer border-t border-subtle hover:bg-overlay"
                    onClick={() => setOpen(p)}
                  >
                    <td className="px-3 py-2">
                      <div className="font-medium text-primary">{p.name}</div>
                      <div className="text-xs text-faint">
                        {p.sku} · {p.currency}/{p.unit}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-secondary">{u.materials.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-secondary">{u.labor.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-secondary">{u.unitCost.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-secondary">
                      {(p.markup * 100).toFixed(0)}%
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium text-primary">
                      {fmtMoney(u.price, p.currency)}
                    </td>
                    <td className="px-3 py-2">
                      {warn.length > 0 ? (
                        <span className="flex items-center gap-1 text-xs text-warn">
                          <AlertTriangle size={13} /> {warn.length}
                        </span>
                      ) : (
                        <Badge tone="green">OK</Badge>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {open && <ProductDetail product={open} onClose={() => setOpen(null)} />}
    </SalesChrome>
  )
}

function ProductDetail({ product, onClose }: { product: Product; onClose: () => void }) {
  const spec = toProductSpec(product)
  const qty = product.tiers.length ? product.tiers[0].minQty : 1
  const u = priceUnit(spec, qty)
  const warnings = pricingWarnings(spec)

  return (
    <Modal title={product.name} onClose={onClose} wide>
      <div className="space-y-4">
        {warnings.length > 0 && (
          <div className="rounded border border-warn/40 bg-warn/10 p-3">
            <p className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-warn">
              <AlertTriangle size={14} /> Costing problems
            </p>
            <ul className="list-disc space-y-0.5 pl-4 text-xs text-secondary">
              {warnings.map((w, i) => (
                <li key={i}>{w.message}</li>
              ))}
            </ul>
          </div>
        )}

        {product.parts.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">Bill of materials</h3>
            <div className="card overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="th text-left">Part</th>
                    <th className="th text-right">Qty</th>
                    <th className="th text-right">Unit cost</th>
                    <th className="th text-right">Freight</th>
                    <th className="th text-right">Line</th>
                  </tr>
                </thead>
                <tbody>
                  {product.parts.map((part) => (
                    <tr key={part.id} className="border-t border-subtle">
                      <td className="px-3 py-2">
                        <span className="text-primary">{part.part}</span>
                        {part.note && <div className="text-xs text-faint">{part.note}</div>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-secondary">{fmtNum(part.qty, 2)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {part.unitCost == null ? (
                          <span className="text-warn">not costed</span>
                        ) : (
                          <span className="text-secondary">{part.unitCost.toFixed(4)}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-secondary">
                        {part.freightPerUnit.toFixed(2)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-primary">
                        {((part.unitCost ?? 0) * part.qty + part.freightPerUnit).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {product.tiers.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">Volume breaks</h3>
            <ul className="space-y-1 text-sm">
              {product.tiers.map((t) => (
                <li key={t.id} className="text-secondary">
                  {fmtNum(t.minQty)}+ {product.unit} — {t.unitCost.toFixed(2)} {product.currency}/{product.unit}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">
            Price at {fmtNum(qty)} {product.unit}
          </h3>
          <dl className="card space-y-1 text-sm">
            {[
              ['Materials', u.materials],
              ['Labour', u.labor],
              ['Cost to build', u.buildCost],
              ['Markup', u.markupAmount],
              ['Exact price', u.exactPrice],
            ].map(([label, v]) => (
              <div key={label as string} className="flex justify-between">
                <dt className="text-secondary">{label as string}</dt>
                <dd className="tabular-nums text-primary">{(v as number).toFixed(4)}</dd>
              </div>
            ))}
            <div className="flex justify-between border-t border-subtle pt-1 font-medium">
              <dt className="text-primary">
                Quoted price{product.roundTo ? ` (rounded up to ${product.roundTo})` : ''}
              </dt>
              <dd className="tabular-nums text-brand">{fmtMoney(u.price, product.currency)}</dd>
            </div>
          </dl>
        </div>
      </div>
    </Modal>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Customers
// ═══════════════════════════════════════════════════════════════════════════

export function CustomersHome() {
  const { salesCustomers, addSalesCustomer, saveSalesCustomer } = useData()
  const s = useSession()
  const canEdit = s.can('sales', 'edit')
  const [open, setOpen] = useState<SalesCustomer | null>(null)

  return (
    <SalesChrome
      title="Customers"
      subtitle="Who you sell to. A US address needs an EIN before its paperwork will clear."
      actions={
        canEdit ? (
          <Button
            onClick={async () => {
              const r = await addSalesCustomer({ company: 'New customer' })
              if (r.ok && r.id) setOpen(salesCustomers.find((c) => c.id === r.id) ?? null)
            }}
          >
            <Plus size={16} /> Add customer
          </Button>
        ) : undefined
      }
    >
      {salesCustomers.length === 0 ? (
        <EmptyState>No customers yet.</EmptyState>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="th text-left">Company</th>
                <th className="th text-left">Contact</th>
                <th className="th text-left">Location</th>
                <th className="th text-left">Tax ID</th>
                <th className="th text-left">Notes</th>
              </tr>
            </thead>
            <tbody>
              {salesCustomers.map((c) => (
                <tr
                  key={c.id}
                  className="cursor-pointer border-t border-subtle hover:bg-overlay"
                  onClick={() => setOpen(c)}
                >
                  <td className="px-3 py-2 font-medium text-primary">{c.company || '—'}</td>
                  <td className="px-3 py-2 text-secondary">{c.contactName}</td>
                  <td className="px-3 py-2 text-secondary">
                    {[c.city, c.region].filter(Boolean).join(', ')}
                    {c.country !== 'CA' && <Badge tone="neutral">{c.country}</Badge>}
                  </td>
                  <td className="px-3 py-2 text-secondary">
                    {c.taxId || (c.country !== 'CA' ? <span className="text-warn">missing</span> : '—')}
                  </td>
                  <td className="px-3 py-2 text-xs text-faint">{c.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <Modal title={open.company || open.contactName} onClose={() => setOpen(null)}>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ['company', 'Company'],
                ['contactName', 'Contact'],
                ['city', 'City'],
                ['region', 'Province / State'],
                ['postalCode', 'Postal / ZIP'],
                ['country', 'Country (ISO 2)'],
                ['taxId', 'EIN / BN'],
                ['email', 'Email'],
                ['phone', 'Phone'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="block">
                <span className="label">{label}</span>
                <Input
                  value={open[key]}
                  disabled={!canEdit}
                  onChange={(e) => {
                    setOpen({ ...open, [key]: e.target.value })
                    void saveSalesCustomer(open.id, { [key]: e.target.value })
                  }}
                />
              </label>
            ))}
          </div>
        </Modal>
      )}
    </SalesChrome>
  )
}
