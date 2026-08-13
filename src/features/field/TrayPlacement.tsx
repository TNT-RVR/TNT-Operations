import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { type GeoJSONSource } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Crosshair, Mountain } from 'lucide-react'
import { useData } from '@/data/context'
import { useSession } from '@/auth/session'
import { supabase } from '@/data/supabaseClient'
import { crewOf, shouldBroadcastPosition } from '@/domain/crews'
import type { Field } from '@/data/types'
import { getTentPositions } from '@/domain/tentGrid'
import { applyShelterOverrides, type ShelterOverrides } from '@/domain/shelterOverrides'
import { nextHeading, cameraFor, shouldMoveCamera } from '@/domain/navView'
import { SATELLITE_STYLE } from '../maps/basemap'

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

const PIN = '#FFCE3A'
const PIN_OUTLINE = '#1A1A1A'
const FIELD_LINE = '#00CED1'
const GPS_BLUE = '#5AA9E6'
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

export default function TrayPlacement() {
  const { fields, crews, crewMembers, loadCrews, shelterTrayLinks } = useData()
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

  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const gpsMarkerRef = useRef<maplibregl.Marker | null>(null)
  const headingRef = useRef<number | null>(null)
  const [ready, setReady] = useState(false)
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
      map.addSource('boundary', { type: 'geojson', data: EMPTY })
      map.addLayer({
        id: 'boundary-line',
        type: 'line',
        source: 'boundary',
        paint: { 'line-color': FIELD_LINE, 'line-width': 2 },
      })
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
    const boundary = (g?.boundary ?? null) as Array<[number, number]> | null
    ;(map.getSource('boundary') as GeoJSONSource | undefined)?.setData(
      boundary && boundary.length > 2
        ? {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: {},
                geometry: {
                  type: 'LineString',
                  coordinates: [...boundary, boundary[0]].map(([lat, lng]) => [lng, lat]),
                },
              },
            ],
          }
        : EMPTY,
    )
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
  }, [field, pins, ready])

  // GPS — same driving view as Shelter Placement, so the two feel identical.
  useEffect(() => {
    if (!('geolocation' in navigator)) return
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const map = mapRef.current
        if (!map) return
        const fix = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        gpsRef.current = fix
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

      {/* Same two camera controls as Shelter Placement. */}
      <div className="absolute right-3 top-16 flex flex-col gap-2">
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

      {/* What this view does NOT do yet, said plainly rather than left to be
          discovered by a crew standing in a field. */}
      <div
        className="absolute bottom-3 left-3 right-3 rounded-md border border-default p-3"
        style={{ background: 'color-mix(in srgb, var(--bg-raised) 94%, transparent)' }}
      >
        <div className="text-sm font-semibold text-primary">
          {field?.name ?? 'No field'} · {pins.length} shelter{pins.length === 1 ? '' : 's'}
        </div>
        <p className="mt-1 text-xs text-muted">
          Shelter positions from Shelter Maps. Scanning trays into shelters isn&apos;t wired up here
          yet — use Incubation → Scan for now.
        </p>
      </div>
    </div>
  )
}
