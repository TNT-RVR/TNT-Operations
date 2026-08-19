import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Users, Tent, Layers3, WifiOff, Plus } from 'lucide-react'
import { useData } from '@/data/context'
import { supabase } from '@/data/supabaseClient'
import { SATELLITE_STYLE } from '../maps/basemap'
import { ProgressBar } from '@/components/ui'
import { useSession } from '@/auth/session'
import {
  crewStatus,
  sortCrews,
  crewOf,
  membersOf,
  leadOf,
  describeAssignment,
  type LiveCrew,
} from '@/domain/crews'

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

/** An assignment older than this has probably been forgotten rather than set. */
const ASSIGNMENT_STALE_H = 20

const staleAssignment = (iso: string) => Date.now() - Date.parse(iso) > ASSIGNMENT_STALE_H * 3600_000

const sinceDays = (iso: string) => {
  const h = (Date.now() - Date.parse(iso)) / 3600_000
  if (h < 48) return `${Math.round(h)} h ago`
  return `${Math.round(h / 24)} days ago`
}

const CREW_SHELTER = '#FFCE3A'
const CREW_TRAY = '#4ADE80'
const CREW_STALE = '#8A8A8A'

export default function CrewsView() {
  const {
    fields,
    crews,
    crewMembers,
    loadCrews,
    joinCrew,
    leaveCrew,
    createCrew,
    updateCrew,
    assignCrew,
    setCrewLead,
    addCrewMember,
    removeCrewMember,
  } = useData()
  const session = useSession()
  const me = session.user.id
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [newCrew, setNewCrew] = useState('')
  const [naming, setNaming] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameTo, setRenameTo] = useState('')
  const canEdit = session.can('field', 'edit')
  /**
   * Admin-only crew wrangling. Self-service needs the device in your hands;
   * this is for the office deciding on Sunday which iPad belongs to which
   * crew, or fixing a crew whose lead drove home with the iPad in a pocket.
   */
  const isAdmin = session.can('users', 'edit')
  const [managing, setManaging] = useState<string | null>(null)

  /** Run a crew action, surfacing whatever it refuses to do. */
  const act = async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true)
    setErr(null)
    const r = await fn()
    setBusy(false)
    if (!r.ok) setErr(r.error ?? 'That did not work.')
  }
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
        {/* Who I am with, then every crew. Both live here because they are the
            same question asked twice — "am I counted with the right people"
            and "who else is out today". */}
        <div className="mb-3 rounded-md border border-default p-2">
          {myCrew ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs uppercase tracking-wide text-faint">You are on</span>
              <span className="text-sm font-semibold text-primary">{myCrew.name}</span>
              {iAmLead ? (
                <span className="rounded-sm bg-brand/15 px-1.5 py-0.5 text-xs text-brand">
                  This device reports the position
                </span>
              ) : (
                <button
                  className="text-xs text-brand underline"
                  disabled={busy}
                  onClick={() => act(() => joinCrew(myCrew.id, true))}
                >
                  Report position from this device
                </button>
              )}
              <button
                className="ml-auto text-xs text-muted underline"
                disabled={busy}
                onClick={() => act(() => leaveCrew())}
              >
                Leave
              </button>
              {!myLead && (
                <p className="w-full text-xs text-amber-600">
                  Nobody on this crew is reporting a position — whoever has the iPad should tap
                  &ldquo;report position&rdquo;.
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted">
              You are not on a crew. Join one below so your work counts with the right people.
            </p>
          )}
        </div>

        {/* Every crew this season: who is on it, and the buttons to run it. */}
        <div className="mb-3 space-y-2">
          {crews
            .filter((c) => c.active || c.id === myCrewId)
            .map((c) => {
              const mates = membersOf(crewMembers, c.id)
              const lead = leadOf(crewMembers, c.id)
              const mine = c.id === myCrewId
              return (
                <div key={c.id} className="rounded-md border border-default p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {renaming === c.id ? (
                      <>
                        <input
                          className="input h-7 w-36 text-xs"
                          autoFocus
                          value={renameTo}
                          onChange={(e) => setRenameTo(e.target.value)}
                        />
                        <button
                          className="text-xs text-brand underline"
                          disabled={busy || !renameTo.trim()}
                          onClick={() =>
                            act(async () => {
                              const r = await updateCrew(c.id, { name: renameTo })
                              setRenaming(null)
                              return r
                            })
                          }
                        >
                          Save
                        </button>
                        <button className="text-xs text-muted underline" onClick={() => setRenaming(null)}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="text-sm font-semibold text-primary">{c.name}</span>
                        <span className="text-xs text-muted">
                          {mates.length} {mates.length === 1 ? 'person' : 'people'}
                          {lead ? '' : ' · no position reporter'}
                        </span>
                        {mine ? (
                          <span className="rounded-sm bg-brand/15 px-1.5 py-0.5 text-xs text-brand">You</span>
                        ) : (
                          <span className="ml-auto flex gap-2">
                            <button
                              className="text-xs text-brand underline"
                              disabled={busy}
                              onClick={() => act(() => joinCrew(c.id, false))}
                            >
                              Join
                            </button>
                            <button
                              className="text-xs text-muted underline"
                              title="Join and report this crew position from this device"
                              disabled={busy}
                              onClick={() => act(() => joinCrew(c.id, true))}
                            >
                              Join as iPad
                            </button>
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  {/* What this crew is on. Anyone can set it: the crew that
                      moves to the next quarter is the crew that knows. */}
                  {renaming !== c.id && (
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <select
                        className="rounded-sm border border-default bg-inset px-1.5 py-1 text-xs text-primary"
                        value={c.currentTask ?? ''}
                        disabled={busy}
                        onChange={(e) =>
                          act(() =>
                            assignCrew(c.id, {
                              fieldId: c.currentFieldId,
                              task: (e.target.value || null) as 'shelter' | 'tray' | null,
                            }),
                          )
                        }
                      >
                        <option value="">No job</option>
                        <option value="shelter">Shelters</option>
                        <option value="tray">Trays</option>
                      </select>
                      <select
                        className="max-w-[12rem] rounded-sm border border-default bg-inset px-1.5 py-1 text-xs text-primary"
                        value={c.currentFieldId ?? ''}
                        disabled={busy}
                        onChange={(e) =>
                          act(() =>
                            assignCrew(c.id, {
                              fieldId: e.target.value || null,
                              task: c.currentTask,
                            }),
                          )
                        }
                      >
                        <option value="">No field</option>
                        {fields.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                      </select>
                      {/* An assignment set days ago and forgotten is worth
                          spotting — it is the difference between "on trays at
                          Bow Island" and "was, on Tuesday". */}
                      {c.assignedAt && staleAssignment(c.assignedAt) && (
                        <span className="text-xs text-amber-600">set {sinceDays(c.assignedAt)}</span>
                      )}
                    </div>
                  )}
                  {/* Who is on this crew, and which device speaks for it.
                      Admins only: naming somebody else's device as the
                      reporter is not a decision to leave lying around on a
                      screen every crew has open. */}
                  {isAdmin && managing === c.id && (
                    <div className="mt-2 rounded-sm border border-default bg-inset p-2">
                      <div className="label">Crew members</div>
                      {mates.length === 0 ? (
                        <p className="text-xs text-muted">Nobody on this crew yet.</p>
                      ) : (
                        <ul className="mb-2 space-y-1">
                          {mates.map((m) => {
                            const u = session.users.find((x) => x.id === m.userId)
                            return (
                              <li key={m.id} className="flex items-center gap-2 text-xs">
                                <span className="text-primary">{u?.name ?? m.userId}</span>
                                {m.role === 'lead' ? (
                                  <span className="rounded-sm bg-brand/15 px-1.5 py-0.5 text-brand">
                                    reports position
                                  </span>
                                ) : (
                                  <button
                                    className="text-brand underline"
                                    disabled={busy}
                                    onClick={() => act(() => setCrewLead(c.id, m.userId))}
                                  >
                                    Make this the reporting device
                                  </button>
                                )}
                                <button
                                  className="ml-auto text-muted underline"
                                  disabled={busy}
                                  onClick={() => act(() => removeCrewMember(m.id))}
                                >
                                  Remove
                                </button>
                              </li>
                            )
                          })}
                        </ul>
                      )}

                      <div className="label">Add someone</div>
                      <select
                        className="w-full rounded-sm border border-default bg-raised px-1.5 py-1 text-xs text-primary"
                        value=""
                        disabled={busy}
                        onChange={(e) => {
                          const uid = e.target.value
                          if (uid) act(() => addCrewMember(c.id, uid, false))
                        }}
                      >
                        <option value="">Choose a person…</option>
                        {session.users
                          .filter((u) => !mates.some((m) => m.userId === u.id))
                          .map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                      </select>
                      <p className="mt-1 text-xs text-faint">
                        Adding somebody takes them off whatever crew they were on — one crew at a
                        time, same as joining from their own device.
                      </p>
                    </div>
                  )}

                  {(canEdit || isAdmin) && renaming !== c.id && (
                    <div className="mt-1 flex gap-3">
                      {isAdmin && (
                        <button
                          className="text-xs text-faint underline"
                          onClick={() => setManaging(managing === c.id ? null : c.id)}
                        >
                          {managing === c.id ? 'Done' : 'Manage people'}
                        </button>
                      )}
                      {canEdit && (
                        <button
                          className="text-xs text-faint underline"
                          onClick={() => {
                            setRenaming(c.id)
                            setRenameTo(c.name)
                          }}
                        >
                          Rename
                        </button>
                      )}
                      {canEdit && (
                      <button
                        className="text-xs text-faint underline"
                        disabled={busy || mates.length > 0}
                        title={
                          mates.length > 0
                            ? 'People are still on this crew — they have to leave first'
                            : 'Retire this crew for the season'
                        }
                        onClick={() => act(() => updateCrew(c.id, { active: false }))}
                      >
                        Retire
                      </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}

          {/* Creating a crew is not an admin job hidden on another screen:
              crews get made in the yard at the start of a day. */}
          {naming ? (
            <div className="flex gap-2">
              <input
                className="input h-8 flex-1 text-sm"
                autoFocus
                placeholder="Crew name"
                value={newCrew}
                onChange={(e) => setNewCrew(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setNaming(false)
                }}
              />
              <button
                className="btn-primary px-3 text-sm"
                disabled={busy || !newCrew.trim()}
                onClick={() =>
                  act(async () => {
                    const r = await createCrew(newCrew.trim())
                    setNaming(false)
                    setNewCrew('')
                    return r
                  })
                }
              >
                Create
              </button>
              <button className="btn-ghost px-3 text-sm" onClick={() => setNaming(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button className="btn-ghost w-full py-2 text-sm" onClick={() => setNaming(true)}>
              <Plus size={15} className="mr-1 inline" />
              New crew
            </button>
          )}
          {err && <p className="text-xs text-danger">{err}</p>}
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
                    {/* What they are SUPPOSED to be doing, from the assignment
                        — which survives the iPad locking, unlike the broadcast. */}
                    {(() => {
                      const assigned = crews.find((x) => x.name === c.name)
                      if (!assigned?.currentTask) return null
                      const fname = fields.find((f) => f.id === assigned.currentFieldId)?.name
                      return (
                        <span className="text-xs text-faint">{describeAssignment(assigned, fname)}</span>
                      )
                    })()}
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
                    <span className="tabular-nums text-xs text-secondary">
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
