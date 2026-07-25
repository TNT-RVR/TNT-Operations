import { useMemo, useState } from 'react'
import { PageHeader, StatTile, Badge, EmptyState, Modal } from '@/components/ui'
import { useData } from '@/data/context'
import { calcSampleSummary, formatDays, daysFromNow, BATCH_EVENT_FIELDS } from '@/domain/incubation'
import type { Sample, Tray, IncubationBatch } from '@/data/types'

const num = (v: number | null | undefined, digits = 0) =>
  v == null ? '—' : v.toLocaleString('en-CA', { minimumFractionDigits: digits, maximumFractionDigits: digits })

/** x-ray live can be stored as a fraction (0.86) or a percent (86); normalise. */
const liveFraction = (v: number | null) => (v == null ? null : v > 1 ? v / 100 : v)
const pct = (v: number | null) => {
  const f = liveFraction(v)
  return f == null ? '—' : `${Math.round(f * 100)}%`
}

export default function SamplesHome() {
  const { samples, trays, batches } = useData()
  const [openSample, setOpenSample] = useState<Sample | null>(null)

  // tray counts per sample (there are thousands of trays, so index once).
  const traysBySample = useMemo(() => {
    const m = new Map<string, Tray[]>()
    for (const t of trays) {
      if (!t.sampleId) continue
      const list = m.get(t.sampleId)
      if (list) list.push(t)
      else m.set(t.sampleId, [t])
    }
    return m
  }, [trays])

  const activeBatches = batches.filter((b) => b.status !== 'released' && b.status !== 'complete')

  return (
    <div>
      <PageHeader title="Samples & Trays" subtitle="Bee lots, x-ray grading, and tray allocation" />
      <div className="space-y-6 p-4 md:p-6">
        {/* Totals */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile label="Samples" value={samples.length} />
          <StatTile label="Trays" value={num(trays.length)} hint="all statuses" />
          <StatTile label="Batches" value={batches.length} hint={`${activeBatches.length} active`} />
          <StatTile
            label="Graded samples"
            value={samples.filter((s) => s.xrayLivePct != null).length}
            hint="have x-ray data"
          />
        </div>

        {/* Batches */}
        <section>
          <h2 className="mb-2 font-semibold">Batches</h2>
          {batches.length === 0 ? (
            <EmptyState>No incubation batches recorded yet.</EmptyState>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {batches.map((b) => (
                <BatchCard key={b.id} batch={b} />
              ))}
            </div>
          )}
        </section>

        {/* Samples table */}
        <section>
          <h2 className="mb-2 font-semibold">Samples</h2>
          {samples.length === 0 ? (
            <EmptyState>No samples yet.</EmptyState>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <th className="px-3 py-2">Sample</th>
                    <th className="px-3 py-2">Source</th>
                    <th className="px-3 py-2 text-right">Live %</th>
                    <th className="px-3 py-2 text-right">Weight (lb)</th>
                    <th className="px-3 py-2 text-right">Bees/lb</th>
                    <th className="px-3 py-2 text-right">Trays</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {samples.map((s) => {
                    const trayCount = traysBySample.get(s.id)?.length ?? 0
                    return (
                      <tr
                        key={s.id}
                        className="cursor-pointer hover:bg-slate-50"
                        onClick={() => setOpenSample(s)}
                      >
                        <td className="px-3 py-2 font-medium text-slate-800">{s.name}</td>
                        <td className="px-3 py-2 text-slate-500">{s.source || '—'}</td>
                        <td className="px-3 py-2 text-right">{pct(s.xrayLivePct)}</td>
                        <td className="px-3 py-2 text-right">{num(s.totalWeightLbs)}</td>
                        <td className="px-3 py-2 text-right">{num(s.liveBeesPerLb)}</td>
                        <td className="px-3 py-2 text-right">
                          {trayCount > 0 ? num(trayCount) : <span className="text-slate-400">—</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {openSample && (
        <SampleDetail sample={openSample} trays={traysBySample.get(openSample.id) ?? []} onClose={() => setOpenSample(null)} />
      )}
    </div>
  )
}

function BatchCard({ batch }: { batch: IncubationBatch }) {
  const now = new Date()
  return (
    <div className="card">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="font-bold">{batch.name}</h3>
        <Badge tone={batch.status === 'active' ? 'green' : 'brand'}>{batch.status}</Badge>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {BATCH_EVENT_FIELDS.map(([field, label]) => {
          const date = batch[field as keyof IncubationBatch] as string | null
          if (!date) return null
          return (
            <div key={label} className="flex justify-between gap-2">
              <dt className="text-slate-500">{label}</dt>
              <dd className="text-slate-800">{formatDays(daysFromNow(date, now))}</dd>
            </div>
          )
        })}
      </dl>
    </div>
  )
}

function SampleDetail({ sample: s, trays, onClose }: { sample: Sample; trays: Tray[]; onClose: () => void }) {
  const frac = liveFraction(s.xrayLivePct)
  const derived =
    s.totalVolumeGal != null && frac != null && frac > 0 ? calcSampleSummary(s.totalVolumeGal, frac) : null

  const rows: Array<[string, string]> = [
    ['Source', s.source || '—'],
    ['Lot number', s.lotNumber || '—'],
    ['X-ray live', pct(s.xrayLivePct)],
    ['X-ray parasite', pct(s.xrayParasitePct)],
    ['Total volume', s.totalVolumeGal != null ? `${num(s.totalVolumeGal, 1)} gal` : '—'],
    ['Total weight', s.totalWeightLbs != null ? `${num(s.totalWeightLbs)} lb` : '—'],
    ['Live bees/lb', num(s.liveBeesPerLb)],
    ['Recorded trays', s.totalTrays != null ? num(s.totalTrays) : '—'],
    ['Trays in system', trays.length ? num(trays.length) : '—'],
  ]

  return (
    <Modal title={s.name} onClose={onClose} wide>
      <div className="space-y-4">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2 border-b border-slate-100 py-1">
              <dt className="text-slate-500">{k}</dt>
              <dd className="font-medium text-slate-800">{v}</dd>
            </div>
          ))}
        </dl>

        {derived && (
          <div className="rounded-lg bg-slate-50 p-3 text-sm">
            <div className="mb-1 font-semibold">Derived tray math</div>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-slate-700">
              <span>Live gal: {num(derived.liveGalsTotal, 1)}</span>
              <span>Fills ~{num(derived.trayCount)} trays</span>
              <span>Raw {num(derived.rawLbsPerTray, 2)} lb/tray</span>
            </div>
          </div>
        )}

        {s.notes && <p className="text-sm text-slate-600">{s.notes}</p>}
      </div>
    </Modal>
  )
}
