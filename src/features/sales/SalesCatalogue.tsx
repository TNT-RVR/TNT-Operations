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
import { Badge, Button, EmptyState, Input, Modal, Select } from '@/components/ui'
import { AlertTriangle, Plus, Save, Trash2 } from 'lucide-react'
import type { Product, ProductPart, SalesCustomer } from '@/data/types'
import { priceUnit, pricingWarnings } from '@/domain/pricing'
import { SalesChrome, fmtMoney, fmtNum } from './SalesChrome'
import { toProductSpec } from './useOrderPricing'
import { NewCustomerModal } from './NewCustomerModal'

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

/**
 * The full product sheet — every field editable, including each BOM row.
 *
 * ── Edits are held locally and saved explicitly ──────────────────────────────
 *
 * Every other editable screen in this app saves on change. This one does not,
 * and the reason is the cost waterfall: a BOM edit moves the price of the
 * product, and a product price feeds every estimate built from it. Saving
 * halfway through typing "36.50" would briefly persist a unit cost of 3 and
 * recompute against it. So changes stay in local state, the waterfall
 * recalculates live off the DRAFT so you can see what an edit does before
 * committing it, and Save writes once.
 *
 * Existing orders are unaffected either way: their line prices are a snapshot
 * (migration 0015), so re-costing a product never restates an invoice already
 * sent.
 */
function ProductDetail({ product, onClose }: { product: Product; onClose: () => void }) {
  const { saveProduct } = useData()
  const session = useSession()
  const canEdit = session.can('sales', 'edit')

  const [draft, setDraft] = useState<Product>(product)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const dirty = JSON.stringify(draft) !== JSON.stringify(product)

  // The waterfall recomputes off the draft, so an edit shows its effect on the
  // price before it is committed.
  const spec = toProductSpec(draft)
  const qty = draft.tiers.length ? draft.tiers[0].minQty : 1
  const u = priceUnit(spec, qty)
  const warnings = pricingWarnings(spec)

  const set = (patch: Partial<Product>) => setDraft((d) => ({ ...d, ...patch }))

  const setPart = (id: string, patch: Partial<ProductPart>) =>
    setDraft((d) => ({ ...d, parts: d.parts.map((x) => (x.id === id ? { ...x, ...patch } : x)) }))

  const addPart = () =>
    setDraft((d) => ({
      ...d,
      parts: [
        ...d.parts,
        {
          id: `new_${Date.now()}`,
          part: '',
          qty: 1,
          // New lines start UNCOSTED rather than at zero. A zero reads as
          // "this part is free", which is exactly the mistake the source
          // workbook made on the rivet line.
          unitCost: null,
          freightPerUnit: 0,
          note: '',
          sort: d.parts.length,
        },
      ],
    }))

  const removePart = (id: string) =>
    setDraft((d) => ({ ...d, parts: d.parts.filter((x) => x.id !== id) }))

  const save = async () => {
    setSaving(true)
    setError('')
    const r = await saveProduct(product.id, draft)
    setSaving(false)
    if (!r.ok) setError(r.error ?? 'Could not save')
    else onClose()
  }

  /** A numeric cell. Empty means null for cost, 0 for everything else. */
  const numCell = (
    value: number | null,
    onChange: (v: number | null) => void,
    opts: { nullable?: boolean; step?: string } = {},
  ) => (
    <Input
      className="w-full text-right tabular-nums"
      inputMode="decimal"
      disabled={!canEdit}
      value={value == null ? '' : String(value)}
      placeholder={opts.nullable ? 'not costed' : '0'}
      onChange={(e) => {
        const raw = e.target.value.trim()
        if (raw === '') return onChange(opts.nullable ? null : 0)
        const n = Number(raw)
        if (Number.isFinite(n)) onChange(n)
      }}
    />
  )

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

        {/* ── Product fields ── */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="block">
            <span className="label">Name</span>
            <Input value={draft.name} disabled={!canEdit} onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label className="block">
            <span className="label">SKU</span>
            <Input value={draft.sku} disabled={!canEdit} onChange={(e) => set({ sku: e.target.value })} />
          </label>
          <label className="block">
            <span className="label">Unit of sale</span>
            <Input
              value={draft.unit}
              disabled={!canEdit}
              placeholder="each"
              onChange={(e) => set({ unit: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="label">Currency</span>
            <Select
              value={draft.currency}
              disabled={!canEdit}
              onChange={(e) => set({ currency: e.target.value as Product['currency'] })}
            >
              <option value="CAD">CAD</option>
              <option value="USD">USD</option>
            </Select>
          </label>
          <label className="block">
            <span className="label">Labour per unit</span>
            {numCell(draft.labor, (v) => set({ labor: v ?? 0 }))}
          </label>
          <label className="block">
            <span className="label">Markup %</span>
            <Input
              className="text-right tabular-nums"
              inputMode="decimal"
              disabled={!canEdit}
              value={String(Math.round(draft.markup * 1000) / 10)}
              onChange={(e) => {
                const n = Number(e.target.value.trim())
                if (Number.isFinite(n)) set({ markup: n / 100 })
              }}
            />
          </label>
          <label className="block">
            <span className="label">Round price up to</span>
            <Input
              className="text-right tabular-nums"
              inputMode="decimal"
              disabled={!canEdit}
              placeholder="no rounding"
              value={draft.roundTo == null ? '' : String(draft.roundTo)}
              onChange={(e) => {
                const raw = e.target.value.trim()
                if (raw === '') return set({ roundTo: null })
                const n = Number(raw)
                if (Number.isFinite(n) && n > 0) set({ roundTo: n })
              }}
            />
          </label>
          <label className="block">
            <span className="label">HS code</span>
            <Input
              value={draft.hsCode ?? ''}
              disabled={!canEdit}
              placeholder="from your broker"
              onChange={(e) => set({ hsCode: e.target.value || null })}
            />
          </label>
          <label className="block">
            <span className="label">Country of origin</span>
            <Input
              value={draft.countryOfOrigin ?? ''}
              disabled={!canEdit}
              placeholder="CA"
              onChange={(e) => set({ countryOfOrigin: e.target.value || null })}
            />
          </label>
          <label className="block">
            <span className="label">Ships as</span>
            <Input
              value={draft.shipItem ?? ''}
              disabled={!canEdit}
              placeholder="matches an item spec"
              onChange={(e) => set({ shipItem: e.target.value || null })}
            />
          </label>
          <label className="flex items-end gap-2 pb-2">
            <input
              type="checkbox"
              checked={draft.active}
              disabled={!canEdit}
              onChange={(e) => set({ active: e.target.checked })}
            />
            <span className="text-sm text-secondary">Active (offer it on new estimates)</span>
          </label>
          <label className="block sm:col-span-2 lg:col-span-3">
            <span className="label">Notes</span>
            <Input value={draft.notes} disabled={!canEdit} onChange={(e) => set({ notes: e.target.value })} />
          </label>
        </div>

        {/* ── Bill of materials ── */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">Bill of materials</h3>
            {canEdit && (
              <Button variant="ghost" onClick={addPart}>
                <Plus size={15} /> Add part
              </Button>
            )}
          </div>

          {draft.parts.length === 0 ? (
            <p className="text-sm text-muted">
              No parts. A product with no BOM is priced from its volume breaks, or sells at labour plus markup.
            </p>
          ) : (
            <div className="card overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="th text-left">Part</th>
                    <th className="th w-24 text-right">Qty</th>
                    <th className="th w-32 text-right">Unit cost</th>
                    <th className="th w-28 text-right">Freight</th>
                    <th className="th text-left">Note</th>
                    <th className="th w-24 text-right">Line</th>
                    {canEdit && <th className="th w-10" />}
                  </tr>
                </thead>
                <tbody>
                  {draft.parts.map((part) => (
                    <tr key={part.id} className="border-t border-subtle align-top">
                      <td className="px-2 py-1.5">
                        <Input
                          className="w-full"
                          value={part.part}
                          disabled={!canEdit}
                          placeholder="Part name"
                          onChange={(e) => setPart(part.id, { part: e.target.value })}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        {numCell(part.qty, (v) => setPart(part.id, { qty: v ?? 0 }))}
                      </td>
                      <td className="px-2 py-1.5">
                        {numCell(part.unitCost, (v) => setPart(part.id, { unitCost: v }), { nullable: true })}
                      </td>
                      <td className="px-2 py-1.5">
                        {numCell(part.freightPerUnit, (v) => setPart(part.id, { freightPerUnit: v ?? 0 }))}
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          className="w-full"
                          value={part.note}
                          disabled={!canEdit}
                          placeholder="Where the number comes from"
                          onChange={(e) => setPart(part.id, { note: e.target.value })}
                        />
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-primary">
                        {part.unitCost == null ? (
                          <span className="text-warn">—</span>
                        ) : (
                          (part.unitCost * part.qty + part.freightPerUnit).toFixed(2)
                        )}
                      </td>
                      {canEdit && (
                        <td className="px-2 py-2 text-right">
                          <button
                            className="rounded p-1 text-faint hover:text-danger"
                            onClick={() => removePart(part.id)}
                            title="Remove part"
                          >
                            <Trash2 size={15} />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-1.5 text-xs text-faint">
            Freight is per FINISHED unit for that part line, added once — not multiplied by quantity. Leave a unit
            cost blank if you do not know it yet; it will be flagged rather than counted as free.
          </p>
        </div>

        {/* ── Volume breaks ── */}
        {draft.tiers.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">Volume breaks</h3>
            <ul className="space-y-1 text-sm">
              {draft.tiers.map((t) => (
                <li key={t.id} className="text-secondary">
                  {fmtNum(t.minQty)}+ {draft.unit} — {t.unitCost.toFixed(2)} {draft.currency}/{draft.unit}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── Live waterfall ── */}
        <div>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">
            Price at {fmtNum(qty)} {draft.unit}
            {dirty && <span className="ml-2 normal-case tracking-normal text-warn">· unsaved</span>}
          </h3>
          <dl className="card space-y-1 text-sm">
            {([
              ['Materials', u.materials],
              ['Labour', u.labor],
              ['Cost to build', u.buildCost],
              ['Markup', u.markupAmount],
              ['Exact price', u.exactPrice],
            ] as Array<[string, number]>).map(([label, v]) => (
              <div key={label} className="flex justify-between">
                <dt className="text-secondary">{label}</dt>
                <dd className="tabular-nums text-primary">{v.toFixed(4)}</dd>
              </div>
            ))}
            <div className="flex justify-between border-t border-subtle pt-1 font-medium">
              <dt className="text-primary">
                Quoted price{draft.roundTo ? ` (rounded up to ${draft.roundTo})` : ''}
              </dt>
              <dd className="tabular-nums text-brand">{fmtMoney(u.price, draft.currency)}</dd>
            </div>
          </dl>
        </div>

        {error && <p className="text-xs text-danger">{error}</p>}

        {canEdit && (
          <div className="flex flex-wrap items-center gap-2 border-t border-subtle pt-3">
            <Button onClick={save} disabled={!dirty || saving}>
              <Save size={16} /> {saving ? 'Saving…' : 'Save product'}
            </Button>
            {dirty && (
              <Button variant="ghost" onClick={() => setDraft(product)}>
                Discard changes
              </Button>
            )}
            <span className="text-xs text-faint">
              Re-costing does not change estimates or invoices already written — their prices are a snapshot.
            </span>
          </div>
        )}
      </div>
    </Modal>
  )
}


// ═══════════════════════════════════════════════════════════════════════════
// Customers
// ═══════════════════════════════════════════════════════════════════════════

export function CustomersHome() {
  const { salesCustomers, saveSalesCustomer } = useData()
  const s = useSession()
  const canEdit = s.can('sales', 'edit')
  const [open, setOpen] = useState<SalesCustomer | null>(null)
  const [adding, setAdding] = useState(false)

  return (
    <SalesChrome
      title="Customers"
      subtitle="Who you sell to. A US address needs an EIN before its paperwork will clear."
      actions={
        canEdit ? (
          // Was: create a row called "New customer", then look it up in
          // `salesCustomers` — an array captured before the create, so the
          // lookup missed and the editor silently did not open, leaving the
          // junk row behind. The shared modal collects first and saves once.
          <Button onClick={() => setAdding(true)}>
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

      {adding && <NewCustomerModal onClose={() => setAdding(false)} onCreated={() => setAdding(false)} />}

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
