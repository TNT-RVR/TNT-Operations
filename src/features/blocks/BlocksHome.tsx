import { useEffect, useMemo, useState } from 'react'
import { PageHeader, Select, StatTile, EmptyState, ProgressBar } from '@/components/ui'
import { useData } from '@/data/context'
import { seasonSummary, returnsByField, seasonsOf, lbsToKgWeight, proposeLotFromReturns } from '@/domain/blocks'

const lbs = (v: number | null) => (v == null ? '—' : `${v.toFixed(1)} lbs`)
const both = (v: number | null) => {
  if (v == null) return '—'
  const kg = lbsToKgWeight(v)
  return `${v.toFixed(1)} lbs (${kg!.toFixed(1)} kg)`
}

/** Season overview: where every block is, and what each field returned. */
export default function BlocksHome() {
  const { fields, blockPlacements, blocksLoading, loadBlocks, blockSeasons, samples, createLotFromReturns } = useData()
  const [season, setSeason] = useState<number | null>(null)

  // The season list comes from the index, so it is right before any placement
  // is loaded; the placements themselves are fetched a season at a time.
  const seasons = useMemo(
    () => (blockSeasons.length ? blockSeasons.map((s) => s.season) : seasonsOf(blockPlacements)),
    [blockSeasons, blockPlacements],
  )
  // Default to the current year, matching every other year filter in the app.
  const active = season ?? (seasons.includes(new Date().getFullYear()) ? new Date().getFullYear() : seasons[0])
  useEffect(() => {
    if (active != null) void loadBlocks(active)
  }, [loadBlocks, active])

  const forSeason = useMemo(
    () => blockPlacements.filter((p) => p.season === active),
    [blockPlacements, active],
  )

  const summary = useMemo(() => seasonSummary(forSeason), [forSeason])

  // Turning a field's returns into next season's lot. Confirmed rather than
  // one-click: it creates a record the incubation side then works from.
  const [lotFor, setLotFor] = useState<string | null>(null)
  const [lotBusy, setLotBusy] = useState(false)
  const [lotMsg, setLotMsg] = useState<{ ok: boolean; text: string } | null>(null)
  /** Lots already made from this season's returns, by field. */
  const lotByField = useMemo(() => {
    const m = new Map<string, (typeof samples)[number]>()
    for (const s of samples) {
      if (s.fieldId && s.harvestSeason === active) m.set(s.fieldId, s)
    }
    return m
  }, [samples, active])
  const byField = useMemo(() => returnsByField(forSeason), [forSeason])
  const fieldName = (id: string | null) => fields.find((f) => f.id === id)?.name ?? 'Unassigned'

  const done = summary.blocks > 0 ? Math.round((summary.weighedOut / summary.blocks) * 100) : 0

  return (
    <div>
      <PageHeader
        title="Blocks"
        subtitle="Nesting blocks — placed in the field, weighed in full, then weighed out empty"
        actions={
          seasons.length > 0 ? (
            <Select value={active ?? ''} onChange={(e) => setSeason(Number(e.target.value))} className="w-32">
              {seasons.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          ) : null
        }
      />

      <div className="space-y-4 p-4 md:p-6">
        {blocksLoading && <p className="text-sm text-muted">Loading blocks…</p>}

        {!blocksLoading && summary.blocks === 0 && (
          <EmptyState>No blocks placed in {active ?? 'this season'} yet. Start on the Scan tab.</EmptyState>
        )}

        {summary.blocks > 0 && (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatTile label="Blocks out" value={summary.blocks} hint={`Season ${active}`} />
              <StatTile label="In field" value={summary.placed} tone={summary.placed > 0 ? 'warn' : 'default'} />
              <StatTile label="Weighed in" value={summary.weighedIn} hint="Full weight taken" />
              <StatTile label="Weighed out" value={summary.weighedOut} tone="good" hint="Cycle complete" />
            </div>

            <div className="card">
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="font-bold">Bee returns</h2>
                <span className="text-sm text-muted">{done}% of blocks weighed out</span>
              </div>
              <ProgressBar pct={done} tone={done === 100 ? 'green' : 'brand'} />
              <dl className="mt-4 grid grid-cols-2 gap-4">
                <div>
                  <dt className="text-sm text-muted">Total recovered</dt>
                  <dd className="text-xl font-bold">{both(summary.totalReturnLbs)}</dd>
                </div>
                <div>
                  <dt className="text-sm text-muted">Average per block</dt>
                  <dd className="text-xl font-bold">{both(summary.avgReturnLbs)}</dd>
                  {/* Say what the average is over, so a part-done season isn't misread. */}
                  <p className="text-xs text-faint">
                    over {byField.reduce((n, r) => n + r.weighed, 0)} block
                    {byField.reduce((n, r) => n + r.weighed, 0) === 1 ? '' : 's'} with both weights
                  </p>
                </div>
              </dl>
            </div>

            <div className="card">
              <h2 className="mb-3 font-bold">By field</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-default text-left text-muted">
                      <th className="py-2 pr-3 font-medium">Field</th>
                      <th className="py-2 pr-3 text-right font-medium">Blocks</th>
                      <th className="py-2 pr-3 text-right font-medium">Weighed</th>
                      <th className="py-2 pr-3 text-right font-medium">Total return</th>
                      <th className="py-2 pr-3 text-right font-medium">Avg / block</th>
                      <th className="py-2 text-right font-medium">Next season's lot</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byField.map((r) => (
                      <tr key={r.fieldId ?? 'none'} className="border-b border-default/50">
                        <td className="py-2 pr-3 font-medium">{fieldName(r.fieldId)}</td>
                        <td className="py-2 pr-3 text-right">{r.blocks}</td>
                        <td className="py-2 pr-3 text-right text-muted">
                          {r.weighed}/{r.blocks}
                        </td>
                        <td className="py-2 pr-3 text-right font-semibold">{lbs(r.totalReturnLbs)}</td>
                        <td className="py-2 pr-3 text-right">{lbs(r.avgReturnLbs)}</td>
                        <td className="py-2 text-right">
                          {(() => {
                            const made = r.fieldId ? lotByField.get(r.fieldId) : undefined
                            const { lot, problem } = proposeLotFromReturns(
                              r,
                              fieldName(r.fieldId),
                              active ?? new Date().getFullYear(),
                            )
                            // A field with nothing weighed says why, quietly —
                            // most of the table is in that state mid-season and
                            // a row of red buttons would just be noise.
                            if (!lot) return <span className="text-xs text-faint">{problem ? '—' : ''}</span>
                            return (
                              <button
                                className="text-xs text-brand underline"
                                onClick={() => setLotFor(r.fieldId)}
                              >
                                {made ? 'Update lot' : 'Create lot'}
                              </button>
                            )
                          })()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {lotMsg && (
                <p className={`mt-3 text-sm ${lotMsg.ok ? 'text-green-600' : 'text-danger'}`}>
                  {lotMsg.text}
                </p>
              )}

              {/* Confirmed, not one-click: this creates the record the whole
                  incubation side then works from, and it carries a weight
                  people will act on a year later. */}
              {lotFor &&
                (() => {
                  const row = byField.find((r) => r.fieldId === lotFor)
                  if (!row) return null
                  const name = fieldName(lotFor)
                  const season = active ?? new Date().getFullYear()
                  const { lot, warning } = proposeLotFromReturns(row, name, season)
                  if (!lot) return null
                  const made = lotByField.get(lotFor)
                  return (
                    <div className="mt-3 rounded-sm border border-default bg-inset p-3">
                      <p className="text-sm font-medium text-primary">
                        {made ? `Update “${made.name}”?` : `Create “${lot.name}”?`}
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        {lbs(lot.totalWeightLbs)} of bee returns from {name}, harvested {season} —
                        the lot that goes back out in {season + 1}.
                        {made && ' Only the weight and notes change; grading and trays are left alone.'}
                      </p>
                      {warning && <p className="mt-1 text-xs text-amber-600">{warning}</p>}
                      <div className="mt-2 flex gap-2">
                        <button
                          className="btn-primary px-3 py-1.5 text-sm"
                          disabled={lotBusy}
                          onClick={async () => {
                            setLotBusy(true)
                            setLotMsg(null)
                            const r = await createLotFromReturns(lot)
                            setLotBusy(false)
                            setLotFor(null)
                            setLotMsg(
                              r.ok
                                ? { ok: true, text: `${lot.name} ${r.created ? 'created' : 'updated'} — it's on the Samples tab.` }
                                : { ok: false, text: r.error ?? 'Could not save the lot.' },
                            )
                          }}
                        >
                          {made ? 'Update lot' : 'Create lot'}
                        </button>
                        <button className="btn-ghost px-3 py-1.5 text-sm" onClick={() => setLotFor(null)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )
                })()}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
