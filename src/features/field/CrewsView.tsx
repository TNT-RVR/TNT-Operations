import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Users, Tent, Layers3, WifiOff } from 'lucide-react'
import { useData } from '@/data/context'
import { supabase } from '@/data/supabaseClient'
import { SATELLITE_STYLE } from '../maps/basemap'
import { ProgressBar } from '@/components/ui'
import { useSession } from '@/auth/session'
import { crewStatus, sortCrews, crewOf, membersOf, leadOf, type LiveCrew } from '@/domain/crews'

/**
 * Crews — where everyone is and how far along they are.
 *
 * Built on the position broadcast Field Mode already sends (channel
 * 'crew_live'), which the office map has listened to for a while. This puts
 * the same picture in the crews' own hands: a foreman in a truck wants to know
 * whether the second crew has finished the quarter before driving over there,
 * and the office map is no use to them.
 *
 * IMPORTANT: broadcasts are ephemeral. A crew that closes the app, loses
 * signal, or parks out of coverage stops appearing — which is honest, but must
 * never read as "that crew has stopped working". So positions carry an age and
 * go stale rather than vanishing on the instant, and the list says plainly
 * when it last heard from someone.
 */

const CREW_SHELTER = '#FFCE3A'
const CREW_TRAY = '#4ADE80'
const CREW_STALE = '#8A8A8A'

export default function CrewsView() {
  const { fields, crews, crewMembers, loadCrews, joinCrew, leaveCrew, createCrew } = useData()
  const session = useSession()
  const me = session.user.id
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [newCrew, setNewCrew] = useState('')
  const [naming, setNaming] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<maplibregl.Marker[]>([])
  const [ready, setReady] = useState(false)
  const [positions, setPositions] = useState<Record<string, LiveCrew>>({})
  /** Ticks so ages re-render without waiting on a broadcast. */
  const [, setTick] = useState(0)

  useEffect(() => {
    void loadCrews()
  }, [loadCrews])

  const myCrewId = useMemo(() => crewOf(crewMembers, me), [crewMembers, me])
  const myCrew = crews.find((c) => c.id === myCrewId) ?? null
  const myMates = useMemo(
    () => (myCrewId ? membersOf(crewMembers, myCrewId) : []),
    [crewMembers, myCrewId],
  )
  const myLead = myCrewId ? leadOf(crewMembers, myCrewId) : null
  const iAmLead = myLead?.userId === me

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: SATELLITE_STYLE,
      center: [-111.6, 49.83],
      zoom: 11,
      attributionControl: { compact: true },
    })
    mapRef.current = map
    map.on('style.load', () => setReady(true))
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Listen for crew positions. No pruning here — a crew that goes quiet is
  // shown as quiet, which is the fact worth knowing.
  useEffect(() => {
    if (!supabase) return
    const channel = supabase
      .channel('crew_live')
      .on('broadcast', { event: 'crew' }, ({ payload }) => {
        const c = payload as LiveCrew
        if (!c?.name || !Number.isFinite(c.lat) || !Number.isFinite(c.lng)) return
        setPositions((prev) => ({ ...prev, [c.name]: c }))
      })
      .subscribe()
    const t = setInterval(() => setTick((n) => n + 1), 15_000)
    return () => {
      clearInterval(t)
      supabase?.removeChannel(channel)
    }
  }, [])

  const rows = useMemo(() => sortCrews(Object.values(positions)), [positions])

  // Draw a pin per crew, coloured by job and faded once stale.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    markersRef.current.forEach((m) => m.remove())
    markersRef.current = []

    for (const c of rows) {
      const status = crewStatus(c)
      const colour = status.stale ? CREW_STALE : c.task === 'tray' ? CREW_TRAY : CREW_SHELTER
      const el = document.createElement('div')
      el.style.cssText =
        `display:flex;align-items:center;gap:4px;padding:3px 7px;border-radius:9999px;` +
        `background:${colour};color:#111;font:600 11px/1.2 system-ui;white-space:nowrap;` +
        `border:2px solid rgba(0,0,0,.55);box-shadow:0 1px 4px rgba(0,0,0,.5);` +
        `opacity:${status.stale ? 0.65 : 1}`
      el.textContent = `${c.name} · ${c.placed}/${c.total}`
      el.title = `${c.fieldName} — ${status.label}`
      markersRef.current.push(
        new maplibregl.Marker({ element: el }).setLngLat([c.lng, c.lat]).addTo(map),
      )
    }

    // Frame everyone, but only when there is more than one place to look —
    // re-fitting on every broadcast would yank the map while someone reads it.
    if (rows.length > 0 && markersRef.current.length !== 0) {
      const b = new maplibregl.LngLatBounds()
      for (const c of rows) b.extend([c.lng, c.lat])
      map.fitBounds(b, { padding: 60, maxZoom: 15, duration: 600 })
    }
  }, [rows, ready])

  const fieldName = (id: string) => fields.find((f) => f.id === id)?.name

  return (
    <div className="flex h-full flex-col">
      <div ref={containerRef} className="min-h-[45%] flex-1" />

      <div className="max-h-[55%] shrink-0 overflow-y-auto border-t border-default bg-raised p-3">
        {/* Who I am with. First thing on the screen because it is the thing a
            person changes — the map answers "where is everyone", this answers
            "am I counted with the right people". */}
        <div className="mb-3 rounded-md border border-default p-2">
          {myCrew ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-primary">{myCrew.name}</span>
                {iAmLead && (
                  <span className="rounded-sm bg-brand/15 px-1.5 py-0.5 text-xs text-brand">
                    This device reports the crew&apos;s position
                  </span>
                )}
                <button
                  className="ml-auto text-xs text-muted underline"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true)
                    const r = await leaveCrew()
                    setBusy(false)
                    if (!r.ok) setErr(r.error ?? 'Could not leave.')
                  }}
                >
                  Leave
                </button>
              </div>
              <p className="mt-1 text-xs text-muted">
                {myMates.length} on this crew
                {!myLead && ' · nobody is reporting position — whoever has the iPad should take the lead'}
              </p>
              {!iAmLead && (
                <button
                  className="mt-1 text-xs text-brand underline"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true)
                    const r = await joinCrew(myCrew.id, true)
                    setBusy(false)
                    if (!r.ok) setErr(r.error ?? 'Could not take the lead.')
                  }}
                >
                  Use THIS device for the crew&apos;s position
                </button>
              )}
            </>
          ) : (
            <>
              <div className="text-sm font-semibold text-primary">You are not on a crew</div>
              <p className="mb-2 mt-1 text-xs text-muted">
                Join one so your work counts with the right people. The crew&apos;s iPad should join as
                the position reporter.
              </p>
              <div className="flex flex-wrap gap-2">
                {crews.map((c) => (
                  <span key={c.id} className="flex overflow-hidden rounded-sm border border-default">
                    <button
                      className="px-2 py-1 text-xs"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true)
                        const r = await joinCrew(c.id, false)
                        setBusy(false)
                        if (!r.ok) setErr(r.error ?? 'Could not join.')
                      }}
                    >
                      Join {c.name}
                    </button>
                    <button
                      className="border-l border-default px-2 py-1 text-xs text-brand"
                      title="Join and report this crew's position from this device"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true)
                        const r = await joinCrew(c.id, true)
                        setBusy(false)
                        if (!r.ok) setErr(r.error ?? 'Could not join.')
                      }}
                    >
                      as iPad
                    </button>
                  </span>
                ))}
                {naming ? (
                  <span className="flex gap-1">
                    <input
                      className="input h-7 w-28 text-xs"
                      value={newCrew}
                      autoFocus
                      placeholder="Crew name"
                      onChange={(e) => setNewCrew(e.target.value)}
                    />
                    <button
                      className="text-xs text-brand underline"
                      disabled={busy || !newCrew.trim()}
                      onClick={async () => {
                        setBusy(true)
                        const r = await createCrew(newCrew.trim())
                        setBusy(false)
                        setNaming(false)
                        setNewCrew('')
                        if (!r.ok) setErr(r.error ?? 'Could not create the crew.')
                      }}
                    >
                      Add
                    </button>
                  </span>
                ) : (
                  <button className="text-xs text-muted underline" onClick={() => setNaming(true)}>
                    New crew
                  </button>
                )}
              </div>
            </>
          )}
          {err && <p className="mt-1 text-xs text-danger">{err}</p>}
        </div>

        {rows.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Users size={16} />
            No crews reporting. A crew appears here once someone opens Shelters or Trays with a
            field selected.
          </div>
        ) : (
          <ul className="space-y-2">
            {rows.map((c) => {
              const status = crewStatus(c)
              const pct = c.total > 0 ? Math.round((c.placed / c.total) * 100) : 0
              return (
                <li key={c.name} className="rounded-md border border-default p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {c.task === 'tray' ? (
                      <Layers3 size={15} className="text-green-500" />
                    ) : (
                      <Tent size={15} style={{ color: CREW_SHELTER }} />
                    )}
                    <span className="font-semibold text-primary">{c.name}</span>
                    <span className="text-sm text-secondary">
                      {fieldName(c.fieldId) ?? c.fieldName}
                    </span>
                    <span
                      className={`ml-auto flex items-center gap-1 text-xs ${
                        status.stale ? 'text-danger' : 'text-faint'
                      }`}
                    >
                      {status.stale && <WifiOff size={12} />}
                      {status.label}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex-1">
                      <ProgressBar pct={pct} tone={pct === 100 ? 'green' : 'brand'} />
                    </div>
                    <span className="font-mono text-xs text-secondary">
                      {c.placed}/{c.total}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
