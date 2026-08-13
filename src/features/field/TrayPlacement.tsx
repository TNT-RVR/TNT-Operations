import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { type GeoJSONSource } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Crosshair, Mountain, Layers, Camera } from 'lucide-react'
import { useData } from '@/data/context'
import { useSession } from '@/auth/session'
import { supabase } from '@/data/supabaseClient'
import { crewOf, shouldBroadcastPosition } from '@/domain/crews'
import { decideTrayRelease } from '@/domain/trayRelease'
import { ScheduledJob } from './ScheduledJob'
import { ScannerOverlay, type ScanFeedback } from '@/features/incubation/ScannerOverlay'
import { parseScan } from '@/features/incubation/trayLookup'
import { Button } from '@/components/ui'
import type { Field } from '@/data/types'
import { getTentPositions } from '@/domain/tentGrid'
import { applyShelterOverrides, type ShelterOverrides } from '@/domain/shelterOverrides'
import { nextHeading, cameraFor, shouldMoveCamera } from '@/domain/navView'
import { SATELLITE_STYLE } from '../maps/basemap'
import {
  addFieldLayers,
  updateFieldLayers,
  DEFAULT_LAYERS,
  LAYER_TOGGLES,
  PIN,
  PIN_OUTLINE,
} from './fieldLayers'

/**
 * Tray Placement — putting trays into shelters that are already out.
 *
 * The map and the shelter grid are the same ones Shelter Maps produces, so a
 * crew sees the identical layout the office planned. What a tray crew does
 * with a shelter once they reach it is still to be defined; this view stands
 * up the part that is certain — where the shelters are and where you are
 * relative to them — without inventing a workflow nobody asked for.
 *
 * Deliberately NOT a copy of Shelter Placement's mark-as-placed flow: the two
 * jobs count different things, and guessing at tray semantics now would mean
 * unpicking it later.
 */

const GPS_BLUE = '#5AA9E6'
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

export default function TrayPlacement() {
  const {
    fields,
    crews,
    crewMembers,
    loadCrews,
    shelterTrayLinks,
    trays,
    loadTrays,
    placedShelters,
    releaseTrayToShelter,
  } = useData()
  const session = useSession()
  const mapped = useMemo(() => fields.filter((f) => f.geometry), [fields])
  const [fieldId, setFieldId] = useState<string | null>(null)
  const field: Field | null = useMemo(
    () => mapped.find((f) => f.id === fieldId) ?? mapped[0] ?? null,
    [mapped, fieldId],
  )

  /** The same shelter positions Shelter Maps drew, from the same geometry. */
  const pins = useMemo(() => {
    const g = field?.geometry
    if (!g) return []
    try {
      const raw = getTentPositions(g)
      return String(g.shelter_mode ?? '') === 'manual'
        ? raw.map((p, i) => ({ ...p, gridIdx: i }))
        : applyShelterOverrides(raw, g.shelter_overrides as ShelterOverrides | undefined)
    } catch {
      return []
    }
  }, [field])

  useEffect(() => {
    void loadCrews()
  }, [loadCrews])

  /**
   * A tray crew has to appear on the Crews map too — a crew that is invisible
   * because of which screen it has open is the failure this whole feature
   * exists to remove. Same rule as shelter placement: only the lead device
   * reports, and someone on no crew reports as themselves.
   */
  const myCrewId = crewOf(crewMembers, session.user.id)
  const myCrew = crews.find((c) => c.id === myCrewId) ?? null
  const broadcastAs = myCrewId
    ? shouldBroadcastPosition(crewMembers, session.user.id)
      ? (myCrew?.name ?? session.user.name)
      : null
    : session.user.name

  useEffect(() => {
    void loadTrays()
  }, [loadTrays])

  const [scanning, setScanning] = useState(false)
  const [feedback, setFeedback] = useState<ScanFeedback | null>(null)
  const [log, setLog] = useState<Array<{ label: string; text: string; ok: boolean; at: number }>>([])
  /** A tray already in another shelter, waiting on replace-or-skip. */
  const [moveAsk, setMoveAsk] = useState<{ trayId: string; label: string; from: string } | null>(null)
  const seqRef = useRef(0)
  const lastRef = useRef<{ label: string; at: number }>({ label: '', at: 0 })
  const [gpsFix, setGpsFix] = useState<{ lat: number; lng: number } | null>(null)

  /**
   * The shelter trays are going into: the nearest one already PLACED in this
   * field. Not the nearest grid pin — a tray goes into a shelter that exists,
   * and the link is to the placed shelter's record.
   */
  const targetShelter = useMemo(() => {
    const here = placedShelters.filter(
      (p) => p.fieldId === field?.id && p.status === 'placed' && p.lat != null && p.lng != null,
    )
    if (here.length === 0 || !gpsFix) return here[0] ?? null
    let best = here[0]
    let bestD = Infinity
    for (const p of here) {
      const d = Math.hypot(
        (p.lng! - gpsFix.lng) * 71_700,
        (p.lat! - gpsFix.lat) * 111_320,
      )
      if (d < bestD) {
        bestD = d
        best = p
      }
    }
    return { ...best, dist: bestD }
  }, [placedShelters, field?.id, gpsFix])

  const trayCount = useMemo(
    () => (targetShelter ? shelterTrayLinks.filter((l) => l.shelterId === targetShelter.id).length : 0),
    [shelterTrayLinks, targetShelter],
  )

  const note = (label: string, text: string, ok: boolean) =>
    setLog((prev) => [{ label, text, ok, at: Date.now() }, ...prev].slice(0, 30))

  const flash = (kind: ScanFeedback['kind'], title: string, detail?: string) => {
    setFeedback({ kind, title, detail, seq: ++seqRef.current })
    try {
      navigator.vibrate?.(kind === 'ok' ? 40 : [30, 60, 30])
    } catch {
      /* best-effort */
    }
  }

  async function handleScan(text: string) {
    const label = parseScan(text)
    if (!label || !targetShelter) return
    const now = Date.now()
    // The same code re-decoding while it sits in frame is not a second tray.
    if (label === lastRef.current.label && now - lastRef.current.at < 2000) return
    lastRef.current = { label, at: now }

    const d = decideTrayRelease({ label, shelterId: targetShelter.id, trays, links: shelterTrayLinks })
    if (d.action === 'unknown') {
      flash('error', label, 'No tray with that number.')
      return note(label, 'Not a known tray', false)
    }
    if (d.action === 'already-here') {
      flash('warn', d.tray.trayNumber, 'Already in this shelter.')
      return note(d.tray.trayNumber, 'Already here', true)
    }
    if (d.action === 'confirm-move') {
      flash('warn', d.tray.trayNumber, 'Already in another shelter — move it?')
      setMoveAsk({ trayId: d.tray.id, label: d.tray.trayNumber, from: d.fromShelterId })
      setScanning(false)
      return
    }

    const r = await releaseTrayToShelter({
      trayId: d.tray.id,
      shelterId: targetShelter.id,
      crewId: myCrewId,
    })
    if (!r.ok) {
      flash('error', d.tray.trayNumber, r.error ?? 'Could not save.')
      return note(d.tray.trayNumber, r.error ?? 'Could not save', false)
    }
    flash(d.caveat ? 'warn' : 'ok', d.tray.trayNumber, d.caveat ?? 'Placed · out of incubator')
    note(d.tray.trayNumber, d.caveat ? 'Placed (was not in an incubator)' : 'Placed · released', true)
  }

  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const gpsMarkerRef = useRef<maplibregl.Marker | null>(null)
  const headingRef = useRef<number | null>(null)
  const [ready, setReady] = useState(false)
  const [layersOpen, setLayersOpen] = useState(false)
  const [show, setShow] = useState(DEFAULT_LAYERS)
  /** Marker pins live outside the map's layer list; kept to be removed. */
  const pinMarkersRef = useRef<maplibregl.Marker[]>([])
  const [follow, setFollow] = useState(true)
  const followRef = useRef(follow)
  followRef.current = follow
  const [navMode, setNavMode] = useState<'drive' | 'overhead'>(
    () => (localStorage.getItem('field.navMode') as 'drive' | 'overhead') ?? 'drive',
  )
  const navModeRef = useRef(navMode)
  navModeRef.current = navMode

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: SATELLITE_STYLE,
      center: [-111.6, 49.83],
      zoom: 13,
      pitch: navMode === 'drive' ? 60 : 0,
      attributionControl: { compact: true },
    })
    mapRef.current = map
    map.on('style.load', () => {
      addFieldLayers(map)

      map.addSource('pins', { type: 'geojson', data: EMPTY })
      map.addLayer({
        id: 'pins-dot',
        type: 'circle',
        source: 'pins',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 4, 16, 9],
          'circle-color': PIN,
          'circle-stroke-color': PIN_OUTLINE,
          'circle-stroke-width': 2,
        },
      })
      setReady(true)
    })
    return () => {
      pinMarkersRef.current.forEach((m) => m.remove())
      pinMarkersRef.current = []
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Field geometry + shelter pins.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const g = field?.geometry as Record<string, unknown> | undefined
    pinMarkersRef.current.forEach((m) => m.remove())
    pinMarkersRef.current = updateFieldLayers(map, g, pins, show)

    ;(map.getSource('pins') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: pins.map((p) => ({
        type: 'Feature',
        properties: { gridIdx: p.gridIdx },
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      })),
    })

    if (pins.length && !followRef.current) {
      const b = new maplibregl.LngLatBounds()
      for (const p of pins) b.extend([p.lng, p.lat])
      map.fitBounds(b, { padding: 50, duration: 500 })
    }
  }, [field, pins, ready, show])

  // GPS — same driving view as Shelter Placement, so the two feel identical.
  useEffect(() => {
    if (!('geolocation' in navigator)) return
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const map = mapRef.current
        if (!map) return
        const fix = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        gpsRef.current = fix
        setGpsFix(fix)
        headingRef.current = nextHeading(headingRef.current, {
          heading: pos.coords.heading,
          speed: pos.coords.speed,
        })
        if (!gpsMarkerRef.current) {
          const el = document.createElement('div')
          el.style.cssText =
            `width:0;height:0;border-left:11px solid transparent;border-right:11px solid transparent;` +
            `border-bottom:26px solid ${GPS_BLUE};filter:drop-shadow(0 1px 3px rgba(0,0,0,.6));` +
            `transform-origin:50% 70%`
          gpsMarkerRef.current = new maplibregl.Marker({ element: el, rotationAlignment: 'map' })
            .setLngLat([fix.lng, fix.lat])
            .addTo(map)
        } else {
          gpsMarkerRef.current.setLngLat([fix.lng, fix.lat])
        }
        if (headingRef.current != null) gpsMarkerRef.current.setRotation(headingRef.current)

        if (followRef.current) {
          const target = cameraFor({
            lng: fix.lng,
            lat: fix.lat,
            heading: headingRef.current,
            mode: navModeRef.current,
            currentBearing: map.getBearing(),
          })
          const c = map.getCenter()
          if (shouldMoveCamera({ center: [c.lng, c.lat], bearing: map.getBearing() }, target)) {
            map.easeTo({ ...target, duration: 700, essential: true })
          }
        }
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [])


  /**
   * Dragging the map turns following OFF.
   *
   * Wanting to look somewhere else and having the map yank you back a second
   * later is the single most irritating thing a follow-me view does. The
   * button stays, but nobody should have to find it first.
   *
   * Keyed on `dragstart` with an `originalEvent`: our own easeTo() calls are
   * programmatic and carry none, so the camera following a fix cannot switch
   * itself off. Zoom is deliberately NOT included — pinching to see more of
   * the row ahead is not a request to stop following.
   */
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const onDrag = (e: { originalEvent?: unknown }) => {
      if (e?.originalEvent) setFollow(false)
    }
    map.on('dragstart', onDrag)
    map.on('rotatestart', onDrag)
    return () => {
      map.off('dragstart', onDrag)
      map.off('rotatestart', onDrag)
    }
  }, [ready])

  // Position broadcast (channel 'crew_live'), same as shelter placement.
  const gpsRef = useRef<{ lat: number; lng: number } | null>(null)
  useEffect(() => {
    if (!supabase || !field || !broadcastAs) return
    const channel = supabase.channel('crew_live')
    let sub = false
    channel.subscribe((status) => {
      sub = status === 'SUBSCRIBED'
    })
    const t = setInterval(() => {
      if (!sub || !gpsRef.current) return
      const done = shelterTrayLinks.filter((l) =>
        pins.some((p) => String(p.gridIdx) === String(l.shelterId)),
      ).length
      channel.send({
        type: 'broadcast',
        event: 'crew',
        payload: {
          name: broadcastAs,
          task: myCrew?.currentTask ?? 'tray',
          fieldId: field.id,
          fieldName: field.name,
          lat: gpsRef.current.lat,
          lng: gpsRef.current.lng,
          placed: done,
          total: pins.length,
          at: new Date().toISOString(),
        },
      })
    }, 8000)
    return () => {
      clearInterval(t)
      supabase?.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field?.id, pins.length, broadcastAs])

  return (
    <div className="relative h-full">
      <div ref={containerRef} className="h-full" />

      {/* What this crew is booked on today, and what to load for it. */}
      <div className="absolute inset-x-3 top-14 z-10">
        <ScheduledJob task="tray" currentFieldId={field?.id ?? null} onUseField={setFieldId} />
      </div>

      {/* Field picker */}
      <div className="absolute left-3 right-3 top-3 flex gap-2">
        <select
          className="min-w-0 flex-1 rounded-md border border-default px-3 py-2 text-sm"
          style={{ background: 'color-mix(in srgb, var(--bg-raised) 92%, transparent)', color: 'var(--text-primary)' }}
          value={field?.id ?? ''}
          onChange={(e) => setFieldId(e.target.value)}
        >
          {mapped.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </div>

      {/* Same controls as Shelter Placement, so the two views feel identical. */}
      <div className="absolute right-3 top-16 flex flex-col gap-2">
        <button
          className="grid h-11 w-11 place-items-center rounded-md border border-default"
          style={{
            background: 'color-mix(in srgb, var(--bg-raised) 92%, transparent)',
            color: layersOpen ? 'var(--brand)' : 'var(--text-secondary)',
          }}
          onClick={() => setLayersOpen((v) => !v)}
          aria-label="Layers"
        >
          <Layers size={18} />
        </button>
        {layersOpen && (
          <div
            className="absolute right-14 top-0 w-52 rounded-md border border-default p-3 text-sm"
            style={{ background: 'color-mix(in srgb, var(--bg-raised) 96%, transparent)' }}
          >
            {LAYER_TOGGLES.map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-secondary">
                <input
                  type="checkbox"
                  checked={show[k]}
                  onChange={(e) => setShow((p) => ({ ...p, [k]: e.target.checked }))}
                />
                {label}
              </label>
            ))}
          </div>
        )}
        <button
          className="grid h-11 w-11 place-items-center rounded-md border border-default"
          style={{
            background: 'color-mix(in srgb, var(--bg-raised) 92%, transparent)',
            color: follow ? 'var(--brand)' : 'var(--text-secondary)',
          }}
          onClick={() =>
            setFollow((v) => {
              const fix = gpsRef.current
              if (!v && fix && mapRef.current) {
                mapRef.current.easeTo({
                  ...cameraFor({
                    lng: fix.lng,
                    lat: fix.lat,
                    heading: headingRef.current,
                    mode: navModeRef.current,
                    currentBearing: mapRef.current.getBearing(),
                  }),
                  duration: 500,
                  essential: true,
                })
              }
              return !v
            })
          }
          aria-label="Follow me"
        >
          <Crosshair size={18} />
        </button>
        <button
          className="grid h-11 w-11 place-items-center rounded-md border border-default"
          style={{
            background: 'color-mix(in srgb, var(--bg-raised) 92%, transparent)',
            color: navMode === 'drive' ? 'var(--brand)' : 'var(--text-secondary)',
          }}
          onClick={() => {
            const next = navMode === 'drive' ? 'overhead' : 'drive'
            setNavMode(next)
            try {
              localStorage.setItem('field.navMode', next)
            } catch {
              /* private mode */
            }
            mapRef.current?.easeTo(
              next === 'drive' ? { pitch: 60, zoom: 17.5 } : { pitch: 0, bearing: 0, zoom: 16 },
            )
          }}
          aria-label={navMode === 'drive' ? 'Switch to overhead view' : 'Switch to driving view'}
        >
          <Mountain size={18} />
        </button>
      </div>

      {/* Bottom bar: which shelter, and the scanner. */}
      <div
        className="absolute bottom-3 left-3 right-3 rounded-md border border-default p-3"
        style={{ background: 'color-mix(in srgb, var(--bg-raised) 94%, transparent)' }}
      >
        {moveAsk ? (
          <>
            <div className="text-sm font-semibold text-primary">{moveAsk.label}</div>
            <p className="mt-1 text-xs text-muted">
              This tray is already recorded in another shelter. Moving it takes it off that one —
              two shelters both claiming the same trays is worse than a refused scan.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={async () => {
                  if (!targetShelter) return
                  const r = await releaseTrayToShelter({
                    trayId: moveAsk.trayId,
                    shelterId: targetShelter.id,
                    crewId: myCrewId,
                    moveFrom: moveAsk.from,
                  })
                  note(moveAsk.label, r.ok ? 'Moved here' : (r.error ?? 'Could not move'), r.ok)
                  setMoveAsk(null)
                  setScanning(true)
                }}
              >
                Move it here
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  note(moveAsk.label, 'Skipped — left where it was', true)
                  setMoveAsk(null)
                  setScanning(true)
                }}
              >
                Leave it
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-semibold text-primary">
                {targetShelter
                  ? `Shelter #${(targetShelter.gridIdx ?? 0) + 1}`
                  : `${field?.name ?? 'No field'} — no shelters placed yet`}
              </span>
              <span className="text-xs text-muted">
                {targetShelter
                  ? `${trayCount} tray${trayCount === 1 ? '' : 's'} in it` +
                    ('dist' in targetShelter && Number.isFinite(targetShelter.dist)
                      ? ` · ${Math.round(targetShelter.dist as number)} m away`
                      : '')
                  : 'Place shelters first'}
              </span>
            </div>

            <Button
              className="mt-2 w-full py-3 text-base"
              disabled={!targetShelter}
              onClick={() => setScanning(true)}
            >
              <Camera size={18} className="mr-2 inline" />
              Scan trays into this shelter
            </Button>

            {log.length > 0 && (
              <ul className="mt-2 max-h-24 space-y-1 overflow-y-auto text-xs">
                {log.map((e) => (
                  <li key={e.at} className="flex justify-between gap-2">
                    <span className="font-medium text-primary">{e.label}</span>
                    <span className={e.ok ? 'text-muted' : 'text-danger'}>{e.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <ScannerOverlay
        open={scanning}
        title={targetShelter ? `Into shelter #${(targetShelter.gridIdx ?? 0) + 1}` : 'Scan trays'}
        feedback={feedback}
        onScan={(t) => void handleScan(t)}
        onClose={() => setScanning(false)}
      />

    </div>
  )
}
