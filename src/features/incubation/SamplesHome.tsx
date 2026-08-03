import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader, StatTile, Badge, EmptyState, Modal } from '@/components/ui'
import { useData } from '@/data/context'
import {
  calcSampleSummary,
  formatDays,
  daysFromNow,
  BATCH_EVENT_FIELDS,
  trayYear,
  lbsToKg,
  perLbToPerKg,
} from '@/domain/incubation'
import type { Sample, Tray, IncubationBatch } from '@/data/types'

const num = (v: number | null | undefined, digits = 0) =>
  v == null ? '—' : v.toLocaleString('en-CA', { minimumFractionDigits: digits, maximumFractionDigits: digits })

/** x-ray live can be stored as a fraction (0.86) or a percent (86); normalise. */
const liveFraction = (v: number | null) => (v == null ? null : v > 1 ? v / 100 : v)
const pct = (v: number | null) => {
  const f = liveFraction(v)
  return f == null ? '—' : `${Math.round(f * 100)}%`
}

const ALL = '__all__'

type SampleSortKey =
  | 'name' | 'kg' | 'perKg' | 'parasites' | 'chalkbrood' | 'gal' | 'kg2gal' | 'expected' | 'actual' | 'space' | 'notes'

const SAMPLE_COLUMNS: Array<{ key: SampleSortKey; label: string; align?: 'right' }> = [
  { key: 'name', label: 'Name' },
  { key: 'kg', label: 'Total Kg', align: 'right' },
  { key: 'perKg', label: 'Live Bees/Kg', align: 'right' },
  { key: 'parasites', label: 'Parasites', align: 'right' },
  { key: 'chalkbrood', label: 'Chalkbrood', align: 'right' },
  { key: 'gal', label: 'Total Gal', align: 'right' },
  { key: 'kg2gal', label: 'Kg for 2gal', align: 'right' },
  { key: 'expected', label: 'Expected', align: 'right' },
  { key: 'actual', label: 'Actual', align: 'right' },
  { key: 'space', label: 'Inc. Space' },
  { key: 'notes', label: 'Notes' },
]

/** Flag a sample that filled fewer trays than the x-ray predicted. */
const shortfall = (expected: number | null, actual: number) => expected != null && actual < expected

/** Notes on one line — they're free text and can contain line breaks. */
const flattenNotes = (notes: string | null | undefined) =>
  (notes ?? '').split(/\s*[\r\n]+\s*/).join(' ').trim() || '—'

export default function SamplesHome() {
  const { samples, trays, batches, incubators } = useData()
  const [openSample, setOpenSample] = useState<Sample | null>(null)

  const incubatorName = useMemo(() => {
    const m = new Map<string, string>()
    for (const i of incubators) m.set(i.id, i.name)
    return m
  }, [incubators])

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

  // tray counts per incubator + status, for the Trays summary.
  const trayStats = useMemo(() => {
    const byIncubator = new Map<string, number>()
    const byStatus = new Map<string, number>()
    let unassigned = 0
    for (const t of trays) {
      if (t.incubatorId) byIncubator.set(t.incubatorId, (byIncubator.get(t.incubatorId) ?? 0) + 1)
      else unassigned++
      byStatus.set(t.status, (byStatus.get(t.status) ?? 0) + 1)
    }
    return { byIncubator, byStatus, unassigned }
  }, [trays])

  const [search, setSearch] = useState('')
  const [year, setYear] = useState(ALL)
  const [sortKey, setSortKey] = useState<SampleSortKey>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  function toggleSort(key: SampleSortKey) {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  /** Years a sample was actually used in, taken from its trays' dates. */
  const sampleYears = useMemo(() => {
    const ys = new Set<number>()
    for (const t of trays) {
      const y = trayYear(t)
      if (y != null) ys.add(y)
    }
    return [...ys].sort((a, b) => b - a)
  }, [trays])

  const visibleSamples = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rows = samples
      .filter((s) => {
        if (q && !s.name.toLowerCase().includes(q)) return false
        if (year !== ALL) {
          // Keep samples used by a tray started in the chosen year.
          const used = traysBySample.get(s.id) ?? []
          if (!used.some((t) => trayYear(t) === Number(year))) return false
        }
        return true
      })
      .map((s) => ({
        s,
        actual: (traysBySample.get(s.id) ?? []).length,
        expected: s.totalTrays == null ? null : Math.ceil(s.totalTrays),
      }))

    const dir = sortDir === 'asc' ? 1 : -1
    const val = (r: (typeof rows)[number]): string | number | null => {
      switch (sortKey) {
        case 'name': return r.s.name
        case 'kg': return lbsToKg(r.s.totalWeightLbs) ?? r.s.totalWeightKg
        case 'perKg': return r.s.liveBeesPerKg ?? perLbToPerKg(r.s.liveBeesPerLb)
        case 'parasites': return r.s.parasites
        case 'chalkbrood': return r.s.chalkbrood
        case 'gal': return r.s.totalVolumeGal
        case 'kg2gal': return r.s.kgPer2Gal ?? lbsToKg(r.s.lbsPer2Gal)
        case 'expected': return r.expected
        case 'actual': return r.actual
        case 'space': return r.s.incubatorSpace
        case 'notes': return r.s.notes || null
      }
    }
    return rows.sort((a, b) => {
      const av = val(a)
      const bv = val(b)
      // Blanks always sort last, like the desktop table.
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
      return String(av).localeCompare(String(bv)) * dir
    })
  }, [samples, trays, traysBySample, search, year, sortKey, sortDir])

  const withExpected = visibleSamples.filter((r) => r.expected != null).length
  const shortCount = visibleSamples.filter((r) => shortfall(r.expected, r.actual)).length

  const activeBatches = batches.filter((b) => b.status !== 'released' && b.status !== 'complete')

  return (
    <div>
      <PageHeader title="Samples" subtitle="Bee lots, x-ray grading, and tray allocation" />
      <div className="space-y-6 p-4 md:p-6">
        {/* Totals */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile label="Samples" value={samples.length} />
          <StatTile label="Trays" value={num(trays.length)} hint="all statuses" />
          <StatTile label="Batches" value={batches.length} hint={`${activeBatches.length} active`} />
          {/* Reconciliation, not a vanity count: which lots filled fewer trays
              than the x-ray predicted. (A "graded samples" tile keyed on
              xrayLivePct read 0 forever — no sample carries that field.) */}
          <StatTile
            label="Short of expected"
            value={shortCount}
            tone={shortCount > 0 ? 'warn' : 'good'}
            hint={`of ${withExpected} with an expected count`}
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

        {/* Samples table — mirrors the desktop app's "X-Ray results & sample
            records" chart: metric units, and Expected vs Actual trays. */}
        <section>
          <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
            <h2 className="font-semibold">Samples</h2>
            <div className="flex flex-wrap items-end gap-2">
              <input
                className="input w-40"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Sample name…"
              />
              <select
                className="rounded-sm border border-default bg-inset px-2 py-1.5 text-sm text-primary"
                value={year}
                onChange={(e) => setYear(e.target.value)}
              >
                <option value={ALL}>All years</option>
                {sampleYears.map((y) => (
                  <option key={y} value={String(y)}>
                    {y}
                  </option>
                ))}
              </select>
              <span className="font-mono text-xs text-faint">{visibleSamples.length} shown</span>
            </div>
          </div>
          {visibleSamples.length === 0 ? (
            <EmptyState>{samples.length === 0 ? 'No samples yet.' : 'No samples match.'}</EmptyState>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-subtle">
              <table className="w-full min-w-[880px] text-sm">
                <thead>
                  <tr className="border-b border-subtle bg-overlay text-left text-xs uppercase text-muted">
                    {SAMPLE_COLUMNS.map((c) => (
                      <th
                        key={c.key}
                        className={`cursor-pointer select-none px-3 py-2 hover:text-secondary ${
                          c.align === 'right' ? 'text-right' : ''
                        }`}
                        onClick={() => toggleSort(c.key)}
                      >
                        {c.label}
                        <span className="ml-1 inline-block w-3 text-faint">
                          {sortKey === c.key ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-subtle">
                  {visibleSamples.map(({ s, actual, expected }) => (
                    <tr
                      key={s.id}
                      className="cursor-pointer hover:bg-[color:var(--hover-wash)]"
                      onClick={() => setOpenSample(s)}
                    >
                      <td className="px-3 py-2 font-medium text-brand">{s.name}</td>
                      <td className="px-3 py-2 text-right">{num(lbsToKg(s.totalWeightLbs) ?? s.totalWeightKg, 1)}</td>
                      <td className="px-3 py-2 text-right">
                        {num(s.liveBeesPerKg ?? perLbToPerKg(s.liveBeesPerLb), 0)}
                      </td>
                      <td className="px-3 py-2 text-right">{num(s.parasites, 1)}</td>
                      <td className="px-3 py-2 text-right">{num(s.chalkbrood, 1)}</td>
                      <td className="px-3 py-2 text-right">{num(s.totalVolumeGal, 1)}</td>
                      <td className="px-3 py-2 text-right">{num(s.kgPer2Gal ?? lbsToKg(s.lbsPer2Gal), 2)}</td>
                      <td className="px-3 py-2 text-right">{expected == null ? '—' : expected}</td>
                      <td className={`px-3 py-2 text-right ${shortfall(expected, actual) ? 'text-danger' : ''}`}>
                        {actual}
                      </td>
                      <td className="px-3 py-2 text-muted">{s.incubatorSpace ?? '—'}</td>
                      <td className="px-3 py-2 text-muted">{flattenNotes(s.notes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Trays summary */}
        <section>
          <h2 className="mb-2 font-semibold">Trays</h2>
          {trays.length === 0 ? (
            <EmptyState>No trays recorded yet.</EmptyState>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2 text-xs">
                {[...trayStats.byStatus.entries()].map(([status, n]) => (
                  <Badge key={status} tone="brand">
                    {status}: {num(n)}
                  </Badge>
                ))}
              </div>
              <div className="overflow-x-auto rounded-lg border border-subtle">
                <table className="w-full min-w-[360px] text-sm">
                  <thead>
                    <tr className="border-b border-subtle bg-overlay text-left text-xs uppercase text-muted">
                      <th className="px-3 py-2">Incubator</th>
                      <th className="px-3 py-2 text-right">Trays</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-subtle">
                    {[...trayStats.byIncubator.entries()]
                      .sort((a, b) => b[1] - a[1])
                      .map(([incId, n]) => (
                        <tr key={incId}>
                          <td className="px-3 py-2 text-primary">{incubatorName.get(incId) ?? 'Unknown incubator'}</td>
                          <td className="px-3 py-2 text-right">{num(n)}</td>
                        </tr>
                      ))}
                    {trayStats.unassigned > 0 && (
                      <tr>
                        <td className="px-3 py-2 text-faint">Unassigned</td>
                        <td className="px-3 py-2 text-right">{num(trayStats.unassigned)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-faint">
                Open a sample to see its individual trays, or view the{' '}
                <Link to="/incubation/trays" className="font-medium text-brand hover:underline">
                  full filterable Trays list
                </Link>
                .
              </p>
            </div>
          )}
        </section>
      </div>

      {openSample && (
        <SampleDetail
          sample={openSample}
          trays={traysBySample.get(openSample.id) ?? []}
          incubatorName={incubatorName}
          onClose={() => setOpenSample(null)}
        />
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
              <dt className="text-muted">{label}</dt>
              <dd className="text-primary">{formatDays(daysFromNow(date, now))}</dd>
            </div>
          )
        })}
      </dl>
    </div>
  )
}

function SampleDetail({
  sample: s,
  trays,
  incubatorName,
  onClose,
}: {
  sample: Sample
  trays: Tray[]
  incubatorName: Map<string, string>
  onClose: () => void
}) {
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
            <div key={k} className="flex justify-between gap-2 border-b border-subtle py-1">
              <dt className="text-muted">{k}</dt>
              <dd className="font-medium text-primary">{v}</dd>
            </div>
          ))}
        </dl>

        {derived && (
          <div className="rounded-lg bg-overlay p-3 text-sm">
            <div className="mb-1 font-semibold">Derived tray math</div>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-secondary">
              <span>Live gal: {num(derived.liveGalsTotal, 1)}</span>
              <span>Fills ~{num(derived.trayCount)} trays</span>
              <span>Raw {num(derived.rawLbsPerTray, 2)} lb/tray</span>
            </div>
          </div>
        )}

        {s.notes && <p className="text-sm text-secondary">{s.notes}</p>}

        {/* Individual trays for this sample */}
        <section>
          <h3 className="mb-2 font-semibold">Trays ({num(trays.length)})</h3>
          {trays.length === 0 ? (
            <p className="text-sm text-muted">No trays linked to this sample.</p>
          ) : (
            <div className="max-h-64 overflow-y-auto rounded-lg border border-subtle">
              <table className="w-full min-w-[420px] text-sm">
                <thead className="sticky top-0">
                  <tr className="border-b border-subtle bg-overlay text-left text-xs uppercase text-muted">
                    <th className="px-3 py-2">Tray</th>
                    <th className="px-3 py-2">Incubator</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-right">Weight (lb)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-subtle">
                  {trays.map((t) => (
                    <tr key={t.id}>
                      <td className="px-3 py-1.5 font-medium text-primary">{t.trayNumber}</td>
                      <td className="px-3 py-1.5 text-muted">
                        {t.incubatorId ? incubatorName.get(t.incubatorId) ?? '—' : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-muted">{t.status}</td>
                      <td className="px-3 py-1.5 text-right">{num(t.weightLbs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </Modal>
  )
}
