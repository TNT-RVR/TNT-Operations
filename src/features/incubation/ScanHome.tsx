import { useEffect, useMemo, useRef, useState } from 'react'
import { Camera, X, Check } from 'lucide-react'
import { PageHeader, Badge, EmptyState } from '@/components/ui'
import { useData } from '@/data/context'
import { useSession } from '@/auth/session'
import type { Tray } from '@/data/types'

const READER_ID = 'tray-qr-reader'

/**
 * Pull a tray label out of whatever the camera read. Labels are the tray
 * numbers stored in Supabase, but a QR may also carry a URL (the old desktop
 * app encoded `http://<lan-ip>:<port>/tray/<id>`), so take the last path
 * segment when it looks like one.
 */
export function parseScan(text: string): string {
  const raw = (text ?? '').trim()
  if (!raw) return ''
  const m = raw.match(/\/tray\/([^/?#\s]+)/i)
  if (m) return m[1]
  if (/^https?:\/\//i.test(raw)) {
    const seg = raw.split(/[?#]/)[0].replace(/\/+$/, '').split('/').pop()
    return seg ?? raw
  }
  return raw
}

/** Digits of a label, for prefix-tolerant matching (Tray0007 vs Trays7). */
const digits = (s: string) => s.replace(/\D/g, '').replace(/^0+/, '')

/**
 * Find the trays a scanned label refers to. Exact match wins; otherwise fall
 * back to the numeric part, because the real data mixes `Tray####` and
 * `Trays####` prefixes (no numeric collisions between them today).
 */
export function findTrays(all: Tray[], query: string): Tray[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const exact = all.filter((t) => t.trayNumber.toLowerCase() === q)
  if (exact.length) return exact
  const qd = digits(q)
  if (!qd) return []
  return all.filter((t) => digits(t.trayNumber) === qd)
}

export default function ScanHome() {
  const { trays, samples, incubators, assignTray } = useData()
  const s = useSession()
  const canEdit = s.can('incubation', 'edit')

  const [scanning, setScanning] = useState(false)
  const [camError, setCamError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [label, setLabel] = useState<string | null>(null)
  const [sampleId, setSampleId] = useState('')
  const [incubatorId, setIncubatorId] = useState('')
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scannerRef = useRef<any>(null)

  const matches = useMemo(() => (label ? findTrays(trays, label) : []), [trays, label])
  /** Previous seasons/samples this physical label has been used for. */
  const history = useMemo(
    () => (label ? findTrays(trays, label).slice().sort((a, b) => (b.inDate ?? '').localeCompare(a.inDate ?? '')) : []),
    [trays, label],
  )
  const sampleName = useMemo(() => new Map(samples.map((x) => [x.id, x.name])), [samples])
  const chosenSample = samples.find((x) => x.id === sampleId)

  async function stopCamera() {
    const inst = scannerRef.current
    scannerRef.current = null
    setScanning(false)
    if (inst) {
      try {
        await inst.stop()
      } catch {
        /* already stopped */
      }
    }
  }

  useEffect(() => () => void stopCamera(), [])

  async function startCamera() {
    setCamError(null)
    setResult(null)
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setCamError('Camera needs a secure (https) connection — type the tray number instead.')
      return
    }
    setScanning(true)
    try {
      const { Html5Qrcode } = await import('html5-qrcode')
      const inst = new Html5Qrcode(READER_ID)
      scannerRef.current = inst
      await inst.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: 220 },
        (text: string) => {
          const found = parseScan(text)
          if (!found) return
          void stopCamera()
          setLabel(found)
          setQuery(found)
        },
        () => {
          /* per-frame decode misses are normal */
        },
      )
    } catch (e) {
      setScanning(false)
      scannerRef.current = null
      setCamError(e instanceof Error ? e.message : 'Could not start the camera.')
    }
  }

  function lookup(text: string) {
    setResult(null)
    setLabel(parseScan(text))
  }

  async function save() {
    if (!label || !sampleId || !incubatorId) return
    setSaving(true)
    const r = await assignTray({ trayNumber: matches[0]?.trayNumber ?? label, sampleId, incubatorId })
    setSaving(false)
    if (!r.ok) {
      setResult({ ok: false, text: r.error ?? 'Could not save.' })
      return
    }
    const inc = incubators.find((i) => i.id === incubatorId)?.name ?? 'incubator'
    setResult({
      ok: true,
      text: `${matches[0]?.trayNumber ?? label} → ${chosenSample?.name ?? 'sample'} in ${inc}${
        r.created ? ' (new tray record)' : ''
      }`,
    })
    // Ready for the next tray; keep sample + incubator for a fast run.
    setLabel(null)
    setQuery('')
  }

  const selectCls = 'w-full rounded-sm border border-default bg-inset px-2 py-2 text-base text-primary'

  return (
    <div>
      <PageHeader title="Scan" subtitle="Scan a tray label to record its sample and incubator" />
      <div className="space-y-4 p-4 md:p-6">
        {!canEdit && <EmptyState>You have view-only access, so trays can't be assigned.</EmptyState>}

        {/* Scanner */}
        <div className="rounded-lg border border-subtle p-3">
          <div className="flex flex-wrap items-center gap-2">
            {!scanning ? (
              <button className="btn-primary" onClick={startCamera} disabled={!canEdit}>
                <Camera size={18} className="mr-1 inline" /> Scan a tray
              </button>
            ) : (
              <button className="btn-ghost" onClick={() => void stopCamera()}>
                <X size={18} className="mr-1 inline" /> Stop
              </button>
            )}
            <span className="text-xs text-faint">or type the number below</span>
          </div>

          {/* html5-qrcode injects the video here; keep it mounted while scanning */}
          <div id={READER_ID} className={scanning ? 'mt-3 overflow-hidden rounded-lg' : 'hidden'} />

          {camError && (
            <p className="mt-2 rounded-sm border border-default px-2 py-1.5 text-sm text-secondary">{camError}</p>
          )}

          <div className="mt-3 flex gap-2">
            <input
              className="input flex-1"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && lookup(query)}
              placeholder="e.g. Tray0417"
              inputMode="text"
              autoCapitalize="off"
              autoCorrect="off"
            />
            <button className="btn-ghost" onClick={() => lookup(query)} disabled={!query.trim()}>
              Find
            </button>
          </div>
        </div>

        {result && (
          <div
            className={`rounded-lg border px-3 py-2 text-sm ${
              result.ok ? 'border-default text-primary' : 'border-default text-danger'
            }`}
          >
            {result.ok ? <Check size={16} className="mr-1 inline" /> : null}
            {result.text}
          </div>
        )}

        {/* Assign */}
        {label && (
          <div className="space-y-3 rounded-lg border border-subtle p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-lg font-semibold text-primary">
                {matches[0]?.trayNumber ?? label}
              </span>
              {matches.length === 0 && <Badge tone="amber">not on record</Badge>}
              {matches.length > 0 && <Badge tone="green">{matches.length} record(s)</Badge>}
              <button className="btn-ghost ml-auto px-2 py-1 text-xs" onClick={() => setLabel(null)}>
                Clear
              </button>
            </div>

            {matches.length === 0 && (
              <p className="text-xs text-muted">
                No tray with this label exists yet — saving will create its first record.
              </p>
            )}

            {history.length > 0 && (
              <div className="text-xs text-muted">
                <div className="mb-1 font-mono uppercase tracking-wide text-faint">Previously</div>
                <ul className="space-y-0.5">
                  {history.slice(0, 4).map((t) => (
                    <li key={t.id}>
                      {t.sampleId ? sampleName.get(t.sampleId) ?? 'unknown sample' : 'no sample'} · {t.status}
                      {t.inDate ? ` · in ${t.inDate}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <label className="block">
              <span className="label">Sample in this tray</span>
              <select className={selectCls} value={sampleId} onChange={(e) => setSampleId(e.target.value)}>
                <option value="">Choose a sample…</option>
                {samples.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="label">Incubator</span>
              <select className={selectCls} value={incubatorId} onChange={(e) => setIncubatorId(e.target.value)}>
                <option value="">Choose an incubator…</option>
                {incubators.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            </label>

            <p className="text-xs text-faint">
              Weight is taken from the sample
              {chosenSample?.lbsPer2Gal != null ? ` (${chosenSample.lbsPer2Gal} lb/tray)` : ' (not recorded yet)'} and
              the date is stamped automatically.
            </p>

            <button className="btn-primary w-full py-3" onClick={save} disabled={!canEdit || !sampleId || !incubatorId || saving}>
              {saving ? 'Saving…' : 'Save tray'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
