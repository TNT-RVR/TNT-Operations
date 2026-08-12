import { useEffect, useMemo, useRef, useState } from 'react'
import { Upload, X, Check, AlertTriangle } from 'lucide-react'
import { Select, Button, Modal } from '@/components/ui'
import { useData } from '@/data/context'
import { readSheet, guessColumns, type SheetTable, type ColMap } from './returnsImport'
import { parseNumber } from '@/features/incubation/xrayImport'
import { planBlockImport, type ImportPlan, type ImportRow } from '@/domain/blockImport'

/**
 * Import blocks already out in the field, from a spreadsheet.
 *
 * Unlike the returns map's file loader, this WRITES. So it plans first, shows
 * exactly what it would do, and only acts when told — an import that surprises
 * you afterwards is worse than one that takes an extra click.
 *
 * Safe to re-run: a block already placed this season is updated, not
 * duplicated, which is the same rule the scanner follows.
 */
export function BlockImport({ season, onClose }: { season: number; onClose: () => void }) {
  const { fields, blocks, blockPlacements, importBlockPlacements } = useData()
  const [sheet, setSheet] = useState<SheetTable | null>(null)
  const [cols, setCols] = useState<ColMap>({ lat: -1, lng: -1, value: -1, label: -1, group: -1 })
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ created: number; updated: number; newBlocks: number } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fileRef.current?.click()
  }, [])

  const rows: ImportRow[] = useMemo(() => {
    if (!sheet) return []
    return sheet.rows.map((r) => ({
      label: cols.label >= 0 ? String(r[cols.label] ?? '').trim() : '',
      lat: cols.lat >= 0 ? parseNumber(r[cols.lat]) : null,
      lng: cols.lng >= 0 ? parseNumber(r[cols.lng]) : null,
      fieldName: cols.group >= 0 ? String(r[cols.group] ?? '').trim() : null,
    }))
  }, [sheet, cols])

  const plan: ImportPlan | null = useMemo(
    () => (rows.length ? planBlockImport(rows, { blocks, placements: blockPlacements, fields, season }) : null),
    [rows, blocks, blockPlacements, fields, season],
  )

  async function onPick(file: File) {
    setErr(null)
    setDone(null)
    try {
      const t = await readSheet(file)
      if (!t.headers.length) throw new Error('That file has no rows.')
      setSheet(t)
      setCols(guessColumns(t.headers))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not read that file.')
    }
  }

  async function apply() {
    if (!plan) return
    setBusy(true)
    setErr(null)
    try {
      const payload = [...plan.create, ...plan.update].map((e) => ({
        label: e.row.label,
        fieldId: e.fieldId,
        lat: e.row.lat!,
        lng: e.row.lng!,
        placedAt: e.row.placedAt ?? null,
      }))
      const r = await importBlockPlacements(payload, season)
      if (r.error) setErr(r.error)
      else setDone({ created: r.created, updated: r.updated, newBlocks: r.newBlocks })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'The import failed.')
    } finally {
      setBusy(false)
    }
  }

  const fieldName = (id: string | null) => fields.find((f) => f.id === id)?.name ?? '—'

  return (
    <Modal title={`Import blocks for ${season}`} onClose={onClose} wide>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void onPick(f)
          e.target.value = ''
        }}
      />

      {done ? (
        <div className="space-y-3">
          <p className="flex items-center gap-2 font-semibold text-primary">
            <Check size={18} className="text-brand" />
            Imported.
          </p>
          <ul className="space-y-1 text-sm text-muted">
            <li>
              <span className="font-semibold text-primary">{done.created}</span> block
              {done.created === 1 ? '' : 's'} placed
            </li>
            <li>
              <span className="font-semibold text-primary">{done.updated}</span> already placed this season,
              so updated rather than duplicated
            </li>
            <li>
              <span className="font-semibold text-primary">{done.newBlocks}</span> new block
              {done.newBlocks === 1 ? '' : 's'} registered
            </li>
          </ul>
          <p className="text-xs text-faint">
            Weigh-in and weigh-out weights are added by scanning, as usual — the map fills in once both are recorded.
          </p>
          <Button onClick={onClose}>Done</Button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            A row per block, with its label and where it was placed. Weights aren't needed — those come from
            the weigh-in and weigh-out scans.
          </p>

          {err && <p className="text-sm text-danger">{err}</p>}

          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => fileRef.current?.click()}>
              <Upload size={16} className="mr-1 inline" />
              {sheet ? 'Choose a different file' : 'Choose a file'}
            </Button>
            {sheet && (
              <Button
                variant="ghost"
                onClick={() => {
                  setSheet(null)
                  setErr(null)
                }}
              >
                <X size={16} className="mr-1 inline" />
                Clear
              </Button>
            )}
          </div>

          {sheet && (
            <>
              <p className="text-xs text-faint">
                Read {sheet.sourceRows ?? sheet.rows.length} rows × {sheet.headers.length} columns
                {sheet.delimiter
                  ? ` (separator: ${sheet.delimiter === '\t' ? 'tab' : sheet.delimiter === ',' ? 'comma' : sheet.delimiter})`
                  : ''}
                . Columns: {sheet.headers.slice(0, 12).join(' · ') || '(none)'}
              </p>

              <div className="grid gap-2 md:grid-cols-4">
                {(
                  [
                    ['label', 'Block label'],
                    ['lat', 'Latitude'],
                    ['lng', 'Longitude'],
                    ['group', 'Field (optional)'],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="text-xs text-muted">
                    {label}
                    <Select
                      value={cols[key]}
                      onChange={(e) => setCols((c) => ({ ...c, [key]: Number(e.target.value) }))}
                    >
                      <option value={-1}>— none —</option>
                      {sheet.headers.map((h, i) => (
                        <option key={i} value={i}>{h || `Column ${i + 1}`}</option>
                      ))}
                    </Select>
                  </label>
                ))}
              </div>

              {plan && (
                <div className="card space-y-2">
                  <div className="font-semibold text-primary">What this will do</div>
                  <ul className="space-y-1 text-sm">
                    <li>
                      <span className="font-semibold text-primary">{plan.create.length}</span> new placement
                      {plan.create.length === 1 ? '' : 's'}
                    </li>
                    <li>
                      <span className="font-semibold text-primary">{plan.update.length}</span> already placed
                      this season — these will be UPDATED, not duplicated
                    </li>
                    <li>
                      <span className="font-semibold text-primary">{plan.newBlockLabels.length}</span> block
                      label{plan.newBlockLabels.length === 1 ? '' : 's'} not seen before, which will be registered
                    </li>
                    {plan.unresolvedFields > 0 && (
                      <li className="text-danger">
                        <AlertTriangle size={13} className="mr-1 inline" />
                        {plan.unresolvedFields} row{plan.unresolvedFields === 1 ? '' : 's'} sit outside every
                        field boundary — they'll import, but without a field, so they won't appear on a field's
                        returns map.
                      </li>
                    )}
                    {plan.skipped.length > 0 && (
                      <li className="text-danger">
                        {plan.skipped.length} row{plan.skipped.length === 1 ? '' : 's'} skipped:{' '}
                        {[...new Set(plan.skipped.map((s) => s.reason))].join('; ')}
                      </li>
                    )}
                  </ul>

                  {/* A sample, so the column choices can be checked before writing. */}
                  {plan.create.length + plan.update.length > 0 && (
                    <div className="overflow-x-auto border-t border-default pt-2">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-muted">
                            <th className="py-1 pr-3 font-medium">Block</th>
                            <th className="py-1 pr-3 font-medium">Field</th>
                            <th className="py-1 pr-3 font-medium">Matched by</th>
                            <th className="py-1 font-medium">Position</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...plan.create, ...plan.update].slice(0, 8).map((e, i) => (
                            <tr key={i} className="border-t border-default/50">
                              <td className="py-1 pr-3 font-medium">{e.row.label}</td>
                              <td className="py-1 pr-3">{fieldName(e.fieldId)}</td>
                              <td className="py-1 pr-3 text-muted">
                                {e.fieldSource === 'geometry'
                                  ? 'position'
                                  : e.fieldSource === 'name'
                                    ? 'name'
                                    : 'unmatched'}
                              </td>
                              <td className="py-1 text-muted">
                                {e.row.lat?.toFixed(5)}, {e.row.lng?.toFixed(5)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {plan.create.length + plan.update.length > 8 && (
                        <p className="mt-1 text-xs text-faint">
                          …and {plan.create.length + plan.update.length - 8} more
                        </p>
                      )}
                    </div>
                  )}

                  <div className="flex gap-2 pt-1">
                    <Button
                      onClick={() => void apply()}
                      disabled={busy || plan.create.length + plan.update.length === 0}
                    >
                      {busy ? 'Importing…' : `Import ${plan.create.length + plan.update.length} blocks`}
                    </Button>
                    <Button variant="ghost" onClick={onClose} disabled={busy}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  )
}
