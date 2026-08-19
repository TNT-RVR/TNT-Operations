import { useEffect, useMemo, useState } from 'react'
import { PageHeader, SearchBar, matchesQuery, Badge, EmptyState } from '@/components/ui'
import { useData } from '@/data/context'
import { useSession } from '@/auth/session'
import type { Tray } from '@/data/types'

/**
 * Bee lineage browser (spec Part 1.3): trace the physical chain
 *   sample → batch → incubator → tray → shelter → field (+ nesting blocks)
 * for any tray. Answers "which bees went where" across the season. Field-side
 * links (placed shelters, tray scans) are captured by crews in Field Mode.
 */

const TZ = 'America/Edmonton'
const fmtWhen = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-CA', { timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric' }) : '—'

export default function LineageHome() {
  const { trays, samples, batches, incubators, fields, placedShelters, shelterTrayLinks, nestingBlocks, linkTrayToShelter, loadTrays } =
    useData()
  // Trays aren't hydrated on mount (thousands of rows); this screen needs them.
  useEffect(() => {
    void loadTrays()
  }, [loadTrays])
  const s = useSession()
  const canEdit = s.can('incubation', 'edit')
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<Tray | null>(null)

  const sampleById = useMemo(() => new Map(samples.map((x) => [x.id, x])), [samples])
  const batchById = useMemo(() => new Map(batches.map((x) => [x.id, x])), [batches])
  const incById = useMemo(() => new Map(incubators.map((x) => [x.id, x])), [incubators])
  const fieldById = useMemo(() => new Map(fields.map((x) => [x.id, x])), [fields])
  const shelterById = useMemo(() => new Map(placedShelters.map((x) => [x.id, x])), [placedShelters])
  const linksByTray = useMemo(() => {
    const m = new Map<string, typeof shelterTrayLinks>()
    for (const l of shelterTrayLinks) {
      const arr = m.get(l.trayId) ?? []
      arr.push(l)
      m.set(l.trayId, arr)
    }
    return m
  }, [shelterTrayLinks])
  const blocksByShelter = useMemo(() => {
    const m = new Map<string, number>()
    for (const b of nestingBlocks) if (b.shelterId) m.set(b.shelterId, (m.get(b.shelterId) ?? 0) + 1)
    return m
  }, [nestingBlocks])

  const results = useMemo(() => {
    const list = trays.filter((t) => {
      const sample = t.sampleId ? sampleById.get(t.sampleId) : undefined
      const inc = t.incubatorId ? incById.get(t.incubatorId) : undefined
      return matchesQuery(q, t.trayNumber, sample?.name, sample?.lotNumber, inc?.name, t.status)
    })
    return list.slice(0, 100)
  }, [trays, q, sampleById, incById])

  const chain = useMemo(() => {
    if (!selected) return null
    const sample = selected.sampleId ? sampleById.get(selected.sampleId) : undefined
    const batch = selected.incubationBatchId ? batchById.get(selected.incubationBatchId) : undefined
    const inc = selected.incubatorId ? incById.get(selected.incubatorId) : undefined
    const links = linksByTray.get(selected.id) ?? []
    const shelters = links
      .map((l) => shelterById.get(l.shelterId))
      .filter(Boolean)
      .map((sh) => ({
        shelter: sh!,
        field: sh!.fieldId ? fieldById.get(sh!.fieldId) : undefined,
        blocks: blocksByShelter.get(sh!.id) ?? 0,
      }))
    return { sample, batch, inc, shelters }
  }, [selected, sampleById, batchById, incById, linksByTray, shelterById, fieldById, blocksByShelter])

  const [linkShelterId, setLinkShelterId] = useState('')

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Lineage"
        subtitle="Trace bees through the season: sample → batch → incubator → tray → shelter → field"
        actions={<SearchBar value={q} onChange={setQ} placeholder="Tray #, sample, lot, incubator…" />}
      />
      <div className="grid min-h-0 flex-1 md:grid-cols-[22rem_1fr]">
        {/* Tray list */}
        <aside className="overflow-y-auto border-r border-subtle bg-surface p-3">
          {results.length === 0 ? (
            <p className="p-2 text-sm text-muted">No trays match.</p>
          ) : (
            results.map((t) => {
              const sample = t.sampleId ? sampleById.get(t.sampleId) : undefined
              const active = selected?.id === t.id
              return (
                <button
                  key={t.id}
                  onClick={() => setSelected(t)}
                  className={`mb-1.5 block w-full rounded-sm border p-2.5 text-left text-sm transition ${
                    active ? 'border-brand bg-brand-light' : 'border-subtle hover:bg-[color:var(--hover-wash)]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="tabular-nums font-semibold text-primary">{t.trayNumber}</span>
                    <Badge tone={t.status === 'released' ? 'green' : 'brand'}>{t.status || '—'}</Badge>
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    {sample?.name ?? 'no sample'} · out {fmtWhen(t.outDate)}
                  </div>
                </button>
              )
            })
          )}
        </aside>

        {/* Chain */}
        <div className="overflow-y-auto p-4 md:p-6">
          {!selected || !chain ? (
            <EmptyState>Pick a tray to trace its lineage.</EmptyState>
          ) : (
            <div className="max-w-2xl space-y-3">
              <h2 className="font-display text-lg font-bold text-primary">
                Tray <span className="tabular-nums">{selected.trayNumber}</span>
              </h2>

              {/* Sample */}
              <div className="card">
                <div className="label">Sample (lot)</div>
                {chain.sample ? (
                  <>
                    <div className="mt-1 font-semibold text-primary">{chain.sample.name}</div>
                    <div className="text-xs text-muted">
                      {chain.sample.source} · lot {chain.sample.lotNumber || '—'} ·{' '}
                      {chain.sample.xrayLivePct != null ? `${Math.round(chain.sample.xrayLivePct * 100)}% live (x-ray)` : 'no x-ray'}
                    </div>
                  </>
                ) : (
                  <p className="mt-1 text-sm text-muted">No sample linked.</p>
                )}
              </div>

              {/* Batch + incubator */}
              <div className="card">
                <div className="label">Incubation</div>
                <div className="mt-1 text-sm text-secondary">
                  {chain.batch ? (
                    <>
                      Batch <span className="font-semibold text-primary">{chain.batch.name}</span> · started{' '}
                      {fmtWhen(chain.batch.startDate)} · est. release {fmtWhen(chain.batch.estimatedRelease)}
                    </>
                  ) : (
                    'No batch linked.'
                  )}
                </div>
                <div className="mt-1 text-sm text-secondary">
                  {chain.inc ? (
                    <>
                      Incubator <span className="font-semibold text-primary">{chain.inc.name}</span>
                      {selected.inDate && <> · in {fmtWhen(selected.inDate)}</>}
                      {selected.outDate && <> · out {fmtWhen(selected.outDate)}</>}
                    </>
                  ) : (
                    'No incubator linked.'
                  )}
                </div>
              </div>

              {/* Field placement */}
              <div className="card">
                <div className="label">Field placement</div>
                {chain.shelters.length === 0 ? (
                  <p className="mt-1 text-sm text-muted">
                    Not scanned into a shelter yet — crews link trays to shelters in Field Mode.
                  </p>
                ) : (
                  chain.shelters.map(({ shelter, field, blocks }) => (
                    <div key={shelter.id} className="mt-1 text-sm text-secondary">
                      Shelter <span className="tabular-nums font-semibold text-primary">{shelter.qrCode ?? shelter.id.slice(0, 8)}</span>
                      {field && (
                        <>
                          {' '}
                          in <span className="font-semibold text-primary">{field.name}</span>
                        </>
                      )}
                      {' · '}placed {fmtWhen(shelter.placedAt)}
                      {shelter.placedBy && <> by {shelter.placedBy}</>}
                      {blocks > 0 && <> · {blocks} nesting blocks</>}
                    </div>
                  ))
                )}
                {canEdit && placedShelters.length > 0 && (
                  <div className="mt-3 flex items-end gap-2 border-t border-subtle pt-3">
                    <label className="block flex-1">
                      <span className="label">Link to placed shelter</span>
                      <select className="input" value={linkShelterId} onChange={(e) => setLinkShelterId(e.target.value)}>
                        <option value="">Choose…</option>
                        {placedShelters.map((sh) => (
                          <option key={sh.id} value={sh.id}>
                            {sh.qrCode ?? sh.id.slice(0, 8)} {sh.fieldId ? `· ${fieldById.get(sh.fieldId)?.name ?? ''}` : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="btn-primary min-h-0 px-3 py-2 text-sm"
                      disabled={!linkShelterId}
                      onClick={() => {
                        linkTrayToShelter({
                          shelterId: linkShelterId,
                          trayId: selected.id,
                          scannedAt: new Date().toISOString(),
                          scannedBy: s.user.name,
                        })
                        setLinkShelterId('')
                      }}
                    >
                      Link
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
