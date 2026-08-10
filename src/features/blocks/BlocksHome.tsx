import { useEffect, useMemo, useState } from 'react'
import { PageHeader, Select, StatTile, EmptyState, ProgressBar } from '@/components/ui'
import { useData } from '@/data/context'
import { seasonSummary, returnsByField, seasonsOf, lbsToKgWeight } from '@/domain/blocks'

const lbs = (v: number | null) => (v == null ? '—' : `${v.toFixed(1)} lbs`)
const both = (v: number | null) => {
  if (v == null) return '—'
  const kg = lbsToKgWeight(v)
  return `${v.toFixed(1)} lbs (${kg!.toFixed(1)} kg)`
}

/** Season overview: where every block is, and what each field returned. */
export default function BlocksHome() {
  const { fields, blockPlacements, blocksLoading, loadBlocks, blockSeasons } = useData()
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
  const byField = useMemo(() => returnsByField(forSeason), [forSeason])
  const fieldName = (id: string | null) => fields.find((f) => f.id === id)?.name ?? 'Unassigned'

  const done = summary.blocks > 0 ? Math.round((summary.stripped / summary.blocks) * 100) : 0

  return (
    <div>
      <PageHeader
        title="Blocks"
        subtitle="Nesting blocks — placed in the field, retrieved, stripped, and weighed for returns"
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
              <StatTile label="Retrieved" value={summary.retrieved} hint="Weighed full" />
              <StatTile label="Stripped" value={summary.stripped} tone="good" hint="Cycle complete" />
            </div>

            <div className="card">
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="font-bold">Bee returns</h2>
                <span className="text-sm text-muted">{done}% of blocks stripped</span>
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
                    over {summary.stripped} weighed block{summary.stripped === 1 ? '' : 's'}
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
                      <th className="py-2 text-right font-medium">Avg / block</th>
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
                        <td className="py-2 text-right">{lbs(r.avgReturnLbs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
