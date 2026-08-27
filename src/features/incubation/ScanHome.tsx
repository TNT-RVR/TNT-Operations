import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Camera, Undo2, RotateCw } from 'lucide-react'
import { PageHeader, Badge, EmptyState } from '@/components/ui'
import { useData } from '@/data/context'
import { useSession } from '@/auth/session'

import { parseScan, findTrays } from './trayLookup'
import { ScannerOverlay, type ScanFeedback } from './ScannerOverlay'
import { trayWeightKg } from '@/domain/incubation'

/** Ignore the same code re-decoding while it sits in frame. */
const SAME_CODE_COOLDOWN_MS = 2500

/** Minimal shape of a WakeLockSentinel (not in every TS lib version). */
interface WakeLockLike {
  release: () => Promise<void>
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
function blip(kind: 'ok' | 'warn') {
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
  const { trays, samples, incubators, assignTray, loadTrays } = useData()
  // Trays aren't hydrated on mount (thousands of rows); this screen needs them.
  useEffect(() => {
    void loadTrays()
  }, [loadTrays])
  const s = useSession()
  const canEdit = s.can('incubation', 'edit')
  const [params] = useSearchParams()

  const [sampleId, setSampleId] = useState('')
  const [incubatorId, setIncubatorId] = useState(params.get('incubator') ?? '')
  const [scanning, setScanning] = useState(false)
  const [entries, setEntries] = useState<Entry[]>([])
  const [manual, setManual] = useState('')
  /** Last scan result, flashed over the camera. */
  const [feedback, setFeedback] = useState<ScanFeedback | null>(null)
  const seqRef = useRef(0)
  const flash = (kind: ScanFeedback['kind'], title: string, detail?: string) =>
    setFeedback({ kind, title, detail, seq: ++seqRef.current })

  const lastRef = useRef<{ label: string; at: number }>({ label: '', at: 0 })
  /** Labels already accepted this session — the guard against double-counting. */
  const seenRef = useRef<Set<string>>(new Set())
  const wakeRef = useRef<WakeLockLike | null>(null)
  /** Live copies so the scan callback isn't rebound (which would restart the camera). */
  const ctxRef = useRef({ sampleId, incubatorId, trays, samples })
  ctxRef.current = { sampleId, incubatorId, trays, samples }

  const sample = samples.find((x) => x.id === sampleId)
  const incubator = incubators.find((i) => i.id === incubatorId)
  /** Looked up from the sample, so a corrected x-ray reaches every tray. */
  const weightKg = trayWeightKg(sample)
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
        blip('warn')
        flash('warn', canonical, `Already scanned into ${sName}`)
        setEntries((prev) => [
          { key: `${seenKey}-${now}`, label: canonical, state: 'duplicate', sampleId: sid, sampleName: sName },
          ...prev,
        ])
        return
      }
      seenRef.current.add(seenKey)
      blip('ok')
      flash('ok', canonical, `→ ${sName}`)

      const key = `${seenKey}-${now}`
      setEntries((prev) => [
        { key, label: canonical, state: 'saving', sampleId: sid, sampleName: sName },
        ...prev,
      ])
      // Fire and forget: the camera must never wait on the network.
      void assignTray({ trayNumber: canonical, sampleId: sid, incubatorId: iid }).then((r) => {
        setEntries((prev) =>
          prev.map((e) =>
            e.key === key
              ? { ...e, state: r.ok ? 'ok' : 'error', error: r.error, created: r.created }
              : e,
          ),
        )
        // A save that failed must not be left looking like a successful scan.
        if (!r.ok) {
          blip('warn')
          flash('error', canonical, r.error ?? "Didn't save — check the connection")
          seenRef.current.delete(seenKey)
        }
      })
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

  const stopCamera = useCallback(() => {
    setScanning(false)
    releaseWakeLock()
  }, [releaseWakeLock])

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

  function startCamera() {
    setScanning(true)
    void acquireWakeLock()
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
            <span className="text-secondary">{incubator?.name}</span>
            {weightKg != null ? (
              <>
                {' '}
                at <span className="text-secondary">{weightKg.toFixed(2)} kg/tray</span>
              </>
            ) : (
              <span className="text-danger"> — this sample has no Kg for 2 gal recorded</span>
            )}
            . Today's date is stamped automatically.
          </p>
        )}

        {/* Counter + camera */}
        <div className="rounded-lg border border-subtle p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <div className="text-3xl font-bold text-primary tabular-nums">{okCount}</div>
              <div className="text-xs text-faint">trays this run</div>
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
                              <button className="btn-primary" onClick={startCamera} disabled={!ready}>
                  <Camera size={18} className="mr-1 inline" /> Start scanning
                </button>
            </div>
          </div>

          {!ready && <p className="text-xs text-muted">Choose a sample and incubator to start.</p>}



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

        <ScannerOverlay
          open={scanning}
          title={`${okCount} scanned · ${sample?.name ?? ''}`}
          feedback={feedback}
          onScan={record}
          onClose={stopCamera}
          footer={
            ready ? (
              <div className="space-y-2">
                {recentSamples.length > 1 && (
                  <div className="flex flex-wrap gap-1">
                    {recentSamples.map((r) => (
                      <button
                        key={r.id}
                        onClick={() => setSampleId(r.id)}
                        className={`rounded-sm px-2 py-1 text-xs transition ${
 r.id === sampleId ? 'bg-brand text-on-brand' : 'text-secondary'
                        }`}
                      >
                        {r.name} · {r.count}
                      </button>
                    ))}
                  </div>
                )}
              <label className="flex items-center gap-2">
                <span className="label shrink-0">Now filling</span>
                <select
                  className="min-w-0 flex-1 rounded-sm border border-default bg-inset px-2 py-2 text-base text-primary"
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
              </div>
            ) : null
          }
        />

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
