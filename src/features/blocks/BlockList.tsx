import { useEffect, useMemo, useState } from 'react'
import { Download, History, AlertTriangle, Upload } from 'lucide-react'
import { PageHeader, SearchBar, Select, Badge, EmptyState, Modal, Button, matchesQuery } from '@/components/ui'
import { useData } from '@/data/context'
import type { BlockPlacement } from '@/data/types'
import {
  blockStage,
  beeReturnLbs,
  hasImpossibleWeights,
  daysInField,
  seasonsOf,
  blockHistory,
  STAGE_LABEL,
} from '@/domain/blocks'
import { TrayScanButton } from '@/features/incubation/TrayScanButton'
import { BlockImport } from './BlockImport'

const num = (v: number | null, unit = '') => (v == null ? '—' : `${v.toFixed(1)}${unit}`)
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '—')

type SortKey = 'label' | 'field' | 'stage' | 'return' | 'placed'

/** Every block placement, filterable — the register you check things against. */
export default function BlockList() {
  const { fields, blocks, blockPlacements, blocksLoading, loadBlocks, blockSeasons, loadBlockHistory } = useData()
  const [q, setQ] = useState('')
  const [season, setSeason] = useState<string>('')
  const [fieldId, setFieldId] = useState('')
  const [stage, setStage] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'label', dir: 1 })
  const [historyFor, setHistoryFor] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

  const seasons = useMemo(
    () => (blockSeasons.length ? blockSeasons.map((s) => s.season) : seasonsOf(blockPlacements)),
    [blockSeasons, blockPlacements],
  )

  // Fetch whichever season is on screen — never all of them.
  useEffect(() => {
    if (season) void loadBlocks(Number(season))
  }, [loadBlocks, season])
  // Default the year filter to the current season, as everywhere else.
  useEffect(() => {
    if (season === '' && seasons.length) {
      const now = new Date().getFullYear()
      setSeason(String(seasons.includes(now) ? now : seasons[0]))
    }
  }, [seasons, season])

  const labelOf = (blockId: string) => blocks.find((b) => b.id === blockId)?.label ?? '—'
  const fieldName = (id: string | null) => fields.find((f) => f.id === id)?.name ?? 'Unassigned'

  const rows = useMemo(() => {
    const filtered = blockPlacements.filter((p) => {
      if (season && p.season !== Number(season)) return false
      if (fieldId && p.fieldId !== fieldId) return false
      if (stage && blockStage(p) !== stage) return false
      if (q && !matchesQuery(q, labelOf(p.blockId), fieldName(p.fieldId))) return false
      return true
    })
    const val = (p: BlockPlacement) => {
      switch (sort.key) {
        case 'label':
          return labelOf(p.blockId)
        case 'field':
          return fieldName(p.fieldId)
        case 'stage':
          return blockStage(p)
        case 'return':
          return beeReturnLbs(p) ?? -1
        case 'placed':
          return p.placedAt ?? ''
      }
    }
    return [...filtered].sort((a, b) => {
      const x = val(a)
      const y = val(b)
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * sort.dir
      return String(x).localeCompare(String(y)) * sort.dir
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockPlacements, blocks, fields, q, season, fieldId, stage, sort])

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }))
  }

  function exportCsv() {
    const head = ['Block', 'Season', 'Field', 'Stage', 'Placed', 'Lat', 'Lng', 'Retrieved', 'Gross lbs', 'Stripped', 'Empty lbs', 'Return lbs']
    const body = rows.map((p) => [
      labelOf(p.blockId), p.season, fieldName(p.fieldId), STAGE_LABEL[blockStage(p)],
      date(p.placedAt), p.lat ?? '', p.lng ?? '',
      date(p.retrievedAt), p.grossWeightLbs ?? '',
      date(p.strippedAt), p.strippedWeightLbs ?? '',
      beeReturnLbs(p) ?? '',
    ])
    const csv = [head, ...body]
      .map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(','))
      .join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `blocks-${season || 'all'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Pull every season for the block whose history is open — the list itself
  // only holds the season being filtered.
  useEffect(() => {
    if (historyFor) void loadBlockHistory(historyFor)
  }, [historyFor, loadBlockHistory])

  const historyRows = historyFor ? blockHistory(blockPlacements, historyFor) : []

  const th = (key: SortKey, label: string, right = false) => (
    <th
      className={`cursor-pointer py-2 pr-3 font-medium hover:text-primary ${right ? 'text-right' : 'text-left'}`}
      onClick={() => toggleSort(key)}
    >
      {label} {sort.key === key ? (sort.dir === 1 ? '▲' : '▼') : ''}
    </th>
  )

  return (
    <div>
      <PageHeader
        title="Block register"
        subtitle={`${rows.length} placement${rows.length === 1 ? '' : 's'}`}
        actions={
          <div className="flex gap-2">
            {/* Scan a block to jump straight to its history. */}
            <TrayScanButton
              label="Look up"
              title="Scan a block"
              onScan={(label) => {
                const b = blocks.find((x) => x.label.trim().toLowerCase() === label.trim().toLowerCase())
                if (b) setHistoryFor(b.id)
              }}
              resolve={(label) => {
                const b = blocks.find((x) => x.label.trim().toLowerCase() === label.trim().toLowerCase())
                return b ? { ok: true, title: b.label } : { ok: false, title: label, detail: 'No block on record.' }
              }}
            />
            <Button variant="ghost" onClick={() => setImporting(true)}>
              <Upload size={16} className="mr-1 inline" />
              Import
            </Button>
            <Button variant="ghost" onClick={exportCsv}>
              <Download size={16} className="mr-1 inline" />
              CSV
            </Button>
          </div>
        }
      />

      <div className="space-y-3 p-4 md:p-6">
        <div className="grid gap-2 md:grid-cols-4">
          <SearchBar value={q} onChange={setQ} placeholder="Block or field…" />
          <Select value={season} onChange={(e) => setSeason(e.target.value)}>
            <option value="">All seasons</option>
            {seasons.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
          <Select value={fieldId} onChange={(e) => setFieldId(e.target.value)}>
            <option value="">All fields</option>
            {fields.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </Select>
          <Select value={stage} onChange={(e) => setStage(e.target.value)}>
            <option value="">All stages</option>
            <option value="placed">In field</option>
            <option value="retrieved">Retrieved</option>
            <option value="stripped">Stripped</option>
          </Select>
        </div>

        {blocksLoading && <p className="text-sm text-muted">Loading blocks…</p>}
        {!blocksLoading && rows.length === 0 && <EmptyState>No blocks match those filters.</EmptyState>}

        {rows.length > 0 && (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-default text-muted">
                  {th('label', 'Block')}
                  {th('field', 'Field')}
                  {th('stage', 'Stage')}
                  {th('placed', 'Placed')}
                  <th className="py-2 pr-3 text-right font-medium">Full</th>
                  <th className="py-2 pr-3 text-right font-medium">Empty</th>
                  {th('return', 'Return', true)}
                  <th className="py-2 text-right font-medium">Days out</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const st = blockStage(p)
                  const ret = beeReturnLbs(p)
                  const bad = hasImpossibleWeights(p)
                  return (
                    <tr key={p.id} className="border-b border-default/50">
                      <td className="py-2 pr-3">
                        <button
                          className="font-medium text-brand hover:underline"
                          onClick={() => setHistoryFor(p.blockId)}
                        >
                          {labelOf(p.blockId)}
                        </button>
                      </td>
                      <td className="py-2 pr-3">{fieldName(p.fieldId)}</td>
                      <td className="py-2 pr-3">
                        <Badge tone={st === 'stripped' ? 'green' : st === 'retrieved' ? 'amber' : 'blue'}>
                          {STAGE_LABEL[st]}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3 text-muted">{date(p.placedAt)}</td>
                      <td className="py-2 pr-3 text-right">{num(p.grossWeightLbs)}</td>
                      <td className="py-2 pr-3 text-right">{num(p.strippedWeightLbs)}</td>
                      <td className={`py-2 pr-3 text-right font-semibold ${bad ? 'text-danger' : ''}`}>
                        {bad ? (
                          <span className="inline-flex items-center gap-1" title="Empty weight is heavier than full — re-weigh this block.">
                            <AlertTriangle size={13} />
                            {num(ret)}
                          </span>
                        ) : (
                          num(ret)
                        )}
                      </td>
                      <td className="py-2 text-right text-muted">{daysInField(p) ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {importing && (
        <BlockImport
          season={season ? Number(season) : new Date().getFullYear()}
          onClose={() => setImporting(false)}
        />
      )}

      {historyFor && (
        <Modal title={`${labelOf(historyFor)} — history`} onClose={() => setHistoryFor(null)}>
          <div className="mb-3 flex items-center gap-2 text-sm text-muted">
            <History size={15} />
            Every season this physical block has been used.
          </div>
          {historyRows.length === 0 ? (
            <EmptyState>No placements recorded.</EmptyState>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-default text-left text-muted">
                  <th className="py-2 pr-3 font-medium">Season</th>
                  <th className="py-2 pr-3 font-medium">Field</th>
                  <th className="py-2 pr-3 font-medium">Stage</th>
                  <th className="py-2 pr-3 text-right font-medium">Return</th>
                  <th className="py-2 text-right font-medium">Days out</th>
                </tr>
              </thead>
              <tbody>
                {historyRows.map((p) => (
                  <tr key={p.id} className="border-b border-default/50">
                    <td className="py-2 pr-3 font-medium">{p.season}</td>
                    <td className="py-2 pr-3">{fieldName(p.fieldId)}</td>
                    <td className="py-2 pr-3">{STAGE_LABEL[blockStage(p)]}</td>
                    <td className="py-2 pr-3 text-right font-semibold">{num(beeReturnLbs(p), ' lbs')}</td>
                    <td className="py-2 text-right text-muted">{daysInField(p) ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Modal>
      )}
    </div>
  )
}
