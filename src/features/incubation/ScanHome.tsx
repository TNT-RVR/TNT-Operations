import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Camera, X, Undo2, RotateCw } from 'lucide-react'
import { PageHeader, Badge, EmptyState } from '@/components/ui'
import { useData } from '@/data/context'
import { useSession } from '@/auth/session'
import type { Tray } from '@/data/types'

const READER_ID = 'tray-qr-reader'
/** Ignore the same code re-decoding while it sits in frame. */
const SAME_CODE_COOLDOWN_MS = 2500

/** Minimal shape of a WakeLockSentinel (not in every TS lib version). */
interface WakeLockLike {
  release: () => Promise<void>
}

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

type EntryState = 'saving' | 'ok' | 'error' | 'duplicate'
interface Entry {
  key: string
  label: string
  state: EntryState
  /** Which sample this tray went to — samples change mid-run. */
  sampleId: string
  sampleName: string
  error?: string
  created?: boolean
}

/** Short blip so a scan can be confirmed by ear — you're looking at trays, not the phone. */
function feedback(kind: 'ok' | 'warn') {
  try {
    navigator.vibrate?.(kind === 'ok' ? 40 : [30, 60, 30])
  } catch {
    /* vibration is best-effort */
  }
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = kind === 'ok' ? 880 : 300
    gain.gain.value = 0.06
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.09)
    setTimeout(() => void ctx.close(), 300)
  } catch {
    /* audio is best-effort */
  }
}

export default function ScanHome() {
  const { trays, samples, incubators, assignTray } = useData()
  const s = useSession()
  const canEdit = s.can('incubation', 'edit')
  const [params] = useSearchParams()

  const [sampleId, setSampleId] = useState('')
  const [incubatorId, setIncubatorId] = useState(params.get('incubator') ?? '')
  const [scanning, setScanning] = useState(false)
  const [camError, setCamError] = useState<string | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [manual, setManual] = useState('')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scannerRef = useRef<any>(null)
  const lastRef = useRef<{ label: string; at: number }>({ label: '', at: 0 })
  /** Labels already accepted this session — the guard against double-counting. */
  const seenRef = useRef<Set<string>>(new Set())
  const wakeRef = useRef<WakeLockLike | null>(null)
  /** Live copies so the scan callback isn't rebound (which would restart the camera). */
  const ctxRef = useRef({ sampleId, incubatorId, trays, samples })
  ctxRef.current = { sampleId, incubatorId, trays, samples }

  const sample = samples.find((x) => x.id === sampleId)
  const incubator = incubators.find((i) => i.id === incubatorId)
  const ready = !!sampleId && !!incubatorId && canEdit
  const okCount = entries.filter((e) => e.state === 'ok').length
  const failed = entries.filter((e) => e.state === 'error')

  /** Samples used this run, most-used first — one-tap switching back and forth. */
  const recentSamples = (() => {
    const counts = new Map<string, { id: string; name: string; count: number }>()
    for (const e of entries) {
      if (e.state === 'duplicate') continue
      const cur = counts.get(e.sampleId)
      if (cur) cur.count++
      else counts.set(e.sampleId, { id: e.sampleId, name: e.sampleName, count: 1 })
    }
    if (sampleId && !counts.has(sampleId)) {
      counts.set(sampleId, { id: sampleId, name: sample?.name ?? 'sample', count: 0 })
    }
    return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 6)
  })()

  const record = useCallback(
    (rawLabel: string) => {
      const label = parseScan(rawLabel)
      if (!label) return
      const { sampleId: sid, incubatorId: iid, trays: allTrays } = ctxRef.current
      if (!sid || !iid) return

      const now = Date.now()
      if (label === lastRef.current.label && now - lastRef.current.at < SAME_CODE_COOLDOWN_MS) return
      lastRef.current = { label, at: now }

      const canonical = findTrays(allTrays, label)[0]?.trayNumber ?? label
      const sName = ctxRef.current.samples.find((x) => x.id === sid)?.name ?? 'sample'
      // Keyed by sample too: re-scanning a tray AFTER switching samples is a
      // real correction (it went in the wrong lot), not a double-scan.
      const seenKey = `${sid}|${canonical}`
      if (seenRef.current.has(seenKey)) {
        feedback('warn')
        setEntries((prev) => [
          { key: `${seenKey}-${now}`, label: canonical, state: 'duplicate', sampleId: sid, sampleName: sName },
          ...prev,
        ])
        return
      }
      seenRef.current.add(seenKey)
      feedback('ok')

      const key = `${seenKey}-${now}`
      setEntries((prev) => [
        { key, label: canonical, state: 'saving', sampleId: sid, sampleName: sName },
        ...prev,
      ])
      // Fire and forget: the camera must never wait on the network.
      void assignTray({ trayNumber: canonical, sampleId: sid, incubatorId: iid }).then((r) =>
        setEntries((prev) =>
          prev.map((e) =>
            e.key === key
              ? { ...e, state: r.ok ? 'ok' : 'error', error: r.error, created: r.created }
              : e,
          ),
        ),
      )
    },
    [assignTray],
  )

  /** Keep the screen awake during a run — a phone locking mid-batch is a stall. */
  const acquireWakeLock = useCallback(async () => {
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<WakeLockLike> } }
    if (!nav.wakeLock) return
    try {
      wakeRef.current = await nav.wakeLock.request('screen')
    } catch {
      /* denied or unsupported — scanning still works, the screen just sleeps */
    }
  }, [])

  const releaseWakeLock = useCallback(() => {
    const w = wakeRef.current
    wakeRef.current = null
    try {
      void w?.release()
    } catch {
      /* best-effort */
    }
  }, [])

  const stopCamera = useCallback(async () => {
    const inst = scannerRef.current
    scannerRef.current = null
    setScanning(false)
    releaseWakeLock()
    if (inst) {
      try {
        await inst.stop()
      } catch {
        /* already stopped */
      }
    }
  }, [releaseWakeLock])

  useEffect(() => () => void stopCamera(), [stopCamera])

  // The browser drops a wake lock whenever the page is hidden (a call, a
  // notification, pocketing the phone), so take it again on return.
  useEffect(() => {
    if (!scanning) return
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !wakeRef.current) void acquireWakeLock()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [scanning, acquireWakeLock])

  async function startCamera() {
    setCamError(null)
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setCamError('Camera needs a secure (https) connection — type labels below instead.')
      return
    }
    setScanning(true)
    void acquireWakeLock()
    try {
      const { Html5Qrcode } = await import('html5-qrcode')
      const inst = new Html5Qrcode(READER_ID)
      scannerRef.current = inst
      // Camera stays running across scans — restarting it for each of 600 trays
      // would cost minutes and break the rhythm.
      await inst.start({ facingMode: 'environment' }, { fps: 10, qrbox: 250 }, record, () => {})
    } catch (e) {
      setScanning(false)
      scannerRef.current = null
      setCamError(e instanceof Error ? e.message : 'Could not start the camera.')
    }
  }

  function undoLast() {
    const last = entries[0]
    if (!last) return
    seenRef.current.delete(`${last.sampleId}|${last.label}`)
    lastRef.current = { label: '', at: 0 }
    setEntries((prev) => prev.slice(1))
  }

  function retryFailed() {
    for (const e of failed) {
      setEntries((prev) => prev.map((x) => (x.key === e.key ? { ...x, state: 'saving' } : x)))
      void assignTray({ trayNumber: e.label, sampleId: e.sampleId, incubatorId }).then((r) =>
        setEntries((prev) =>
          prev.map((x) => (x.key === e.key ? { ...x, state: r.ok ? 'ok' : 'error', error: r.error } : x)),
        ),
      )
    }
  }

  function startOver() {
    seenRef.current = new Set()
    lastRef.current = { label: '', at: 0 }
    setEntries([])
  }

  const selectCls = 'w-full rounded-sm border border-default bg-inset px-2 py-2 text-base text-primary'
  const tone: Record<EntryState, 'green' | 'amber' | 'red' | 'brand'> = {
    ok: 'green',
    saving: 'brand',
    duplicate: 'amber',
    error: 'red',
  }

  return (
    <div>
      <PageHeader title="Scan" subtitle="Pick the sample once, then scan tray after tray" />
      <div className="space-y-4 p-4 md:p-6">
        {!canEdit && <EmptyState>You have view-only access, so trays can't be assigned.</EmptyState>}

        {/* Setup — sample and incubator stay fixed for the whole run */}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">Sample</span>
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
        </div>

        {ready && (
          <p className="text-xs text-faint">
            Every scan goes to <span className="text-secondary">{sample?.name}</span> in{' '}
            <span className="text-secondary">{incubator?.name}</span> at{' '}
            {sample?.lbsPer2Gal != null ? `${sample.lbsPer2Gal} lb/tray` : 'no recorded weight'}. Today's date is
            stamped automatically.
          </p>
        )}

        {/* Counter + camera */}
        <div className="rounded-lg border border-subtle p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <div className="font-mono text-3xl font-bold text-primary tabular-nums">{okCount}</div>
              <div className="font-mono text-xs uppercase tracking-wide text-faint">trays this run</div>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {entries.length > 0 && (
                <button className="btn-ghost px-2 py-1 text-xs" onClick={undoLast}>
                  <Undo2 size={14} className="mr-1 inline" />
                  Undo
                </button>
              )}
              {entries.length > 0 && (
                <button className="btn-ghost px-2 py-1 text-xs" onClick={startOver}>
                  Reset
                </button>
              )}
              {!scanning ? (
                <button className="btn-primary" onClick={startCamera} disabled={!ready}>
                  <Camera size={18} className="mr-1 inline" /> Start scanning
                </button>
              ) : (
                <button className="btn-ghost" onClick={() => void stopCamera()}>
                  <X size={18} className="mr-1 inline" /> Stop
                </button>
              )}
            </div>
          </div>

          {!ready && <p className="text-xs text-muted">Choose a sample and incubator to start.</p>}

          {/* Sample switcher, kept right on the camera. Samples change often
              mid-run, and scrolling back up to the setup row would stall it.
              Also shown once a run has started, so manual entry gets it too. */}
          {(scanning || entries.length > 0) && ready && (
            <div className="mb-2 space-y-2 rounded-sm border border-default p-2">
              <label className="flex items-center gap-2">
                <span className="label shrink-0">Now filling</span>
                <select
                  className="min-w-0 flex-1 rounded-sm border border-default bg-inset px-2 py-1.5 text-base text-primary"
                  value={sampleId}
                  onChange={(e) => setSampleId(e.target.value)}
                >
                  {samples.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </label>
              {recentSamples.length > 1 && (
                <div className="flex flex-wrap gap-1">
                  {recentSamples.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setSampleId(r.id)}
                      className={`rounded-sm px-2 py-1 font-mono text-xs transition ${
                        r.id === sampleId
                          ? 'bg-brand text-on-brand'
                          : 'text-secondary hover:bg-[color:var(--hover-wash)]'
                      }`}
                    >
                      {r.name} · {r.count}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* html5-qrcode injects the video here; keep it mounted while scanning */}
          <div id={READER_ID} className={scanning ? 'overflow-hidden rounded-lg' : 'hidden'} />

          {camError && (
            <p className="mt-2 rounded-sm border border-default px-2 py-1.5 text-sm text-secondary">{camError}</p>
          )}

          {/* Manual entry — for a damaged label, or when the camera is unavailable */}
          <div className="mt-3 flex gap-2">
            <input
              className="input flex-1"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || !manual.trim()) return
                record(manual)
                setManual('')
              }}
              placeholder="Type a label, press Enter"
              inputMode="text"
              autoCapitalize="off"
              autoCorrect="off"
              disabled={!ready}
            />
            <button
              className="btn-ghost"
              disabled={!ready || !manual.trim()}
              onClick={() => {
                record(manual)
                setManual('')
              }}
            >
              Add
            </button>
          </div>
        </div>

        {failed.length > 0 && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-default px-3 py-2 text-sm">
            <span className="text-danger">
              {failed.length} didn’t save{failed[0].error ? ` — ${failed[0].error}` : ''}
            </span>
            <button className="btn-ghost px-2 py-1 text-xs" onClick={retryFailed}>
              <RotateCw size={14} className="mr-1 inline" />
              Retry
            </button>
          </div>
        )}

        {/* Run log, newest first */}
        {entries.length > 0 && (
          <ul className="divide-y divide-subtle rounded-lg border border-subtle">
            {entries.slice(0, 60).map((e) => (
              <li key={e.key} className="flex items-center gap-2 px-3 py-1.5">
                <span className="font-mono text-sm text-primary">{e.label}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted">{e.sampleName}</span>
                {e.state === 'duplicate' && <span className="text-xs text-muted">already scanned</span>}
                {e.created && e.state === 'ok' && <span className="text-xs text-faint">new</span>}
                <Badge tone={tone[e.state]}>{e.state === 'ok' ? 'saved' : e.state}</Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
