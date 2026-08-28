/**
 * Shipping specs — how each item pallets, and what it weighs.
 *
 * These rows are load-bearing and were, until now, only reachable through SQL.
 * `packing.ts` refuses to guess: an item with no spec is reported as
 * `unspecced` and left out of every total rather than counted as weightless,
 * which is right, and which means a missing row silently stops a product being
 * quotable. There was no way to add one from inside the app.
 *
 * ── What the screen leads with ───────────────────────────────────────────────
 *
 * The gap, not the list. A product with a `shipItem` nothing has a spec for
 * looks completely healthy — it has a name, a price, a BOM — right up until
 * someone builds a freight quote and it simply is not on the table. That is at
 * the top with a button that opens a new spec already named, because the fix is
 * one row rather than one per product.
 *
 * ── The pallet preview ───────────────────────────────────────────────────────
 *
 * Seven numbers in seven boxes cannot be checked. One full pallet — "125 tops,
 * 4 stacks, 83 in, 425 lb" — is a thing somebody can walk into the shop and put
 * a tape measure against, so the editor shows that as the figures change.
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '@/data/context'
import { useSession } from '@/auth/session'
import { AlertTriangle, Package, Plus, Save, Trash2 } from 'lucide-react'
import { Badge, Button, EmptyState, InfoDot, Input, Modal, Select } from '@/components/ui'
import type { ItemSpecRow } from '@/data/types'
import { helpFor } from '@/domain/docHelp'
import type { ItemSpec } from '@/domain/packing'
import {
  emptySpec,
  fullPalletPreview,
  isSpecUsable,
  missingSpecs,
  productsShippingAs,
  specProblems,
  unshippedProducts,
} from '@/domain/itemSpecs'
import { SalesChrome, fmtNum } from './SalesChrome'
import { toItemSpec } from './useOrderPricing'

export function ShippingSpecsHome() {
  const { itemSpecs, products } = useData()
  const s = useSession()
  const canEdit = s.can('sales', 'edit')
  const [editing, setEditing] = useState<{ spec: ItemSpec; isNew: boolean } | null>(null)

  const forGap = useMemo(
    () => products.map((p) => ({ name: p.name, shipItem: p.shipItem, active: p.active })),
    [products],
  )
  const gaps = useMemo(() => missingSpecs(forGap, itemSpecs), [forGap, itemSpecs])
  const unshipped = useMemo(() => unshippedProducts(forGap), [forGap])

  return (
    <SalesChrome
      title="Shipping specs"
      subtitle="How each item pallets, stacks and weighs — the figures every freight document is built from"
      actions={
        canEdit && (
          <Button onClick={() => setEditing({ spec: emptySpec(), isNew: true })}>
            <Plus size={16} /> New spec
          </Button>
        )
      }
    >
      {gaps.length > 0 && (
        <div className="mb-4 rounded border border-warn/40 bg-warn/10 p-3">
          <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-warn">
            <AlertTriangle size={14} /> {gaps.length} item{gaps.length === 1 ? '' : 's'} cannot be quoted
          </p>
          <ul className="space-y-2 text-xs">
            {gaps.map((g) => (
              <li key={g.item} className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium text-primary">{g.item}</span>
                <span className="text-secondary">
                  has no spec, so {g.products.join(', ')} {g.products.length === 1 ? 'is' : 'are'} left off the
                  freight table.
                </span>
                {canEdit && (
                  <button
                    className="underline decoration-dotted underline-offset-2 text-brand"
                    onClick={() => setEditing({ spec: emptySpec(g.item), isNew: true })}
                  >
                    add it
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/*
        Reported apart from the panel above, and worded as a question. A product
        with no shipping item may simply be a service. But the packer falls back
        to the line's DESCRIPTION, so a physical one lands in `unspecced` and
        blocks its freight quote with a message about missing weights rather
        than about the missing link that caused it.
      */}
      {unshipped.length > 0 && (
        <div className="mb-4 rounded border border-subtle p-3">
          <p className="mb-1 text-xs font-semibold text-muted">
            {unshipped.length} product{unshipped.length === 1 ? '' : 's'} do not say how they ship
          </p>
          <p className="text-xs text-secondary">
            {unshipped.join(', ')} — no “Ships as” on the product, so nothing here can be matched to{' '}
            {unshipped.length === 1 ? 'it' : 'them'}. Fine for anything that never goes on a pallet; if it does
            ship, set “Ships as” on the product in{' '}
            <Link className="underline decoration-dotted underline-offset-2 text-brand" to="/finances/sales/products">
              Products
            </Link>{' '}
            to one of the names below, or its quote will refuse for want of a weight.
          </p>
        </div>
      )}

      {itemSpecs.length === 0 ? (
        <EmptyState>No shipping specs yet.</EmptyState>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="th text-left">Item</th>
                <th className="th text-right">Weight</th>
                <th className="th text-right">Item size (in)</th>
                <th className="th text-right">Nested</th>
                <th className="th text-right">Per pallet</th>
                <th className="th text-right">Stacks / height</th>
                <th className="th text-right">Class</th>
                <th className="th text-left">Ships</th>
              </tr>
            </thead>
            <tbody>
              {itemSpecs.map((row) => {
                const spec = toItemSpec(row)
                const problems = specProblems(spec)
                const usable = isSpecUsable(spec)
                const ships = productsShippingAs(products, row.item)
                return (
                  <tr
                    key={row.id}
                    className="cursor-pointer border-t border-subtle hover:bg-overlay"
                    onClick={() => setEditing({ spec, isNew: false })}
                  >
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2 font-medium text-primary">
                        {row.item}
                        {!usable && <Badge tone="red">Unusable</Badge>}
                        {usable && problems.length > 0 && <Badge tone="amber">Check</Badge>}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-secondary">{row.weightLbs} lb</td>
                    <td className="px-3 py-2 text-right tabular-nums text-secondary">
                      {row.lengthIn}×{row.widthIn}×{row.heightIn}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-secondary">
                      {row.packMode === 'loose' ? (
                        <span className="text-faint">loose</span>
                      ) : (
                        row.stackedHeightIn
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-secondary">
                      {fmtNum(row.maxItemsOnPallet)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-secondary">
                      {row.packMode === 'loose' ? (
                        <span className="text-faint">{row.looseHeightIn ?? 0} in</span>
                      ) : (
                        row.stacksPerPallet
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-secondary">
                      {row.freightClass ?? <span className="text-faint">density</span>}
                    </td>
                    <td className="px-3 py-2 text-secondary">
                      {ships.length ? ships.join(', ') : <span className="text-faint">nothing yet</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <SpecEditor
          /*
           * Keyed on the item so opening a different spec REMOUNTS the editor.
           * The draft is seeded from props once, in useState, so without this a
           * second spec opened over the first would show the first one's
           * figures under the second one's name — and saving would write those
           * numbers onto the wrong item.
           */
          key={editing.isNew ? '__new__' : editing.spec.item}
          spec={editing.spec}
          isNew={editing.isNew}
          canEdit={canEdit}
          onClose={() => setEditing(null)}
        />
      )}
    </SalesChrome>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Editor
// ═══════════════════════════════════════════════════════════════════════════

function SpecEditor({
  spec,
  isNew,
  canEdit,
  onClose,
}: {
  spec: ItemSpec
  isNew: boolean
  canEdit: boolean
  onClose: () => void
}) {
  const { saveItemSpec, deleteItemSpec, itemSpecs, products } = useData()
  const stored = itemSpecs.find((s) => s.item === spec.item)
  const [draft, setDraft] = useState<ItemSpecRow>(() => ({
    id: '',
    ...spec,
    packMode: spec.packMode ?? null,
    looseHeightIn: spec.looseHeightIn ?? null,
    containerTareLbs: spec.containerTareLbs ?? null,
    freightClass: stored?.freightClass ?? null,
    nmfc: stored?.nmfc ?? '',
  }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const set = (patch: Partial<ItemSpecRow>) => setDraft((d) => ({ ...d, ...patch }))
  const loose = draft.packMode === 'loose'
  const asSpec = toItemSpec(draft)
  const problems = specProblems(asSpec)
  const blocking = problems.filter((p) => p.severity === 'blocking')
  const pallet = fullPalletPreview(asSpec)
  const ships = productsShippingAs(products, spec.item)

  // A rename is a new row, not an edit: `item` is the key everything joins on.
  const renamed = !isNew && draft.item !== spec.item

  const save = async () => {
    setBusy(true)
    setError('')
    const r = await saveItemSpec(draft.item.trim(), {
      weightLbs: draft.weightLbs,
      lengthIn: draft.lengthIn,
      widthIn: draft.widthIn,
      heightIn: draft.heightIn,
      stackedHeightIn: draft.stackedHeightIn,
      maxItemsOnPallet: draft.maxItemsOnPallet,
      palletSize: draft.palletSize,
      stacksPerPallet: draft.stacksPerPallet,
      packMode: draft.packMode,
      looseHeightIn: draft.looseHeightIn,
      containerTareLbs: draft.containerTareLbs,
      freightClass: draft.freightClass,
      nmfc: draft.nmfc,
    })
    setBusy(false)
    if (!r.ok) return setError(r.error ?? 'Could not save')
    onClose()
  }

  const remove = async () => {
    setBusy(true)
    const r = await deleteItemSpec(spec.item)
    setBusy(false)
    if (!r.ok) return setError(r.error ?? 'Could not delete')
    onClose()
  }

  return (
    <Modal title={isNew ? 'New shipping spec' : spec.item} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="block sm:col-span-2 lg:col-span-3">
            <span className="label">Item name</span>
            <Input
              value={draft.item}
              disabled={!canEdit}
              placeholder="Matches a product's “Ships as”"
              onChange={(e) => set({ item: e.target.value })}
            />
            <p className="mt-1 text-xs text-faint">
              This is the join: a product ships as this exact name. Nothing matches it loosely.
            </p>
          </label>

          <Num
            label="Weight (lb)"
            help="weight"
            value={draft.weightLbs}
            disabled={!canEdit}
            onChange={(v) => set({ weightLbs: v })}
          />
          <Num
            label="Length (in)"
            value={draft.lengthIn}
            disabled={!canEdit}
            onChange={(v) => set({ lengthIn: v })}
          />
          <Num label="Width (in)" value={draft.widthIn} disabled={!canEdit} onChange={(v) => set({ widthIn: v })} />
          <Num
            label="Height standing (in)"
            value={draft.heightIn}
            disabled={!canEdit}
            onChange={(v) => set({ heightIn: v })}
            hint="One item on its own, not stacked."
          />
          <Num
            label="Items per pallet"
            value={draft.maxItemsOnPallet}
            disabled={!canEdit}
            onChange={(v) => set({ maxItemsOnPallet: v })}
            hint={loose ? 'However many tubs or bins that takes.' : 'All stacks combined.'}
          />

          {/*
            The mode decides which of the next two blocks is even answerable.
            Anchors have no "height one more anchor adds" — they go in a tub —
            and a number typed to fill that box becomes a made-up pallet height,
            then a made-up density, then a made-up class on a real document.
          */}
          <label className="block">
            <span className="label">How it packs</span>
            <Select
              value={draft.packMode ?? 'stacked'}
              disabled={!canEdit}
              onChange={(e) =>
                set({ packMode: e.target.value === 'loose' ? 'loose' : 'stacked' })
              }
            >
              <option value="stacked">Stacked — they nest into each other</option>
              <option value="loose">Loose — they go in tubs or bins</option>
            </Select>
            <p className="mt-1 text-xs text-faint">
              {loose
                ? 'Nothing nests, so the pallet height is measured rather than worked out.'
                : 'The pallet height is worked out from the stacks and the nested height.'}
            </p>
          </label>

          {loose ? (
            <>
              <Num
                label="Loaded pallet height (in)"
                value={draft.looseHeightIn ?? 0}
                disabled={!canEdit}
                onChange={(v) => set({ looseHeightIn: v })}
                hint="Measure a real full pallet — goods, tubs and wrap. Not counting the pallet itself."
              />
              <Num
                label="Empty containers (lb/pallet)"
                value={draft.containerTareLbs ?? 0}
                disabled={!canEdit}
                onChange={(v) => set({ containerTareLbs: v })}
                hint="What the tubs weigh on a full pallet. Tubs are not weightless and the carrier bills gross."
              />
            </>
          ) : (
            <>
              <Num
                label="Height nested (in)"
                value={draft.stackedHeightIn}
                disabled={!canEdit}
                onChange={(v) => set({ stackedHeightIn: v })}
                hint="What each ADDITIONAL one adds to the stack. A tray top stands 3.5 and nests into 2.48."
              />
              <Num
                label="Stacks per pallet"
                value={draft.stacksPerPallet}
                disabled={!canEdit}
                onChange={(v) => set({ stacksPerPallet: v })}
                hint="The usual answer. A shipment can say otherwise on its freight quote."
              />
            </>
          )}
          <label className="block">
            <span className="label">Pallet size</span>
            <Input
              value={draft.palletSize}
              disabled={!canEdit}
              placeholder="48x40"
              onChange={(e) => set({ palletSize: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="label flex items-center gap-1.5">
              Settled freight class
              <InfoDot note={helpFor('freightClass')} />
            </span>
            <Input
              type="number"
              value={draft.freightClass ?? ''}
              disabled={!canEdit}
              placeholder="leave blank for density"
              onChange={(e) => set({ freightClass: e.target.value === '' ? null : Number(e.target.value) })}
            />
            <p className="mt-1 text-xs text-faint">
              Only when a carrier has given you one. Blank means every quote works it out from the load, which
              follows the goods when they are packed differently.
            </p>
          </label>
          <label className="block">
            <span className="label">NMFC item number</span>
            <Input value={draft.nmfc} disabled={!canEdit} onChange={(e) => set({ nmfc: e.target.value })} />
          </label>
        </div>

        {/* ── What one pallet comes to ── */}
        <div className="card">
          <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted">
            <Package size={14} /> One full pallet
          </h3>
          {pallet ? (
            <div className="grid gap-3 text-sm sm:grid-cols-4">
              <Readout label="Items" value={fmtNum(pallet.qty)} />
              <Readout label="Stacks" value={loose ? 'loose' : String(pallet.stacksPerPallet)} />
              <Readout label="Outside height" value={`${pallet.outsideHeightIn} in`} />
              <Readout label="Weight" value={`${fmtNum(Math.round(pallet.totalWeightLbs))} lb`} />
            </div>
          ) : (
            <p className="text-sm text-muted">
              Fill in the figures above and this shows what a loaded pallet comes to, so it can be checked
              against a real one.
            </p>
          )}
          <p className="mt-2 text-xs text-faint">
            Height includes the pallet deck, because that is what a carrier measures and what freight class is
            worked out from.
          </p>
        </div>

        {problems.length > 0 && (
          <div
            className={`rounded border p-3 ${
 blocking.length ? 'border-danger/40 bg-[color:var(--danger-bg)]' : 'border-warn/40 bg-warn/10'
            }`}
          >
            <p
              className={`mb-1 text-xs font-semibold ${
                blocking.length ? 'text-danger' : 'text-warn'
              }`}
            >
              {blocking.length ? 'Not usable yet' : 'Worth a second look'}
            </p>
            <ul className="space-y-1 text-xs text-secondary">
              {problems.map((p, i) => (
                <li key={i}>{p.message}</li>
              ))}
            </ul>
          </div>
        )}

        {renamed && (
          <p className="rounded border border-warn/40 bg-warn/10 p-3 text-xs text-secondary">
            Renaming writes a NEW spec under “{draft.item}” and leaves “{spec.item}” as it is — the name is the
            key every product joins on. Update the products that ship as it, or they keep pointing at the old
            one.
          </p>
        )}

        {ships.length > 0 && (
          <p className="text-xs text-muted">
            {ships.length} product{ships.length === 1 ? '' : 's'} ship{ships.length === 1 ? 's' : ''} as this:{' '}
            {ships.join(', ')}.
          </p>
        )}

        {canEdit && (
          <div className="flex flex-wrap items-center gap-3 border-t border-subtle pt-3">
            <Button onClick={save} disabled={busy || !draft.item.trim()}>
              <Save size={16} /> {busy ? 'Saving…' : 'Save spec'}
            </Button>
            {!isNew &&
              (confirmDelete ? (
                <>
                  <Button variant="danger" onClick={remove} disabled={busy}>
                    <Trash2 size={16} /> Delete “{spec.item}”
                  </Button>
                  <button className="text-xs text-muted underline" onClick={() => setConfirmDelete(false)}>
                    cancel
                  </button>
                  {ships.length > 0 && (
                    <span className="text-xs text-danger">
                      {ships.join(', ')} still ship as this and will drop off every freight table.
                    </span>
                  )}
                </>
              ) : (
                <Button variant="ghost" onClick={() => setConfirmDelete(true)} disabled={busy}>
                  <Trash2 size={16} /> Delete
                </Button>
              ))}
            {error && <span className="text-xs text-danger">{error}</span>}
          </div>
        )}
      </div>
    </Modal>
  )
}

function Num({
  label,
  value,
  onChange,
  disabled,
  hint,
  help,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  disabled?: boolean
  hint?: string
  help?: string
}) {
  return (
    <label className="block">
      <span className="label flex items-center gap-1.5">
        {label}
        {help && <InfoDot note={helpFor(help)} />}
      </span>
      <Input
        type="number"
        step="any"
        min={0}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
      />
      {hint && <p className="mt-1 text-xs text-faint">{hint}</p>}
    </label>
  )
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="label block">{label}</span>
      <span className="tabular-nums text-primary">{value}</span>
    </div>
  )
}
