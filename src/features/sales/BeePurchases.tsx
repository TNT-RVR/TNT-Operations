/**
 * Bee purchases: total spend, total gallons, and what a gallon actually cost.
 *
 * Two sources in one list — synced weekly from QuickBooks, and previous
 * seasons typed in by hand. See `src/domain/beePurchases.ts` for the season
 * rule (December to May straddles the new year) and for why a line with no
 * stated volume is reported rather than counted as zero.
 */
import { useEffect, useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useData } from '@/data/context'
import { useSession } from '@/auth/session'
import { Badge, Button, EmptyState, Input, Modal, Select, Stat } from '@/components/ui'
import {
  activeSeason,
  bySeason,
  gallonsFromUnitPrice,
  priceChange,
  pricePerGallonSeries,
  seasonOf,
  totalsFor,
  unitPriceOf,
  visible,
  type BeePurchase,
} from '@/domain/beePurchases'
import { AXIS_PROPS, GRID_PROPS, TOOLTIP_LABEL_STYLE, TOOLTIP_STYLE, seriesColor } from '@/features/analysis/chartTheme'
import { SalesChrome, fmtMoney, fmtNum } from './SalesChrome'

const money = (n: number, ccy = 'CAD') => fmtMoney(n, ccy)

export default function BeePurchases() {
  const { beePurchases, addBeePurchase, saveBeePurchase, deleteBeePurchase, syncBeePurchases } = useData()
  const s = useSession()
  const canEdit = s.can('sales', 'edit')

  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState('')
  /**
   * Which season to pull.
   *
   * Defaults to the season with buying in it, NOT the calendar-current one. A
   * season is named for the year it ends in, so from June to November
   * `seasonOf(today)` names a season whose December has not arrived — pulling
   * it reads an empty window and reports "0 lines", which looks like a broken
   * integration rather than an empty one.
   */
  const [pullSeason, setPullSeason] = useState(() => activeSeason(new Date().toISOString().slice(0, 10)))
  const [showExcluded, setShowExcluded] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  // Every figure on this page is computed from the VISIBLE rows. Excluded ones
  // stay in the list so they can be seen and put back, but count for nothing.
  const shown = useMemo(() => visible(beePurchases), [beePurchases])
  const excluded = useMemo(() => beePurchases.filter((p) => p.excludedAt), [beePurchases])
  const seasons = useMemo(() => bySeason(shown), [shown])
  const all = useMemo(() => totalsFor(shown), [shown])
  const series = useMemo(() => pricePerGallonSeries(shown), [shown])
  const change = useMemo(() => priceChange(shown), [shown])
  const latest = seasons[0]

  /**
   * Remove a row from the app.
   *
   * A hand-typed row is deleted outright — nothing recreates it. A synced row
   * is EXCLUDED instead, because deleting it would work only until Monday: the
   * weekly upsert would put it back on its own, days later, with no trace of
   * what happened. Neither path touches QuickBooks.
   */
  const remove = async (p: BeePurchase) => {
    setError('')
    setMsg('')
    const r =
      p.source === 'manual'
        ? await deleteBeePurchase(p.id)
        : await saveBeePurchase(p.id, { excludedAt: new Date().toISOString() })
    if (!r.ok) return setError(r.error ?? 'Could not remove that row.')
    setMsg(
      p.source === 'manual'
        ? 'Row deleted.'
        : 'Removed from the app. The bill is untouched in QuickBooks, and the weekly sync will leave it out.',
    )
  }

  const restore = async (p: BeePurchase) => {
    const r = await saveBeePurchase(p.id, { excludedAt: null })
    if (!r.ok) setError(r.error ?? 'Could not restore that row.')
  }

  const sync = async () => {
    setBusy('sync')
    setError('')
    setMsg('')
    const r = await syncBeePurchases(pullSeason)
    setBusy('')
    if (!r.ok) return setError(r.error ?? 'Could not sync.')
    const n = r.lines ?? 0
    setMsg(
      n === 0
        ? // Naming the season is the whole point: "Synced 0 lines" gave no clue
          // that the window being read was one with no buying in it yet.
          `Season ${pullSeason} (June ${pullSeason - 1} – May ${pullSeason}) had no lines in that QuickBooks account. ` +
          `Check the account mapping, or pick a different season.`
        : `Season ${pullSeason}: synced ${n} line${n === 1 ? '' : 's'}` +
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
            <label className="flex items-center gap-2 text-xs text-muted">
              Season
              <Select
                className="w-24"
                value={String(pullSeason)}
                onChange={(e) => setPullSeason(Number(e.target.value))}
              >
                {Array.from({ length: 8 }, (_, i) => seasonOf(new Date().toISOString().slice(0, 10)) - i).map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </Select>
            </label>
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

      {shown.length === 0 && excluded.length === 0 ? (
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
                      <Row key={p.id} p={p} canEdit={canEdit} onSave={saveBeePurchase} onRemove={remove} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          {/*
            Nothing vanishes silently. An excluded row is still a real
            transaction in the books, so it stays listed — out of every total,
            and one click from coming back.
          */}
          {excluded.length > 0 && (
            <div>
              <button
                className="text-xs text-muted hover:text-primary"
                onClick={() => setShowExcluded((v) => !v)}
              >
                {showExcluded ? 'Hide' : 'Show'} {excluded.length} removed row{excluded.length === 1 ? '' : 's'}
              </button>
              {showExcluded && (
                <div className="card mt-2 p-0">
                  <table className="w-full text-sm">
                    <tbody>
                      {excluded.map((p) => (
                        <tr key={p.id} className="border-t border-subtle first:border-t-0">
                          <td className="px-3 py-2 tabular-nums text-muted">{p.date}</td>
                          <td className="px-3 py-2 text-muted">{p.vendor || '—'}</td>
                          <td className="px-3 py-2 text-xs text-faint">{p.description || '—'}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted">
                            {money(p.amount, p.currency)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {canEdit && (
                              <Button variant="ghost" onClick={() => void restore(p)}>
                                Restore
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="border-t border-subtle px-3 py-2 text-xs text-muted">
                    These are left out of every figure above. They are unchanged in QuickBooks.
                  </p>
                </div>
              )}
            </div>
          )}
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
  onRemove,
}: {
  p: BeePurchase
  canEdit: boolean
  onSave: (id: string, patch: Partial<BeePurchase>) => Promise<{ ok: boolean; error?: string }>
  onRemove: (p: BeePurchase) => Promise<void>
}) {
  const [gallons, setGallons] = useState(p.gallons === null ? '' : String(p.gallons))
  const perGal = unitPriceOf(p)
  /**
   * The unit price, editable.
   *
   * Two ways into the same fact: state the gallons, or state what a gallon
   * cost. Whichever you type, the OTHER is derived and the amount is left
   * alone — it is real money that reconciles against QuickBooks.
   */
  const [price, setPrice] = useState(perGal === null ? '' : perGal.toFixed(2))

  // Follow the row when the other field changes it, or a sync rewrites it.
  useEffect(() => {
    setGallons(p.gallons === null ? '' : String(p.gallons))
    setPrice(perGal === null ? '' : perGal.toFixed(2))
  }, [p.gallons, perGal])

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
      <td className="px-3 py-2 text-right">
        {canEdit ? (
          <Input
            className="w-24 text-right tabular-nums"
            value={price}
            inputMode="decimal"
            placeholder="—"
            title="What a gallon cost. Typing this sets the gallons; the amount is left alone."
            onChange={(e) => setPrice(e.target.value)}
            onBlur={() => {
              const typed = price.trim()
              // Cleared: the volume goes back to unknown rather than to zero.
              if (typed === '') {
                if (p.gallons !== null) void onSave(p.id, { gallons: null })
                return
              }
              const next = gallonsFromUnitPrice(p.amount, Number(typed))
              // Refused (zero, negative, unparseable): snap back rather than
              // write a nonsense volume derived from it.
              if (next === null) return setPrice(perGal === null ? '' : perGal.toFixed(2))
              if (next !== p.gallons) void onSave(p.id, { gallons: next })
            }}
          />
        ) : (
          <span className="tabular-nums text-secondary">
            {perGal === null ? <span className="text-warn">—</span> : money(perGal, p.currency)}
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        {canEdit && (
          <button
            className="rounded p-1 text-faint hover:text-danger"
            title={
              p.source === 'manual'
                ? 'Delete this row. You typed it, so nothing will bring it back.'
                : 'Remove from the app. The bill stays in QuickBooks, and the weekly sync will not bring it back.'
            }
            onClick={() => void onRemove(p)}
          >
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
