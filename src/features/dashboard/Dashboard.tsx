import { PageHeader, StatTile, Badge } from '@/components/ui'
import { useData } from '@/data/context'
import { incubationProgress } from '@/domain/incubation'

export default function Dashboard() {
  const { fields, incubators, inspections, readings } = useData()
  const now = new Date().toISOString()

  const active = incubators.filter((i) => i.status === 'active')
  const avgHealth =
    inspections.length > 0 ? Math.round(inspections.reduce((s, i) => s + i.healthScore, 0) / inspections.length) : 0
  const shelters = fields.reduce((s, f) => s + f.shelterCount, 0)

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="TNT Operations — pollination overview" />
      <div className="space-y-6 p-4 md:p-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile label="Active incubators" value={active.length} hint={`${incubators.length} total`} tone="good" />
          <StatTile label="Fields mapped" value={fields.length} hint={`${shelters} shelters placed`} />
          <StatTile label="Avg health" value={`${avgHealth}%`} tone={avgHealth < 80 ? 'warn' : 'good'} />
          <StatTile label="Live readings" value={readings.length} hint="last 24h (demo)" />
        </div>

        <section className="card">
          <h2 className="mb-3 font-bold">Incubation batches</h2>
          <div className="space-y-3">
            {active.map((i) => {
              const p = incubationProgress(i.startedAt, now)
              return (
                <div key={i.id} className="flex items-center gap-3">
                  <div className="w-32 shrink-0 text-sm font-medium">{i.name}</div>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full bg-brand" style={{ width: `${p.pct}%` }} />
                  </div>
                  <div className="w-40 shrink-0 text-right text-xs text-slate-500">
                    {p.pct}% · <Badge tone={p.stage === 'emergence' ? 'amber' : 'green'}>{p.stage}</Badge>
                  </div>
                </div>
              )
            })}
            {active.length === 0 && <p className="text-sm text-slate-500">No active batches.</p>}
          </div>
        </section>
      </div>
    </div>
  )
}
