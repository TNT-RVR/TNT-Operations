/**
 * Export one incubator's history over any window — a week, a season, or three
 * years back.
 *
 * The range is deliberately unconstrained. "How did chamber 3 behave in 2024"
 * is a real question and the readings go back that far, so the presets cover
 * the common asks and the two date boxes cover everything else.
 */
import { useMemo, useState } from 'react'
import { Download, FileSpreadsheet, FileText } from 'lucide-react'
import { useData } from '@/data/context'
import type { Incubator } from '@/data/types'
import { addDays } from '@/domain/incubation'
import {
  buildIncubatorReport,
  readingsCsv,
  reportFilename,
  type ReportTray,
} from '@/domain/incubatorReport'
import { downloadBlob, downloadCsv } from '@/lib/download'

const TZ = 'America/Edmonton'

/** ISO instant → `YYYY-MM-DD` in the operation's timezone. */
const toYmd = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ })

const fmtLocal = (iso: string) =>
  new Date(iso).toLocaleString('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

const todayYmd = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ })

type Format = 'pdf' | 'csv'

export function IncubatorExport({ incubator }: { incubator: Incubator }) {
  const { trays, traysLoading, inspections, fetchReadings } = useData()

  const today = todayYmd()
  const [from, setFrom] = useState(() => addDays(today, -89))
  const [to, setTo] = useState(today)
  const [format, setFormat] = useState<Format>('pdf')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  /** Presets for the ranges people actually ask for. */
  const presets = useMemo(() => {
    const year = Number(today.slice(0, 4))
    const out: Array<{ label: string; from: string; to: string }> = [
      { label: '30 days', from: addDays(today, -29), to: today },
      { label: '90 days', from: addDays(today, -89), to: today },
      { label: 'This season', from: `${year}-01-01`, to: today },
    ]
    if (incubator.incubationStart) {
      out.push({ label: 'This run', from: incubator.incubationStart.slice(0, 10), to: today })
    }
    // Two prior seasons — enough to answer "what did we do last year" without
    // turning this into a year picker.
    for (const y of [year - 1, year - 2]) out.push({ label: String(y), from: `${y}-01-01`, to: `${y}-12-31` })
    return out
  }, [today, incubator.incubationStart])

  const invalid = !from || !to || from > to

  async function run() {
    if (invalid) return
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      // Local midnight to local end-of-day, so a window means the same thing to
      // the person picking it as it does to the query.
      const windowReadings = await fetchReadings(
        incubator.id,
        new Date(`${from}T00:00:00`).toISOString(),
        new Date(`${to}T23:59:59.999`).toISOString(),
      )

      const report = buildIncubatorReport({
        incubator,
        readings: windowReadings,
        trays: trays as unknown as ReportTray[],
        inspections: inspections.filter((i) => i.incubatorId === incubator.id),
        from,
        to,
        toYmd,
        today,
      })

      if (format === 'csv') {
        if (report.windowReadings.length === 0) {
          setError('No readings in that range, so the CSV would be empty.')
          return
        }
        downloadCsv(reportFilename(incubator.name, from, to, 'csv'), readingsCsv(report, fmtLocal))
        setDone(`${report.windowReadings.length} readings exported.`)
      } else {
        const { incubatorReportPdf } = await import('./incubatorPdf')
        const blob = await incubatorReportPdf(report, fmtLocal)
        downloadBlob(reportFilename(incubator.name, from, to, 'pdf'), blob)
        setDone('Report downloaded.')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not build the export.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-lg bg-overlay p-3">
      <h3 className="label mb-2">Export history</h3>

      <div className="mb-2 flex flex-wrap gap-1.5">
        {presets.map((p) => {
          const active = p.from === from && p.to === to
          return (
            <button
              key={p.label}
              onClick={() => {
                setFrom(p.from)
                setTo(p.to)
                setDone(null)
              }}
              className={`rounded-sm border px-2 py-1 text-xs transition ${
                active
                  ? 'border-brand text-brand'
                  : 'border-default text-secondary hover:text-primary'
              }`}
            >
              {p.label}
            </button>
          )
        })}
      </div>

      <div className="mb-2 flex flex-wrap items-end gap-2">
        <label className="text-xs text-muted">
          From
          <input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => {
              setFrom(e.target.value)
              setDone(null)
            }}
            className="mt-0.5 block rounded-sm border border-default bg-inset px-2 py-1 text-sm text-primary"
          />
        </label>
        <label className="text-xs text-muted">
          To
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => {
              setTo(e.target.value)
              setDone(null)
            }}
            className="mt-0.5 block rounded-sm border border-default bg-inset px-2 py-1 text-sm text-primary"
          />
        </label>

        <div className="flex overflow-hidden rounded-sm border border-default">
          {(['pdf', 'csv'] as Format[]).map((f) => (
            <button
              key={f}
              onClick={() => {
                setFormat(f)
                setDone(null)
              }}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs transition ${
                format === f ? 'bg-raised text-primary' : 'text-muted hover:text-primary'
              }`}
              aria-pressed={format === f}
            >
              {f === 'pdf' ? <FileText size={13} /> : <FileSpreadsheet size={13} />}
              {f.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Trays load once when the modal opens; exporting before they arrive
            would silently report zero trays held. */}
        <button className="btn-primary" onClick={run} disabled={busy || invalid || traysLoading}>
          <Download size={15} className="mr-1.5 inline" />
          {busy ? 'Building…' : traysLoading ? 'Loading trays…' : 'Export'}
        </button>
      </div>

      <p className="text-xs text-muted">
        {format === 'pdf'
          ? 'Summary with charts, highs and lows, settings, trays in, and key dates.'
          : 'Temperature and humidity readings only, for your own analysis.'}
      </p>
      {invalid && from && to && <p className="mt-1 text-xs text-danger">The start date is after the end date.</p>}
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      {done && !error && <p className="mt-1 text-xs text-success">{done}</p>}
    </section>
  )
}
