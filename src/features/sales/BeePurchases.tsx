/**
 * Bee purchases: total spend, total gallons, and what a gallon actually cost.
 *
 * Two sources in one list — synced weekly from QuickBooks, and previous
 * seasons typed in by hand. See `src/domain/beePurchases.ts` for the season
 * rule (December to May straddles the new year) and for why a line with no
 * stated volume is reported rather than counted as zero.
 */
import { useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useData } from '@/data/context'
import { useSession } from '@/auth/session'
import { Badge, Button, EmptyState, Input, Modal, Stat } from '@/components/ui'
import { bySeason, priceChange, pricePerGallonSeries, seasonOf, totalsFor, type BeePurchase } from '@/domain/beePurchases'
import { AXIS_PROPS, GRID_PROPS, TOOLTIP_LABEL_STYLE, TOOLTIP_STYLE, seriesColor } from '@/features/analysis/chartTheme'
import { SalesChrome, fmtMoney, fmtNum } from './SalesChrome'

const money = (n: number, ccy = 'CAD') => fmtMoney(n, ccy)

export default function BeePurchases() {
  const { beePurchases, addBeePurchase, saveBeePurchase, deleteBeePurchase, syncBeePurchases } = useData()
  const s = useSession()
  const canEdit = s.can('sales', 'edit')

  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  const seasons = useMemo(() => bySeason(beePurchases), [beePurchases])
  const all = useMemo(() => totalsFor(beePurchases), [beePurchases])
  const series = useMemo(() => pricePerGallonSeries(beePurchases), [beePurchases])
  const change = useMemo(() => priceChange(beePurchases), [beePurchases])
  const latest = seasons[0]

  const sync = async () => {
    setBusy('sync')
    setError('')
    setMsg('')
    const r = await syncBeePurchases()
    setBusy('')
    if (!r.ok) return setError(r.error ?? 'Could not sync.')
    setMsg(
      `Synced ${r.lines ?? 0} line${r.lines === 1 ? '' : 's'}` +
        (r.linesWithoutGallons ? ` — ${r.linesWithoutGallons} with no gallons in the description.` : '.'),
    )
  }

  return (
    <SalesChrome
      title="Bee purchases"
      subtitle="What the bees cost, per season and per gallon. Synced weekly from QuickBooks."
      actions={
        canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={sync} disabled={!!busy}>
              <RefreshCw size={16} /> {busy === 'sync' ? 'Syncing…' : 'Sync now'}
            </Button>
            <Button onClick={() => setAdding(true)}>
              <Plus size={16} /> Add purchase
            </Button>
          </div>
        ) : undefined
      }
    >
      {error && <div className="mb-3 rounded border border-danger/40 p-3 text-sm text-danger">{error}</div>}
      {msg && !error && <div className="mb-3 rounded border border-brand/40 bg-brand/10 p-3 text-sm text-primary">{msg}</div>}

      {beePurchases.length === 0 ? (
        <EmptyState>
          No purchases recorded yet. Sync from QuickBooks, or add previous seasons by hand.
        </EmptyState>
      ) : (
        <div className="space-y-5">
          {/* ── Headline ── */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label={`${latest.season} cost / gal`} value={latest.costPerGallon === null ? '—' : money(latest.costPerGallon)} />
            <Stat label={`${latest.season} gallons`} value={fmtNum(latest.gallons)} />
            <Stat label={`${latest.season} spend`} value={money(latest.amount)} />
            <Stat
              label="vs previous season"
              value={change ? `${change.change >= 0 ? '+' : ''}${(change.change * 100).toFixed(1)}%` : '—'}
            />
          </div>

          {/*
            Stated plainly rather than folded into the average. Every dollar on
            these lines is in the spend, but none of their volume is — so the
            price per gallon above is an over-estimate by exactly this much.
          */}
          {all.unknownGallonLines > 0 && (
            <p className="flex items-start gap-1.5 rounded border border-warn/40 bg-warn/10 p-3 text-xs text-warn">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>
                {all.unknownGallonLines} line{all.unknownGallonLines === 1 ? '' : 's'} ({money(all.unknownGallonAmount)}){' '}
                {all.unknownGallonLines === 1 ? 'states' : 'state'} no gallons in the description, so that spend is
                counted but its volume is not — the cost per gallon above reads high. Add the gallons to those rows to
                correct it.
              </span>
            </p>
          )}

          {/* ── Price history ── */}
          {series.length > 1 && (
            <div className="card">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">Cost per gallon</h3>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={series} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                    <CartesianGrid {...GRID_PROPS} />
                    <XAxis dataKey="season" {...AXIS_PROPS} />
                    <YAxis {...AXIS_PROPS} tickFormatter={(v) => `$${v}`} width={56} />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      labelStyle={TOOLTIP_LABEL_STYLE}
                      formatter={(v) => [money(Number(v)), 'Cost / gal'] as [string, string]}
                      labelFormatter={(l) => `Season ${l}`}
                    />
                    <Line
                      type="monotone"
                      dataKey="costPerGallon"
                      stroke={seriesColor(0)}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      activeDot={{ r: 5 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* ── Per season ── */}
          {seasons.map((season) => (
            <div key={season.season} className="card p-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-subtle px-4 py-3">
                <h3 className="font-display text-lg font-semibold text-primary">{season.season}</h3>
                <div className="flex flex-wrap gap-x-4 text-xs text-muted">
                  <span>{fmtNum(season.gallons)} gal</span>
                  <span>{money(season.amount)}</span>
                  <span className="text-secondary">
                    {season.costPerGallon === null ? 'no price' : `${money(season.costPerGallon)} / gal`}
                  </span>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="th text-left">Date</th>
                      <th className="th text-left">Vendor</th>
                      <th className="th text-left">Description</th>
                      <th className="th text-right">Gallons</th>
                      <th className="th text-right">Amount</th>
                      <th className="th text-right">$ / gal</th>
                      <th className="th" />
                    </tr>
                  </thead>
                  <tbody>
                    {season.purchases.map((p) => (
                      <Row key={p.id} p={p} canEdit={canEdit} onSave={saveBeePurchase} onDelete={deleteBeePurchase} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {adding && (
        <AddPurchase
          onClose={() => setAdding(false)}
          onSave={async (draft) => {
            const r = await addBeePurchase(draft)
            if (!r.ok) setError(r.error ?? 'Could not add that purchase.')
            setAdding(false)
          }}
        />
      )}
    </SalesChrome>
  )
}

function Row({
  p,
  canEdit,
  onSave,
  onDelete,
}: {
  p: BeePurchase
  canEdit: boolean
  onSave: (id: string, patch: Partial<BeePurchase>) => Promise<{ ok: boolean; error?: string }>
  onDelete: (id: string) => Promise<{ ok: boolean; error?: string }>
}) {
  const [gallons, setGallons] = useState(p.gallons === null ? '' : String(p.gallons))
  const perGal = p.gallons && p.gallons > 0 ? p.amount / p.gallons : null

  return (
    <tr className="border-t border-subtle">
      <td className="px-3 py-2 tabular-nums text-secondary">{p.date}</td>
      <td className="px-3 py-2 text-secondary">{p.vendor || '—'}</td>
      <td className="px-3 py-2 text-xs text-faint">
        {p.description || '—'}
        {p.source === 'manual' && <Badge tone="neutral">manual</Badge>}
      </td>
      <td className="px-3 py-2 text-right">
        {canEdit ? (
          // Editable in place: the commonest repair is a QuickBooks line whose
          // description never stated a volume, and making that a two-click fix
          // is what keeps the average honest.
          <Input
            className="w-24 text-right tabular-nums"
            value={gallons}
            inputMode="decimal"
            placeholder="—"
            onChange={(e) => setGallons(e.target.value)}
            onBlur={() => {
              const n = gallons.trim() === '' ? null : Number(gallons)
              const next = n !== null && Number.isFinite(n) && n > 0 ? n : null
              if (next !== p.gallons) void onSave(p.id, { gallons: next })
            }}
          />
        ) : (
          <span className="tabular-nums text-secondary">{p.gallons === null ? '—' : fmtNum(p.gallons)}</span>
        )}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-primary">{money(p.amount, p.currency)}</td>
      <td className="px-3 py-2 text-right tabular-nums text-secondary">
        {perGal === null ? <span className="text-warn">—</span> : money(perGal, p.currency)}
      </td>
      <td className="px-3 py-2 text-right">
        {canEdit && p.source === 'manual' && (
          <button className="rounded p-1 text-faint hover:text-danger" onClick={() => void onDelete(p.id)}>
            <Trash2 size={14} />
          </button>
        )}
      </td>
    </tr>
  )
}

function AddPurchase({
  onClose,
  onSave,
}: {
  onClose: () => void
  onSave: (draft: Partial<BeePurchase>) => Promise<void>
}) {
  const [date, setDate] = useState('')
  const [vendor, setVendor] = useState('')
  const [description, setDescription] = useState('')
  const [gallons, setGallons] = useState('')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)

  const amountN = Number(amount)
  const gallonsN = gallons.trim() === '' ? null : Number(gallons)
  const ready = Boolean(date) && Number.isFinite(amountN) && amountN > 0
  // Shown live, because the number people are checking as they type is this one.
  const perGal = gallonsN && gallonsN > 0 && Number.isFinite(amountN) ? amountN / gallonsN : null

  return (
    <Modal title="Add a purchase" onClose={onClose}>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">Date</span>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} autoFocus />
          </label>
          <label className="block">
            <span className="label">Vendor</span>
            <Input value={vendor} onChange={(e) => setVendor(e.target.value)} />
          </label>
          <label className="block">
            <span className="label">Gallons</span>
            <Input value={gallons} inputMode="decimal" onChange={(e) => setGallons(e.target.value)} />
          </label>
          <label className="block">
            <span className="label">Amount</span>
            <Input value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value)} />
          </label>
        </div>
        <label className="block">
          <span className="label">Description</span>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>

        <p className="text-xs text-muted">
          {date ? `Files under season ${seasonOf(date)}.` : 'Pick a date to see which season it files under.'}
          {perGal !== null && ` · ${money(perGal)} per gallon.`}
        </p>

        <div className="flex gap-2">
          <Button
            disabled={!ready || busy}
            onClick={async () => {
              setBusy(true)
              await onSave({
                date,
                vendor,
                description,
                gallons: gallonsN && gallonsN > 0 ? gallonsN : null,
                amount: amountN,
                season: seasonOf(date),
              })
              setBusy(false)
            }}
          >
            {busy ? 'Saving…' : 'Save'}
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {!ready && <span className="self-center text-xs text-muted">A date and an amount are needed.</span>}
        </div>
      </div>
    </Modal>
  )
}
