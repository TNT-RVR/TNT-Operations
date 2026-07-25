import { PageHeader, StatTile, Badge, Gauge } from '@/components/ui'
import { useData } from '@/data/context'
import { incubationProgress, incubatorDisplay } from '@/domain/incubation'

export default function Dashboard() {
  const { fields, incubators, latestReading } = useData()
  const now = new Date().toISOString()

  const running = incubators.filter((i) => incubatorDisplay(i).running)
  const incubating = incubators.filter((i) => i.tempMode === 'incubation')
  const shelters = fields.reduce((s, f) => s + f.shelterCount, 0)

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="TNT Operations — pollination overview" />
      <div className="space-y-6 p-4 md:p-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile label="Running incubators" value={running.length} hint={`${incubators.length} total`} tone="good" />
          <StatTile label="Incubating" value={incubating.length} hint="in incubation mode" />
          <StatTile label="Fields mapped" value={fields.length} hint={`${shelters} shelters placed`} />
          <StatTile label="Incubators" value={incubators.length} hint="on the backend" />
        </div>

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
