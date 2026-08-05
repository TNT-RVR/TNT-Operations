/**
 * Upload a season spreadsheet.
 *
 * Two differences from the Base44 importer, both about not destroying data:
 *
 *  1. It PREVIEWS before it writes. The original posted the parsed rows
 *     straight to a bulk-create, so a mis-mapped header was discovered after
 *     the fact.
 *  2. It upserts on (field_name, year) rather than always inserting, so
 *     re-uploading a corrected sheet fixes the season instead of doubling it.
 *     The original's `bulkCreate` would have created a second copy of all 157
 *     rows on a second upload.
 */

import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, FileUp, Upload } from 'lucide-react'
import { Badge, Button, Card, PageHeader, Stat } from '@/components/ui'
import { useSession } from '@/auth/session'
import { useData } from '@/data/context'
import { parseAnalysisCsvRow, validateAnalysisRows } from '@/domain/analysisImport'
import { formatMetric } from '@/domain/analysisMetrics'
import type { FieldAnalysis } from '@/data/types'
import { AnalysisProvider, useAnalysis } from './useAnalysis'

type ParsedRow = Partial<FieldAnalysis> & { field_name: string; year: string }

/**
 * Minimal RFC4180-ish CSV reader: quoted fields, embedded commas/newlines,
 * doubled quotes, CRLF. Deliberately not a dependency — the same forgiving
 * approach `importPaths.ts` takes for crew scan files.
 */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text // strip BOM

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += ch
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cell)
      cell = ''
      // Skip the blank line a trailing newline produces.
      if (row.some((c) => c.trim() !== '')) rows.push(row)
      row = []
    } else cell += ch
  }
  row.push(cell)
  if (row.some((c) => c.trim() !== '')) rows.push(row)

  if (rows.length < 2) return []
  const header = rows[0].map((h) => h.trim())
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {}
    header.forEach((h, i) => {
      obj[h] = r[i] ?? ''
    })
    return obj
  })
}

function Uploader() {
  const s = useSession()
  const { importFieldAnalysis } = useData()
  const { allRows } = useAnalysis()
  const inputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [parsed, setParsed] = useState<ParsedRow[] | null>(null)
  const [skipped, setSkipped] = useState(0)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const canEdit = s.can('analysis', 'edit')

  const problems = useMemo(() => (parsed ? validateAnalysisRows(parsed) : []), [parsed])

  const existingKeys = useMemo(
    () => new Set(allRows.map((r) => `${r.field_name}|${r.year}`)),
    [allRows],
  )
  const willUpdate = parsed?.filter((r) => existingKeys.has(`${r.field_name}|${r.year}`)).length ?? 0
  const willInsert = (parsed?.length ?? 0) - willUpdate

  const onFile = async (file: File) => {
    setResult(null)
    setError(null)
    setFileName(file.name)
    try {
      const raw = parseCsv(await file.text())
      if (raw.length === 0) {
        setError('That file had no data rows.')
        setParsed(null)
        return
      }
      const good: ParsedRow[] = []
      let bad = 0
      for (const r of raw) {
        const row = parseAnalysisCsvRow(r)
        if (row) good.push(row)
        else bad++
      }
      setParsed(good)
      setSkipped(bad)
      if (good.length === 0) {
        setError(
          'No rows had both a field name and a season. Check that the sheet has "Field Name" and "Year" columns.',
        )
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file.')
      setParsed(null)
    }
  }

  const commit = async () => {
    if (!parsed) return
    setBusy(true)
    setError(null)
    // Re-parsing from the preview rows is a no-op mapping, but keeps one code
    // path: the provider is the only thing that decides insert vs update.
    const res = await importFieldAnalysis(parsed as unknown as Record<string, unknown>[])
    setBusy(false)
    if (res.error) {
      setError(res.error)
      return
    }
    setResult(
      `Imported ${res.inserted} new row${res.inserted === 1 ? '' : 's'} and updated ${res.updated}` +
        (res.skipped ? `, skipped ${res.skipped}.` : '.'),
    )
    setParsed(null)
    setFileName('')
  }

  return (
    <div>
      <PageHeader
        title="Upload season data"
        subtitle="Import the season spreadsheet. Re-uploading a corrected sheet updates those seasons rather than duplicating them."
      />

      {!canEdit ? (
        <Card>
          <p className="text-secondary">You have read-only access to Analysis. Ask an admin to import data.</p>
        </Card>
      ) : (
        <>
          <Card className="mb-4">
            <div
              className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-8 text-center"
              style={{ borderColor: 'var(--border-default)' }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                const file = e.dataTransfer.files?.[0]
                if (file) void onFile(file)
              }}
            >
              <FileUp size={28} className="text-muted" />
              <p className="text-sm text-secondary">Drop a CSV here, or choose a file.</p>
              <input
                ref={inputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void onFile(file)
                }}
              />
              <Button onClick={() => inputRef.current?.click()}>
                <Upload size={15} /> Choose file
              </Button>
              {fileName && <p className="text-xs text-muted">{fileName}</p>}
            </div>
          </Card>

          {error && (
            <Card className="mb-4">
              <p className="flex items-start gap-2 text-sm" style={{ color: 'var(--danger-fg)' }}>
                <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
              </p>
            </Card>
          )}

          {result && (
            <Card className="mb-4">
              <p className="flex items-start gap-2 text-sm" style={{ color: 'var(--ok-fg)' }}>
                <Check size={15} className="mt-0.5 shrink-0" /> {result}
              </p>
            </Card>
          )}

          {parsed && parsed.length > 0 && (
            <>
              <div className="mb-4 grid gap-3 sm:grid-cols-4">
                <Stat label="Rows read" value={parsed.length} />
                <Stat label="New seasons" value={willInsert} />
                <Stat label="Will update" value={willUpdate} />
                <Stat
                  label="Skipped"
                  value={skipped}
                  tone={skipped > 0 ? 'warn' : 'default'}
                  hint={skipped > 0 ? 'No field name or season' : undefined}
                />
              </div>

              {problems.length > 0 && (
                <Card className="mb-4">
                  <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--warn-fg)' }}>
                    <AlertTriangle size={15} /> {problems.length} thing{problems.length === 1 ? '' : 's'} to check
                  </h2>
                  <ul className="space-y-1 text-sm text-secondary">
                    {problems.slice(0, 12).map((p, i) => (
                      <li key={i}>· {p}</li>
                    ))}
                  </ul>
                  {problems.length > 12 && (
                    <p className="mt-2 text-xs text-muted">…and {problems.length - 12} more.</p>
                  )}
                </Card>
              )}

              <Card className="mb-4">
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-secondary">
                  Preview — first 15 rows
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        <th className="th text-left">Field</th>
                        <th className="th text-left">Season</th>
                        <th className="th text-left">Company</th>
                        <th className="th text-right">Acres</th>
                        <th className="th text-right">Live prepupae</th>
                        <th className="th text-right">Return</th>
                        <th className="th text-left">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.slice(0, 15).map((r, i) => (
                        <tr key={i} className="border-t border-subtle">
                          <td className="px-2 py-1.5 text-secondary">{r.field_name}</td>
                          <td className="px-2 py-1.5 text-secondary">{r.year}</td>
                          <td className="px-2 py-1.5 text-secondary">{r.company || '—'}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-secondary">
                            {formatMetric(r.acres ?? null, 'acres')}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-secondary">
                            {formatMetric(r.live_prepupae ?? null, 'live_prepupae')}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-secondary">
                            {formatMetric(r.percent_return ?? null, 'percent_return')}
                          </td>
                          <td className="px-2 py-1.5">
                            {existingKeys.has(`${r.field_name}|${r.year}`) ? (
                              <Badge tone="amber">Update</Badge>
                            ) : (
                              <Badge tone="green">New</Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {parsed.length > 15 && (
                  <p className="mt-2 text-xs text-muted">…and {parsed.length - 15} more rows.</p>
                )}
              </Card>

              <div className="flex items-center gap-3">
                <Button onClick={commit} disabled={busy}>
                  {busy ? 'Importing…' : `Import ${parsed.length} rows`}
                </Button>
                <Button
                  onClick={() => {
                    setParsed(null)
                    setFileName('')
                  }}
                  variant="ghost"
                >
                  Cancel
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

export default function AnalysisUpload() {
  return (
    <AnalysisProvider>
      <Uploader />
    </AnalysisProvider>
  )
}
