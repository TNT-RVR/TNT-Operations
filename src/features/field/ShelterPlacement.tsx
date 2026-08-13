import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { type GeoJSONSource } from 'maplibre-gl'
import { nextHeading, cameraFor, shouldMoveCamera } from '@/domain/navView'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Crosshair, Layers, Check, Mountain, Move } from 'lucide-react'
import { useData } from '@/data/context'
import { crewOf, shouldBroadcastPosition } from '@/domain/crews'
import { useSession } from '@/auth/session'
import { supabase } from '@/data/supabaseClient'
import type { Field } from '@/data/types'
import { getTentPositions } from '@/domain/tentGrid'
import { tireAndEdgeZones } from '@/domain/sprayOverlays'
import { bayGuides, shiftToParkedBay } from '@/domain/bayGuides'
import { shiftToParkedSprayPass } from '@/domain/sprayNudge'
import { applyShelterOverrides, type ShelterOverrides } from '@/domain/shelterOverrides'
import { SATELLITE_STYLE } from '../maps/basemap'
import { trackRings, ringPolygons, overlayPins } from '../maps/overlays'
import { navigationUrl } from '@/domain/navLink'
import { ProgressBar, Button } from '@/components/ui'

/**
 * Shelter Placement — one of Field Mode's three crew views, alongside Tray
 * Placement and Crews. They are separate ROUTES under /field rather than tabs
 * inside one screen, so they appear in the side navigation like every other
 * section of the app.
 *
 * Touch-first over the same
 * satellite map + canonical overlay colours as the office view. One field at a
 * time, GPS-locked: scan-pins (filled = placed, hollow = not), mark-placed at
 * the crew's position, live progress, and a crew-position broadcast that the
 * office map listens to. Installable as a PWA; tiles + shell cached offline.
 */

const PIN = '#FFCE3A'
const PIN_OUTLINE = '#1A1A1A'
const FIELD_LINE = '#00CED1'
const GPS_BLUE = '#5AA9E6'
const EDGE_ZONE = '#FF8A2B' // token-exempt: map overlay over imagery
const ROW_GUIDE = '#7DD3FC' // token-exempt: map overlay over imagery
const PARKING = '#4ADE80' // token-exempt: map pin over imagery
const PIN_OTHER = '#E5E7EB' // token-exempt: map pin over imagery
const PIN_LABEL = { entrance: 'E', parking: 'P', home: 'H' } as const
const PIN_TITLE = { entrance: 'Entrance', parking: 'Parking', home: 'Home' } as const
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
const FT_TO_M = 0.3048

/** A field value that may be a string, as the old app wrote them. */
const toNum = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

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

/**
 * Guide lines down the male bays that have shelters beside them.
 *
 * Not every pass — most bays have no shelters, and drawing them all buries the
 * few that matter. Not the crew route either: that is a driving path with
 * headland links, which answers "where next" rather than "which one is this".
 *
 * Extended past the field so the line is visible from the headland, which is
 * where the row gets chosen.
 */
function bayGuideFC(
  g: Record<string, unknown>,
  shelters: Array<{ lat: number; lng: number }>,
): { lines: GeoJSON.FeatureCollection; labels: GeoJSON.FeatureCollection } {
  // The boundary decides how far the lines run: the bays only span the pivot's
  // circle, and on a square quarter that stops well short of the headland.
  const boundary = Array.isArray(g.boundary_polygon)
    ? (g.boundary_polygon as Array<[number, number]>)
    : null
  const guides = bayGuides(g, shelters, 40, boundary)
  return {
    lines: {
      type: 'FeatureCollection',
      features: guides.map((gd) => ({
        type: 'Feature',
        properties: { pass: gd.pass },
        geometry: { type: 'LineString', coordinates: gd.coordinates },
      })),
    },
    labels: {
      type: 'FeatureCollection',
      features: guides.map((gd) => ({
        type: 'Feature',
        properties: { number: gd.pass },
        geometry: { type: 'Point', coordinates: gd.label },
      })),
    },
  }
}

export default function ShelterPlacement() {
  const { fields, placedShelters, addPlacedShelter, crews, crewMembers, loadCrews } = useData()
  const s = useSession()
  const canEdit = s.can('field', 'edit')

  const mapped = useMemo(() => fields.filter((f) => f.geometry), [fields])
  const [fieldId, setFieldId] = useState<string | null>(null)
  /**
   * In-the-moment nudge, in FEET, east/west and north/south.
   *
   * The grid is computed from a pivot point and an angle; the planter drove
   * where it drove. When the male bay is ten feet east of where the computer
   * says, the fix is not a survey — it is moving the lines ten feet east and
   * getting on with it.
   *
   * Per field and remembered, because the same field is wrong by the same
   * amount tomorrow.
   */
  const [nudgeE, setNudgeE] = useState(0)
  const [nudgeN, setNudgeN] = useState(0)
  /** The sprayer's own lateral offset, in metres — a single scalar, unlike the
   *  bay shift, because that is the shape `sprayer_shift` already has. */
  const [sprayShiftM, setSprayShiftM] = useState(0)
  const field: Field | null = useMemo(
    () => mapped.find((f) => f.id === fieldId) ?? mapped[0] ?? null,
    [mapped, fieldId],
  )

  // Load this field's saved nudge when the field changes.
  useEffect(() => {
    if (!field) return
    try {
      const raw = localStorage.getItem(`field.nudge.${field.id}`)
      const v = raw ? (JSON.parse(raw) as { e?: number; n?: number; s?: number }) : null
      setNudgeE(Number(v?.e) || 0)
      setNudgeN(Number(v?.n) || 0)
      setSprayShiftM(Number(v?.s) || 0)
    } catch {
      setNudgeE(0)
      setNudgeN(0)
      setSprayShiftM(0)
    }
  }, [field?.id])

  /**
   * The field as the crew is actually seeing it: the recorded geometry with
   * the nudge folded into the calibration shift the engine already applies.
   *
   * Everything downstream — pins, bays, guides, spray zones — reads this, so a
   * nudge moves the whole picture together rather than the lines drifting away
   * from the shelters they place.
   */
  const nudgedGeometry = useMemo(() => {
    const g = field?.geometry as Record<string, unknown> | undefined
    if (!g) return undefined
    if (!nudgeE && !nudgeN && !sprayShiftM) return g
    return {
      ...g,
      bay_shift_e_m: toNum(g.bay_shift_e_m) + nudgeE * FT_TO_M,
      bay_shift_n_m: toNum(g.bay_shift_n_m) + nudgeN * FT_TO_M,
      // Absolute, not additive: shiftToParkedSprayPass() returns the new value
      // for the field, having already built on whatever was there.
      ...(sprayShiftM ? { sprayer_shift: sprayShiftM } : {}),
    }
  }, [field, nudgeE, nudgeN, sprayShiftM])

  const pins: Pin[] = useMemo(() => {
    const g = nudgedGeometry
    if (!g) return []
    try {
      const raw = getTentPositions(g)
      return String(g.shelter_mode ?? '') === 'manual'
        ? raw.map((p, i) => ({ ...p, gridIdx: i }))
        : applyShelterOverrides(raw, g.shelter_overrides as ShelterOverrides | undefined)
    } catch {
      return []
    }
  }, [nudgedGeometry])

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
  /** Entrance / parking / home markers — HTML, so they read as letters. */
  const pinMarkersRef = useRef<maplibregl.Marker[]>([])
  const [ready, setReady] = useState(false)
  const [layersOpen, setLayersOpen] = useState(false)
  const [nudgeOpen, setNudgeOpen] = useState(false)
  /** What the last line-up did, so a bad snap is visible immediately. */
  const [snapNote, setSnapNote] = useState<string | null>(null)
  /**
   * Layer toggles. `edges` and `rowGuides` are off by default: they answer
   * questions asked at the headland, not while placing, and a map with
   * everything on is a map nobody reads.
   */
  const [show, setShow] = useState({
    boundary: true,
    tracks: true,
    wet: false,
    edges: false,
    rowGuides: false,
    pins: true,
  })

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
      // Sprayer edge zones — where the boom overlaps the neighbouring pass.
      // Drawn UNDER the pins: it is context for where a shelter sits, not the
      // thing being placed.
      map.addSource('edges', { type: 'geojson', data: EMPTY })
      map.addLayer({
        id: 'edges-fill',
        type: 'fill',
        source: 'edges',
        paint: { 'fill-color': EDGE_ZONE, 'fill-opacity': 0.22 },
      })
      map.addLayer({
        id: 'edges-line',
        type: 'line',
        source: 'edges',
        paint: { 'line-color': EDGE_ZONE, 'line-width': 1, 'line-opacity': 0.5 },
      })

      // Row guides, extended past the boundary so the row is identifiable from
      // the headland — before the turn, not after it.
      map.addSource('row-guides', { type: 'geojson', data: EMPTY })
      map.addLayer({
        id: 'row-guides-line',
        type: 'line',
        source: 'row-guides',
        paint: { 'line-color': ROW_GUIDE, 'line-width': 1.5, 'line-dasharray': [4, 3], 'line-opacity': 0.9 },
      })

      // Pass numbers, so the line says WHICH row it is — a line with no
      // number tells you a row exists, which you could already see.
      map.addSource('row-guide-labels', { type: 'geojson', data: EMPTY })
      map.addLayer({
        id: 'row-guide-labels-text',
        type: 'symbol',
        source: 'row-guide-labels',
        layout: {
          'text-field': ['to-string', ['get', 'number']],
          'text-size': 13,
          'text-allow-overlap': false,
        },
        paint: { 'text-color': ROW_GUIDE, 'text-halo-color': '#000', 'text-halo-width': 1.4 },
      })

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
      // Markers live outside the map's own layer list, so they survive
      // map.remove() and would leak on every field change.
      pinMarkersRef.current.forEach((m) => m.remove())
      pinMarkersRef.current = []
      map.remove()
      mapRef.current = null
      setReady(false)
    }
  }, [])

  // Draw the field: boundary + overlays + pins with placed state.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    // The NUDGED geometry, so the overlays move with the shelters. Reading
    // field.geometry here meant a nudge shifted the pins and left the bays and
    // guides behind — the exact drift this feature exists to remove.
    const g = nudgedGeometry ?? {}
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
    // Only the EDGE bands, not the tire tracks: this answers "does a shelter
    // sit where two passes overlap", and the tire lines would bury the pins.
    ;(map.getSource('edges') as GeoJSONSource | undefined)?.setData(
      show.edges ? tireAndEdgeZones(g).edge : EMPTY,
    )
    const guides = show.rowGuides ? bayGuideFC(g, pins) : null
    ;(map.getSource('row-guides') as GeoJSONSource | undefined)?.setData(guides?.lines ?? EMPTY)
    ;(map.getSource('row-guide-labels') as GeoJSONSource | undefined)?.setData(guides?.labels ?? EMPTY)
    // Parking, entrance and home. The parking pin is the one that matters in
    // the truck: it is where the crew starts and ends, and it is the answer to
    // "where did we leave everything" at the end of a pass.
    pinMarkersRef.current.forEach((m) => m.remove())
    pinMarkersRef.current = (show.pins ? overlayPins(g as never) : []).map((pin) => {
      const el = document.createElement('div')
      el.textContent = PIN_LABEL[pin.kind]
      el.title = `${PIN_TITLE[pin.kind]} — tap for directions`
      el.style.cssText =
        `display:grid;place-items:center;width:30px;height:30px;border-radius:9999px;` +
        `background:${pin.kind === 'parking' ? PARKING : PIN_OTHER};color:#111;` +
        `font:700 13px/1 system-ui;border:2px solid rgba(0,0,0,.6);` +
        `box-shadow:0 1px 4px rgba(0,0,0,.5);cursor:pointer`
      // Tap for turn-by-turn to the gate. Confirmed first: this leaves the app
      // for the phone's map, and a mis-tap while placing shelters would drop
      // the crew out of the scan they were in the middle of.
      el.addEventListener('click', (ev) => {
        ev.stopPropagation()
        const where = PIN_TITLE[pin.kind].toLowerCase()
        if (!window.confirm(`Open directions to the ${where}?`)) return
        window.open(navigationUrl(pin.lat, pin.lng), '_blank', 'noopener')
      })
      return new maplibregl.Marker({ element: el }).setLngLat([pin.lng, pin.lat]).addTo(map)
    })

    ;(map.getSource('pins') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: pins.map((p) => ({
        type: 'Feature',
        properties: { n: p.gridIdx + 1, placed: placedIdx.has(p.gridIdx) },
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      })),
    })
  }, [ready, field, nudgedGeometry, pins, placedIdx, show])

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

  // ── Crew-position broadcast (office map subscribes on channel 'crew_live') ──
  const gpsRef = useRef(gps)
  gpsRef.current = gps
  const placedRef = useRef(placedCount)
  placedRef.current = placedCount

  useEffect(() => {
    void loadCrews()
  }, [loadCrews])

  /**
   * Only the crew's lead device reports position — normally the iPad that
   * stays with the vehicle. Three phones in one truck broadcasting slightly
   * different fixes would draw the crew as a smear of pins that disagree, and
   * a phone that goes up a ladder is not where the crew is.
   *
   * Nobody on a crew yet? Fall back to broadcasting as yourself, so a single
   * person working alone still shows up rather than vanishing from the map
   * because the crew list has not been set up.
   */
  const myCrewId = crewOf(crewMembers, s.user.id)
  const myCrew = crews.find((c) => c.id === myCrewId) ?? null

  /** How many of this field's shelters THIS crew placed. */
  const myPlacedCount = useMemo(
    () =>
      myCrewId
        ? placedShelters.filter(
            (p) => p.fieldId === field?.id && p.status === 'placed' && p.crewId === myCrewId,
          ).length
        : placedCount,
    [placedShelters, field?.id, myCrewId, placedCount],
  )
  const myPlacedRef = useRef(myPlacedCount)
  myPlacedRef.current = myPlacedCount
  const isLead = shouldBroadcastPosition(crewMembers, s.user.id)
  const broadcastAs = myCrewId
    ? isLead
      ? (crews.find((c) => c.id === myCrewId)?.name ?? s.user.name)
      : null
    : s.user.name

  useEffect(() => {
    if (!supabase || !field || !broadcastAs) return
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
          name: broadcastAs,
          // The job comes from the crew's ASSIGNMENT, not from which screen
          // happens to be open: a crew assigned to trays does not become a
          // shelter crew because someone glanced at this tab.
          task: myCrew?.currentTask ?? 'shelter',
          fieldId: field.id,
          fieldName: field.name,
          lat: gpsRef.current.lat,
          lng: gpsRef.current.lng,
          // MY crew's count, not the field's. Two crews in one quarter each
          // reporting the field total reads as double the work done.
          placed: myPlacedRef.current,
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

  // ── Mark placed ────────────────────────────────────────────────────────────
  // Target = nearest UNPLACED pin to the crew's GPS (or the map centre).
  //
  // There is no required order: work the field however suits. The label says
  // "Nearest" rather than "Next" because the number follows the crew around,
  // and calling it Next read as a queue that had to be worked in sequence.
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
      crewId: myCrewId,
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
        {nudgeOpen && (
          <div
            className="absolute right-14 top-0 w-64 rounded-md border border-default p-3 text-sm"
            style={{ background: 'color-mix(in srgb, var(--bg-raised) 96%, transparent)' }}
          >
            <div className="mb-1 font-semibold text-primary">Line up the grid</div>
            <p className="mb-2 text-xs text-muted">
              Park on the thing, then press its button. The nearest line moves onto you — bays
              carry the shelters and guides with them; the sprayer moves its own passes.
            </p>

            <Button
              className="w-full py-2"
              disabled={!gps || !field}
              onClick={() => {
                if (!gps || !field) return
                const g = (nudgedGeometry ?? {}) as Record<string, unknown>
                const fix = shiftToParkedBay(g, { lat: gps.lat, lng: gps.lng })
                if (!fix) {
                  setSnapNote('No bays on this field to line up to.')
                  return
                }
                // Applied ON TOP of whatever is already there — the result is
                // measured against the grid being drawn, not the original.
                const e = Math.round((nudgeE + fix.dEastM / FT_TO_M) * 10) / 10
                const n = Math.round((nudgeN + fix.dNorthM / FT_TO_M) * 10) / 10
                setNudgeE(e)
                setNudgeN(n)
                try {
                  localStorage.setItem(
                    `field.nudge.${field.id}`,
                    JSON.stringify({ e, n, s: sprayShiftM }),
                  )
                } catch {
                  /* private mode — it just won't survive a reload */
                }
                setSnapNote(
                  `Moved ${fix.movedM.toFixed(1)} m onto bay ${fix.pass}` +
                    (gps.acc ? ` · GPS ±${Math.round(gps.acc)} m` : ''),
                )
              }}
            >
              <Crosshair size={16} className="mr-1 inline" />
              The bay is here
            </Button>

            <Button
              variant="ghost"
              className="mt-2 w-full py-2"
              disabled={!gps || !field}
              onClick={() => {
                if (!gps || !field) return
                const g = (nudgedGeometry ?? {}) as Record<string, unknown>
                const fix = shiftToParkedSprayPass(g, { lat: gps.lat, lng: gps.lng })
                if (!fix) {
                  setSnapNote('No sprayer passes on this field to line up to.')
                  return
                }
                setSprayShiftM(fix.sprayerShiftM)
                try {
                  localStorage.setItem(
                    `field.nudge.${field.id}`,
                    JSON.stringify({ e: nudgeE, n: nudgeN, s: fix.sprayerShiftM }),
                  )
                } catch {
                  /* private mode */
                }
                setSnapNote(
                  `Sprayer moved ${fix.movedM.toFixed(1)} m onto pass ${fix.index}` +
                    (gps.acc ? ` · GPS ±${Math.round(gps.acc)} m` : ''),
                )
              }}
            >
              <Crosshair size={16} className="mr-1 inline" />
              The sprayer track is here
            </Button>

            {/* What it did, in numbers. Each snap goes to the NEAREST line, so
                a fix further out than half a spacing lands on the wrong one —
                visible here rather than discovered later. */}
            {snapNote && <p className="mt-2 text-xs text-secondary">{snapNote}</p>}
            {!gps && <p className="mt-2 text-xs text-amber-600">Waiting for a GPS fix.</p>}

            <div className="mt-2 flex items-center justify-between text-xs">
              <span className="font-mono text-faint">
                {nudgeE || nudgeN || sprayShiftM
                  ? [
                      nudgeE ? `${nudgeE > 0 ? 'E' : 'W'} ${Math.abs(nudgeE)}ft` : '',
                      nudgeN ? `${nudgeN > 0 ? 'N' : 'S'} ${Math.abs(nudgeN)}ft` : '',
                      sprayShiftM ? `spray ${(sprayShiftM / FT_TO_M).toFixed(1)}ft` : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : 'not adjusted'}
              </span>
              <button
                className="text-muted underline"
                onClick={() => {
                  setNudgeE(0)
                  setNudgeN(0)
                  setSprayShiftM(0)
                  setSnapNote(null)
                  try {
                    if (field) localStorage.removeItem(`field.nudge.${field.id}`)
                  } catch {
                    /* nothing to clear */
                  }
                }}
              >
                reset
              </button>
            </div>
          </div>
        )}

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
                ['edges', 'Sprayer edge zones'],
                ['rowGuides', 'Bay guides'],
                ['pins', 'Parking & gates'],
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
          onClick={() =>
            setFollow((v) => {
              // Turning it back ON should snap to you now — waiting for the
              // next fix makes the button feel broken for a few seconds.
              if (!v && gps && mapRef.current) {
                mapRef.current.easeTo({
                  ...cameraFor({
                    lng: gps.lng,
                    lat: gps.lat,
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
        {/* Nudge the grid. The planter drove where it drove; when the bay is
            ten feet east of where the computer says, move the lines ten feet
            east. Feet because that is what the crew says out loud. */}
        <button
          className="grid h-11 w-11 place-items-center rounded-md border border-default"
          style={{
            background: 'color-mix(in srgb, var(--bg-raised) 92%, transparent)',
            color: nudgeE || nudgeN ? 'var(--brand)' : 'var(--text-secondary)',
          }}
          onClick={() => setNudgeOpen((v) => !v)}
          aria-label="Nudge the grid"
          title="Nudge the grid to match the ground"
        >
          <Move size={18} />
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
              Nearest: #{target.gridIdx + 1}
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
