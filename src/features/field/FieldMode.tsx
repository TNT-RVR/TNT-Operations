import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { type GeoJSONSource } from 'maplibre-gl'
import { nextHeading, cameraFor, shouldMoveCamera } from '@/domain/navView'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Crosshair, Layers, Check, Mountain } from 'lucide-react'
import { useData } from '@/data/context'
import { useSession } from '@/auth/session'
import { supabase } from '@/data/supabaseClient'
import type { Field } from '@/data/types'
import { getTentPositions } from '@/domain/tentGrid'
import { applyShelterOverrides, type ShelterOverrides } from '@/domain/shelterOverrides'
import { SATELLITE_STYLE } from '../maps/basemap'
import { trackRings, ringPolygons } from '../maps/overlays'
import { ProgressBar } from '@/components/ui'

/**
 * Field Mode — the crew surface (spec Part 10), touch-first over the same
 * satellite map + canonical overlay colours as the office view. One field at a
 * time, GPS-locked: scan-pins (filled = placed, hollow = not), mark-placed at
 * the crew's position, live progress, and a crew-position broadcast that the
 * office map listens to. Installable as a PWA; tiles + shell cached offline.
 */

const PIN = '#FFCE3A'
const PIN_OUTLINE = '#1A1A1A'
const FIELD_LINE = '#00CED1'
const GPS_BLUE = '#5AA9E6'
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

interface Pin {
  lat: number
  lng: number
  gridIdx: number
}

const distM = (aLat: number, aLng: number, bLat: number, bLng: number): number => {
  const R = 6371000
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLng = ((bLng - aLng) * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export default function FieldMode() {
  const { fields, placedShelters, addPlacedShelter } = useData()
  const s = useSession()
  const canEdit = s.can('maps', 'edit')

  const mapped = useMemo(() => fields.filter((f) => f.geometry), [fields])
  const [fieldId, setFieldId] = useState<string | null>(null)
  const field: Field | null = useMemo(
    () => mapped.find((f) => f.id === fieldId) ?? mapped[0] ?? null,
    [mapped, fieldId],
  )

  const pins: Pin[] = useMemo(() => {
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

  // Placed state for THIS field, keyed by grid index.
  const placedIdx = useMemo(() => {
    const set = new Set<number>()
    for (const p of placedShelters) {
      if (p.fieldId === field?.id && p.gridIdx != null && p.status === 'placed') set.add(p.gridIdx)
    }
    return set
  }, [placedShelters, field])
  const placedCount = pins.filter((p) => placedIdx.has(p.gridIdx)).length

  // ── Map ────────────────────────────────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const gpsMarkerRef = useRef<maplibregl.Marker | null>(null)
  const [ready, setReady] = useState(false)
  const [layersOpen, setLayersOpen] = useState(false)
  const [show, setShow] = useState({ boundary: true, tracks: true, wet: false })

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: SATELLITE_STYLE,
      center: [-111.6, 49.83],
      zoom: 13,
      // Open in whichever view was last used, so the crew isn't re-picking it
      // every morning. The GPS fix then flies it in properly.
      pitch: navMode === 'drive' ? 60 : 0,
      attributionControl: { compact: true },
    })
    mapRef.current = map
    // 'style.load' not 'load' — see MapsHome: `load` blocks on the initial
    // viewport's tiles, which on a phone in the field is the slow part.
    map.on('style.load', () => {
      map.addSource('boundary', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'boundary-line', type: 'line', source: 'boundary', paint: { 'line-color': FIELD_LINE, 'line-width': 2 } })
      map.addSource('tracks', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'tracks-line', type: 'line', source: 'tracks', paint: { 'line-color': '#FF8A2B', 'line-width': 1.5, 'line-dasharray': [2, 2] } })
      map.addSource('wet', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'wet-fill', type: 'fill', source: 'wet', paint: { 'fill-color': '#39B7D6', 'fill-opacity': 0.3 } })
      map.addSource('pins', { type: 'geojson', data: EMPTY })
      // Not-placed: hollow ring. Placed: filled dot with dark outline.
      map.addLayer({
        id: 'pins-open',
        type: 'circle',
        source: 'pins',
        filter: ['!', ['get', 'placed']],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 4, 16, 9],
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-color': PIN,
          'circle-stroke-width': 2.5,
        },
      })
      map.addLayer({
        id: 'pins-placed',
        type: 'circle',
        source: 'pins',
        filter: ['get', 'placed'],
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
      gpsMarkerRef.current?.remove()
      map.remove()
      mapRef.current = null
      setReady(false)
    }
  }, [])

  // Draw the field: boundary + overlays + pins with placed state.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const g = field?.geometry ?? {}
    const poly = Array.isArray(g.boundary_polygon) ? (g.boundary_polygon as Array<[number, number]>) : null
    ;(map.getSource('boundary') as GeoJSONSource | undefined)?.setData(
      show.boundary && poly && poly.length >= 3
        ? {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: {},
                geometry: { type: 'Polygon', coordinates: [[...poly, poly[0]].map(([lat, lon]) => [lon, lat])] },
              },
            ],
          }
        : EMPTY,
    )
    ;(map.getSource('tracks') as GeoJSONSource | undefined)?.setData(show.tracks ? trackRings(g) : EMPTY)
    ;(map.getSource('wet') as GeoJSONSource | undefined)?.setData(show.wet ? ringPolygons(g.wet_zones) : EMPTY)
    ;(map.getSource('pins') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: pins.map((p) => ({
        type: 'Feature',
        properties: { n: p.gridIdx + 1, placed: placedIdx.has(p.gridIdx) },
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      })),
    })
  }, [ready, field, pins, placedIdx, show])

  // Fit to the field when it changes.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || pins.length === 0) return
    const lons = pins.map((p) => p.lng)
    const lats = pins.map((p) => p.lat)
    map.fitBounds(
      [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      ],
      { padding: 48, duration: 600, maxZoom: 16 },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, field?.id])

  // ── GPS follow ─────────────────────────────────────────────────────────────
  const [gps, setGps] = useState<{ lat: number; lng: number; acc: number } | null>(null)
  const [follow, setFollow] = useState(true)
  const followRef = useRef(follow)
  followRef.current = follow

  /**
   * 'drive' is the tractor-display view: tilted, zoomed in, turned so the
   * ground you are heading into fills the screen. 'overhead' is flat and
   * north-up, which is what you want when reading the whole field rather than
   * driving it. Remembered, because a crew has a preference and re-picking it
   * every time the app opens is friction.
   */
  const [navMode, setNavMode] = useState<'drive' | 'overhead'>(
    () => (localStorage.getItem('field.navMode') as 'drive' | 'overhead') ?? 'drive',
  )
  const navModeRef = useRef(navMode)
  navModeRef.current = navMode
  /** Smoothed travel direction — see src/domain/navView.ts. */
  const headingRef = useRef<number | null>(null)

  useEffect(() => {
    if (!('geolocation' in navigator)) return
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const fix = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy }
        setGps(fix)
        const map = mapRef.current
        if (!map) return

        headingRef.current = nextHeading(headingRef.current, {
          heading: pos.coords.heading,
          speed: pos.coords.speed,
        })

        if (!gpsMarkerRef.current) {
          // An arrow, not a dot: in a tilted view the thing you need to know is
          // which way you are pointed, and a dot cannot say.
          const el = document.createElement('div')
          el.className = 'field-gps-arrow'
          el.style.cssText =
            `width:0;height:0;border-left:11px solid transparent;border-right:11px solid transparent;` +
            `border-bottom:26px solid ${GPS_BLUE};filter:drop-shadow(0 1px 3px rgba(0,0,0,.6));` +
            `transform-origin:50% 70%`
          // rotationAlignment 'map' keeps the arrow glued to the ground as the
          // map turns, rather than spinning with the screen.
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
          // Skip the moves too small to see — every one is an animation, and on
          // a phone that is battery and judder for nothing.
          if (shouldMoveCamera({ center: [c.lng, c.lat], bearing: map.getBearing() }, target)) {
            map.easeTo({ ...target, duration: 700, essential: true })
          }
        }
      },
      () => setGps(null),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [])

  // ── Crew-position broadcast (office map subscribes on channel 'crew_live') ──
  const gpsRef = useRef(gps)
  gpsRef.current = gps
  const placedRef = useRef(placedCount)
  placedRef.current = placedCount

  useEffect(() => {
    if (!supabase || !field) return
    const channel = supabase.channel('crew_live')
    let sub = false
    channel.subscribe((status) => {
      sub = status === 'SUBSCRIBED'
    })
    const t = setInterval(() => {
      if (!sub || !gpsRef.current) return
      channel.send({
        type: 'broadcast',
        event: 'crew',
        payload: {
          name: s.user.name,
          fieldId: field.id,
          fieldName: field.name,
          lat: gpsRef.current.lat,
          lng: gpsRef.current.lng,
          placed: placedRef.current,
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
  }, [field?.id, pins.length])

  // ── Mark placed ────────────────────────────────────────────────────────────
  // Target = nearest UNPLACED pin to the crew's GPS (or the map centre).
  const target = useMemo(() => {
    const open = pins.filter((p) => !placedIdx.has(p.gridIdx))
    if (open.length === 0) return null
    const ref = gps ?? (() => {
      const c = mapRef.current?.getCenter()
      return c ? { lat: c.lat, lng: c.lng } : null
    })()
    if (!ref) return open[0]
    let best = open[0]
    let bestD = Infinity
    for (const p of open) {
      const d = distM(ref.lat, ref.lng, p.lat, p.lng)
      if (d < bestD) {
        bestD = d
        best = p
      }
    }
    return { ...best, dist: bestD }
  }, [pins, placedIdx, gps])

  function markPlaced() {
    if (!field || !target) return
    addPlacedShelter({
      fieldId: field.id,
      qrCode: null,
      gridIdx: target.gridIdx,
      lat: gps?.lat ?? target.lat,
      lng: gps?.lng ?? target.lng,
      placedAt: new Date().toISOString(),
      placedBy: s.user.name,
      status: 'placed',
      notes: '',
    })
  }

  return (
    <div className="relative h-full">
      <div ref={containerRef} className="absolute inset-0" />

      {/* Top bar: field switcher + GPS pill */}
      <div className="absolute inset-x-2 top-2 flex items-center gap-2">
        <select
          className="input min-h-0 flex-1 py-2 text-sm"
          value={field?.id ?? ''}
          onChange={(e) => setFieldId(e.target.value)}
        >
          {mapped.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name} — {placedShelters.filter((p) => p.fieldId === f.id && p.status === 'placed').length}/{f.shelterCount}
            </option>
          ))}
        </select>
        <span
          className="rounded-pill px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-wider"
          style={{
            background: gps ? 'var(--ok-bg)' : 'var(--danger-bg)',
            color: gps ? 'var(--ok-fg)' : 'var(--danger-fg)',
            border: `1px solid ${gps ? 'var(--ok-bd)' : 'var(--danger-bd)'}`,
          }}
        >
          {gps ? `GPS ±${Math.round(gps.acc)}m` : 'NO GPS'}
        </span>
      </div>

      {/* Layer toggles */}
      <div className="absolute right-2 top-14 flex flex-col items-end gap-2">
        <button
          className="grid h-11 w-11 place-items-center rounded-md border border-default text-primary"
          style={{ background: 'color-mix(in srgb, var(--bg-raised) 92%, transparent)' }}
          onClick={() => setLayersOpen((v) => !v)}
          aria-label="Layers"
        >
          <Layers size={18} />
        </button>
        {layersOpen && (
          <div
            className="space-y-2 rounded-md border border-subtle p-3 text-sm"
            style={{ background: 'color-mix(in srgb, var(--bg-raised) 95%, transparent)' }}
          >
            {(
              [
                ['boundary', 'Boundary'],
                ['tracks', 'Pivot tracks'],
                ['wet', 'Wet zones'],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-secondary">
                <input type="checkbox" checked={show[k]} onChange={(e) => setShow((p) => ({ ...p, [k]: e.target.checked }))} />
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
          onClick={() => setFollow((v) => !v)}
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
              /* private mode — the choice just won't persist */
            }
            const map = mapRef.current
            if (!map) return
            // Apply immediately rather than waiting for the next fix, which
            // may be seconds away and makes the button feel broken.
            const g = gpsRef.current
            map.easeTo({
              ...(g
                ? cameraFor({
                    lng: g.lng,
                    lat: g.lat,
                    heading: headingRef.current,
                    mode: next,
                    currentBearing: map.getBearing(),
                  })
                : next === 'drive'
                  ? { pitch: 60, zoom: Math.max(map.getZoom(), 17.5) }
                  : { pitch: 0, bearing: 0, zoom: 16 }),
              duration: 500,
              essential: true,
            })
          }}
          aria-label={navMode === 'drive' ? 'Switch to overhead view' : 'Switch to driving view'}
          title={navMode === 'drive' ? 'Driving view (tilted, heading up)' : 'Overhead view (flat, north up)'}
        >
          <Mountain size={18} />
        </button>
      </div>

      {/* Bottom action bar */}
      <div
        className="absolute inset-x-2 bottom-2 rounded-lg border border-subtle p-3"
        style={{ background: 'color-mix(in srgb, var(--bg-raised) 94%, transparent)' }}
      >
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-mono tabular font-semibold text-primary">
            {placedCount} / {pins.length} <span className="font-sans font-normal text-muted">placed</span>
          </span>
          {target && (
            <span className="text-xs text-muted">
              Next: #{target.gridIdx + 1}
              {'dist' in target && Number.isFinite(target.dist) && gps ? ` · ${Math.round(target.dist as number)} m away` : ''}
            </span>
          )}
        </div>
        <ProgressBar pct={pins.length ? (placedCount / pins.length) * 100 : 0} tone={placedCount === pins.length ? 'green' : 'brand'} />
        {canEdit && (
          <button className="btn-primary mt-3 w-full" onClick={markPlaced} disabled={!target}>
            <Check size={18} /> {target ? `Mark shelter #${target.gridIdx + 1} placed` : 'All shelters placed'}
          </button>
        )}
      </div>
    </div>
  )
}
