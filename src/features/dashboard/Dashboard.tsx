import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader, StatTile, Badge, Gauge, EmptyState } from '@/components/ui'
import { useData } from '@/data/context'
import { useSession } from '@/auth/session'
import { incubationProgress, incubatorDisplay } from '@/domain/incubation'
import { BoundaryMap } from '@/features/maps/BoundaryMap'
import { HomeTiles } from './HomeTiles'

export default function Dashboard() {
  const { fields, incubators, latestReading } = useData()
  const canSeeMaps = useSession().can('maps')
  const navigate = useNavigate()
  const now = new Date().toISOString()
  const season = String(new Date().getFullYear())

  /**
   * The fields to draw, and which season they are.
   *
   * This season by default. But a season starts with nothing mapped in it, and
   * a blank panel for months reads as broken rather than as "not planned yet" —
   * so with no fields stamped for this year it falls back to the newest year
   * that has some, and the heading says which year it is showing. A field with
   * no year at all is unplaced work rather than a field of some other season,
   * so it never appears.
   */
  const { shown, shownSeason } = useMemo(() => {
    const drawable = fields.filter((f) => f.geometry && String(f.geometry.year ?? '').trim())
    const forYear = (y: string) => drawable.filter((f) => String(f.geometry?.year ?? '').trim() === y)
    const current = forYear(season)
    if (current.length > 0) return { shown: current, shownSeason: season }
    const newest = [...new Set(drawable.map((f) => String(f.geometry?.year ?? '').trim()))].sort().pop()
    return newest ? { shown: forYear(newest), shownSeason: newest } : { shown: [], shownSeason: season }
  }, [fields, season])

  const running = incubators.filter((i) => incubatorDisplay(i).running)
  const incubating = incubators.filter((i) => i.tempMode === 'incubation')
  const shelters = fields.reduce((s, f) => s + f.shelterCount, 0)

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="TNT Operations — pollination overview" />
      <div className="space-y-6 p-4 md:p-6">
        {/* Phone first: the shortcuts someone chose, before the read-outs. */}
        <HomeTiles />

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile label="Running incubators" value={running.length} hint={`${incubators.length} total`} tone="good" />
          <StatTile label="Incubating" value={incubating.length} hint="in incubation mode" />
          <StatTile label="Fields mapped" value={fields.length} hint={`${shelters} shelters placed`} />
          <StatTile label="Incubators" value={incubators.length} hint="on the backend" />
        </div>

        {canSeeMaps && (
          <section className="card">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 className="font-bold">Fields — {shownSeason}</h2>
              <span className="text-xs text-muted">
                {shown.length === 0
                  ? 'none mapped yet'
                  : `${shown.length} field${shown.length === 1 ? '' : 's'} · click one for its details` +
                    (shownSeason === season ? '' : ` · nothing mapped for ${season} yet`)}
              </span>
            </div>
            {shown.length === 0 ? (
              <EmptyState>No field carries a boundary yet.</EmptyState>
            ) : (
              <BoundaryMap fields={shown} onSelect={(id) => navigate(`/maps/field/${id}`)} />
            )}
          </section>
        )}

        <section className="card">
          <h2 className="mb-3 font-bold">Running incubators</h2>
          <div className="space-y-3">
            {running.map((i) => {
              const d = incubatorDisplay(i)
              const r = latestReading(i.id)
              const tempOut =
                r != null && d.tempMin != null && d.tempMax != null && (r.tempC < d.tempMin || r.tempC > d.tempMax)
              const p =
                i.tempMode === 'incubation' && i.incubationStart ? incubationProgress(i.incubationStart, now) : null
              return (
                <div key={i.id} className="flex items-center gap-3">
                  <div className="w-32 shrink-0 truncate text-sm font-medium">{i.name}</div>
                  {p ? (
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-overlay">
                      <div className="h-full bg-brand" style={{ width: `${p.pct}%` }} />
                    </div>
                  ) : (
                    <Gauge pct={0} tone="brand" />
                  )}
                  <div className="flex w-52 shrink-0 items-center justify-end gap-2 text-right text-xs text-muted">
                    <span className={tempOut ? 'font-semibold text-danger' : 'text-secondary'}>
                      {r ? `${r.tempC.toFixed(1)}°C` : '—'}
                    </span>
                    <Badge tone={i.tempMode === 'incubation' ? 'green' : 'blue'}>{d.modeLabel}</Badge>
                  </div>
                </div>
              )
            })}
            {running.length === 0 && <p className="text-sm text-muted">No incubators running.</p>}
          </div>
        </section>
      </div>
    </div>
  )
}
