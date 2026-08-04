import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { type GeoJSONSource } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { circle as turfCircle, bbox as turfBbox } from '@turf/turf'
import type { Feature, FeatureCollection, Polygon, Point, Position } from 'geojson'
import { PageHeader, Badge } from '@/components/ui'
import { useData } from '@/data/context'
import { useSession } from '@/auth/session'
import { supabase } from '@/data/supabaseClient'
import type { Field, FieldGeometry } from '@/data/types'
import { Check, Undo2, X as XIcon } from 'lucide-react'
import { getTentPositions } from '@/domain/tentGrid'
import { applyShelterOverrides, comboKey, syncComboAdjustments, reflowToGrid, type ShelterOverrides } from '@/domain/shelterOverrides'
import { crewRoute } from '@/domain/crewRoute'
import { fieldWarnings } from '@/domain/fieldWarnings'
import { haversineMeters } from '@/domain/geo'
import { maleBayBands, planterPassLines, alignmentLines } from '@/domain/bayOverlays'
import { sprayerPassLines, outerSprayerLimit, tireAndEdgeZones, shelterBufferSquares } from '@/domain/sprayOverlays'
import { totalGals, mathTrays, totalTrays, trayDistribution } from '@/domain/cost'
import { MapToolbar, type ToolAction } from './MapToolbar'
import {
  loadVisibility,
  saveVisibility,
  type LayerGroup,
  type LayerId,
  type LayerVisibility,
} from './layers'
import { FieldEditor } from './FieldEditor'
import { SATELLITE_STYLE } from './basemap'
import { trackRings, ringPolygons, cornerArms, overlayPins, hasOverlays, type PinKind } from './overlays'
import { boundaryFromFile, ringAcres } from './importBoundary'
import { pathsFromFile, actualSheltersFromFile } from './importPaths'
import {
  shelterCsv,
  sheltersKml,
  fieldGeoJson,
  fieldPdf,
  shelterShapefileZip,
  jdBufferZonesZip,
  aggpsZip,
  downloadText,
  downloadBlob,
  slug,
} from './exports'

// Canonical overlay palette — docs/web-rebuild-spec.md Part 13. Keep identical
// across all surfaces (desktop/web/tablet) so crews and operators see the same map.
const BRAND = '#FFCE3A' // shelter pins (filled, dark outline)
const PIN_OUTLINE = '#1A1A1A'
const FIELD = '#00CED1' // field boundary (cyan)
const PIVOT_PT = '#F5453D' // pivot point
const TRACK = '#FF8A2B' // pivot wheel tracks (dashed) / corner arms
const INNER = '#FF6600' // inner boundary exclusion
const ACCESS = '#FF2D95' // pivot access road
const WET = '#39B7D6' // wet zones (translucent fill)
const WET_LINE = '#39B7D6'
const CREW = '#A855F7' // crew route (desktop purple)
const CREW_LIVE = '#3FB6A8' // live crew position pins (teal)
const MALE_BAY = '#2E9BF0' // male-bay bands
const SPRAY = '#33FF66' // sprayer passes + outer sprayer limit
const TIRE = '#FF2A2A' // tire zone down each pass centre
const EDGE = '#22E048' // edge zone at pass edges
const PLANTER_NUM = '#FFB000' // planter pass lines + numbers
const ALIGN = '#86E0FF' // alignment guide mesh
const BUFFER = '#1E90FF' // shelter buffer squares (JD section control)
const PLANTER_PATH = '#1E90FF' // imported JD planter polylines
const SPRAY_PATH = '#FF8C00' // uploaded sprayer GPS tracks
const ACTUAL = '#19E36B' // crew-scanned actual placements
const ACTUAL_OUTLINE = '#04361B'
const TEST_PIN = '#1E90FF' // test shelters, counted separately

/** Ring types the shared draw machine can author (spec §6.2). */
type RingTarget = 'boundary' | 'inner' | 'access' | 'wet'
/** Single points placed by clicking the map (§6.1, §6.2). */
type PinTarget = 'pivot' | 'pivot2' | 'entrance' | 'parking'

/** Where each ring type lives in the field dict, and whether it's a list of rings. */
const RING_SPEC: Record<RingTarget, { key: string; list: boolean; label: string }> = {
  boundary: { key: 'boundary_polygon', list: false, label: 'boundary' },
  inner: { key: 'boundary_inner', list: true, label: 'inner boundary' },
  access: { key: 'access_road_boundary', list: true, label: 'access road' },
  wet: { key: 'wet_zones', list: true, label: 'wet zone' },
}

const PIN_SPEC: Record<PinTarget, { label: string }> = {
  pivot: { label: 'pivot point' },
  pivot2: { label: '2nd pivot' },
  entrance: { label: 'entrance' },
  parking: { label: 'parking' },
}

/** A crew position broadcast from Field Mode (channel 'crew_live'). */
interface LiveCrew {
  name: string
  fieldId: string
  fieldName: string
  lat: number
  lng: number
  placed: number
  total: number
  at: string
}
const PIN_COLORS: Record<PinKind, string> = { entrance: '#16A34A', parking: '#F59E0B', home: '#2F7FE6' }
const PIN_LABEL: Record<PinKind, string> = { entrance: 'E', parking: 'P', home: 'H' }

/** Legend rows for the overlays actually present on a field. */
function legendItems(geom: FieldGeometry): Array<{ label: string; color: string }> {
  const nonEmpty = (v: unknown) => Array.isArray(v) && v.length > 0
  const items: Array<{ label: string; color: string }> = []
  if (nonEmpty(geom.pivot_tracks)) items.push({ label: 'Wheel tracks', color: TRACK })
  if (nonEmpty(geom.corner_arms)) items.push({ label: 'Corner arms', color: TRACK })
  if (nonEmpty(geom.boundary_inner)) items.push({ label: 'Inner boundary', color: INNER })
  if (nonEmpty(geom.access_road_boundary)) items.push({ label: 'Access road', color: ACCESS })
  if (nonEmpty(geom.wet_zones)) items.push({ label: 'Wet zone', color: WET })
  for (const p of overlayPins(geom)) items.push({ label: p.kind, color: PIN_COLORS[p.kind] })
  return items
}

const DEFAULT_CENTER: [number, number] = [-111.6, 49.83]
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }

const num = (v: unknown): number => Number(v)
const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v))
/** The old app stored booleans as real bools, "true"/"Yes" strings, or 1. */
const truthyVal = (v: unknown): boolean =>
  v === true || v === 1 || ['true', 'yes'].includes(String(v ?? '').trim().toLowerCase())

function boundaryFeature(geom?: FieldGeometry): Feature<Polygon> | null {
  if (!geom) return null
  const poly = geom.boundary_polygon
  if (Array.isArray(poly) && poly.length >= 3) {
    const ring: Position[] = poly.map((p) => [num((p as unknown[])[1]), num((p as unknown[])[0])])
    ring.push(ring[0])
    return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }
  }
  const r = num(geom.Radius)
  const lon = num(geom.PP_Longitude)
  const lat = num(geom.PP_Latitude)
  if (r > 0 && Number.isFinite(lon) && Number.isFinite(lat)) {
    return turfCircle([lon, lat], r / 1000, { steps: 128, units: 'kilometers' }) as Feature<Polygon>
  }
  return null
}

function pivotFeature(geom?: FieldGeometry): Feature<Point> | null {
  if (!geom) return null
  const lon = num(geom.PP_Longitude)
  const lat = num(geom.PP_Latitude)
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null
  return { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lon, lat] } }
}

/**
 * Shelter pins as GeoJSON. `label` drives the optional on-map number (§6.5):
 * the shelter's index, its tray count, or nothing.
 */
function sheltersCollection(
  pins: { lng: number; lat: number }[],
  mode: 'off' | 'shelter' | 'trays' = 'off',
  trayCounts: number[] = [],
): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: pins.map((p, i) => ({
      type: 'Feature',
      properties: {
        n: i + 1,
        label: mode === 'shelter' ? String(i + 1) : mode === 'trays' ? String(trayCounts[i] ?? '') : '',
      },
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
    })),
  }
}

/**
 * A sensible default pivot field, centred where the user is looking. Defaults
 * follow the old app's blank_field() (docs/web-rebuild-spec.md Part 4): 133 ft
 * sprayer, 8F/2M bays at 22 in over a 20-row planter, trays_2 count mode at
 * 3 gal/ac ÷ 2 gal/tray. Acres seeded from the pivot circle so the trays math
 * works before a boundary exists.
 */
function defaultPivotGeometry([lng, lat]: [number, number]): FieldGeometry {
  const radiusM = 400
  const acres = Math.round(((Math.PI * radiusM * radiusM) / 4046.8564224) * 10) / 10
  return {
    PP_Longitude: String(lng),
    PP_Latitude: String(lat),
    Radius: String(radiusM),
    Sprayer_width: '133',
    num_female_rows: '8',
    num_male_rows: '2',
    row_spacing_in: '22',
    bay_gap_in: '0',
    total_rows: '20',
    row_layout: 'centered',
    custom_row_mask: '',
    use_bays: true,
    shelter_mode: 'trays_2',
    gals_per_acre: '3',
    gals_per_tray: '2',
    tray_distribution: 'even',
    acres: String(acres),
    num_structures: '',
    Planting_angle: '0',
    Spray_angle: '',
    shelters_in_outside_pass: 'Yes',
    pivot_tracks: [],
    track_exclusion_ft: '10',
    pass_edge_buffer_ft: '25',
    tire_width_ft: '14',
    shelter_buffer_m: '1.524',
    manual_shelter_pins: [],
  }
}

export default function MapsHome() {
  const { fields, saveField } = useData()
  const canEdit = useSession().can('maps', 'edit')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<FieldGeometry | null>(null)
  const [draftName, setDraftName] = useState('')
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const pinMarkersRef = useRef<maplibregl.Marker[]>([])
  const shelterMarkersRef = useRef<maplibregl.Marker[]>([])
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const pathInputRef = useRef<HTMLInputElement | null>(null)
  const planterInputRef = useRef<HTMLInputElement | null>(null)
  const csvInputRef = useRef<HTMLInputElement | null>(null)
  const [ready, setReady] = useState(false)
  // Boundary drawing: an in-progress ring of [lat, lon] vertices.
  const [drawing, setDrawing] = useState(false)
  const [drawPts, setDrawPts] = useState<Array<[number, number]>>([])
  const [importError, setImportError] = useState<string | null>(null)
  /**
   * Which ring the draw mode is authoring. The boundary and the three exclusion
   * ring types share one drawing machine (spec §6.2) — only the destination key
   * and whether it's a list-of-rings differ.
   */
  const [drawTarget, setDrawTarget] = useState<RingTarget>('boundary')
  /** Click-to-place mode for single points: pivot, 2nd pivot, entrance, parking. */
  const [pinTarget, setPinTarget] = useState<PinTarget | null>(null)
  /** Click-to-add mode for pivot track radii. */
  const [addingTrack, setAddingTrack] = useState(false)
  /** Two-click distance measurement (spec §6.7). */
  const [measure, setMeasure] = useState<Array<[number, number]>>([])
  const [measuring, setMeasuring] = useState(false)
  /** Crew-route hand editing (§6.6). */
  const [routeEditing, setRouteEditing] = useState(false)
  /**
   * Vertex-editing an existing ring (§6.2 "Draw / Edit Boundary" — drag handles).
   * `null` = off; otherwise the ring being edited. `index` picks which ring of a
   * list type (inner / access / wet); the boundary is a single ring so index 0.
   */
  const [vertexEdit, setVertexEdit] = useState<{ target: RingTarget; index: number } | null>(null)
  const vertexMarkersRef = useRef<maplibregl.Marker[]>([])
  /** Which tool layer's actions are showing. */
  const [tool, setTool] = useState<LayerGroup>('boundary')
  const [visibility, setVisibility] = useState<LayerVisibility>(loadVisibility)
  /** Pin labels: shelter number, tray count, or nothing (§6.5). */
  const [pinNumbers, setPinNumbers] = useState<'off' | 'shelter' | 'trays'>('off')
  /** Planned grid vs the crew's scanned placements (§6.5 "Show Planned / Actual"). */
  const [shelterView, setShelterView] = useState<'planned' | 'actual'>('planned')
  /** Placing blue TEST shelter pins rather than ordinary ones (§6.5). */
  const [placingTest, setPlacingTest] = useState(false)
  /** Whole-field undo/redo stacks for the draft (§9). */
  const undoRef = useRef<FieldGeometry[]>([])
  const redoRef = useRef<FieldGeometry[]>([])
  const [historyTick, setHistoryTick] = useState(0)
  // Manual-shelter placement (mode = 'manual'): click to drop pins.
  const [placing, setPlacing] = useState(false)
  // Live crews broadcasting from Field Mode.
  const [liveCrews, setLiveCrews] = useState<Record<string, LiveCrew>>({})
  const crewMarkersRef = useRef<maplibregl.Marker[]>([])

  /** Field-list filter — name, client, region, and the field's company/year/LLD. */
  const [fieldQuery, setFieldQuery] = useState('')
  const visibleFields = useMemo(() => {
    const q = fieldQuery.trim().toLowerCase()
    if (!q) return fields
    return fields.filter((f) =>
      [f.name, f.client, f.region, str(f.geometry?.company), str(f.geometry?.year), str(f.geometry?.lld)]
        .some((v) => String(v ?? '').toLowerCase().includes(q)),
    )
  }, [fields, fieldQuery])

  const selectedField: Field | null = useMemo(
    () => fields.find((f) => f.id === selectedId) ?? fields.find((f) => f.geometry) ?? fields[0] ?? null,
    [fields, selectedId],
  )

  // What the map draws: the live draft while editing, else the saved geometry.
  const previewGeom = useMemo(
    () => (editing && draft ? draft : selectedField?.geometry),
    [editing, draft, selectedField],
  )
  // Computed pins + manual drag/delete overrides (§5.7). Manual mode's pins are
  // authored directly, so overrides only apply to computed grids.
  const shelters = useMemo(() => {
    if (!previewGeom) return []
    const raw = getTentPositions(previewGeom)
    if (str(previewGeom.shelter_mode) === 'manual') return raw.map((p, i) => ({ ...p, gridIdx: i }))
    return applyShelterOverrides(raw, previewGeom.shelter_overrides as ShelterOverrides | undefined)
  }, [previewGeom])

  // Crew travel route (§5.6): snake down the sheltered male bays, headland joins.
  const crew = useMemo(
    () => (previewGeom && shelters.length >= 2 ? crewRoute(previewGeom, shelters) : { route: [], totalM: 0 }),
    [previewGeom, shelters],
  )

  // Save-time sanity checks (§5.8) + the GUI's compute-based zero-pins check.
  const warnings = useMemo(() => {
    if (!editing || !draft) return []
    const w = fieldWarnings(draft)
    if (shelters.length === 0) w.push('No shelters placed with the current settings.')
    return w
  }, [editing, draft, shelters])

  const isPivotDraft = !!draft && !draft.boundary_polygon
  const manualEditing = editing && !!draft && str(draft.shelter_mode) === 'manual'
  const manualPins: Array<[number, number]> = useMemo(
    () => (Array.isArray(draft?.manual_shelter_pins) ? (draft!.manual_shelter_pins as Array<[number, number]>) : []),
    [draft],
  )
  const dirty =
    editing &&
    (draftName !== (selectedField?.name ?? '') ||
      JSON.stringify(draft) !== JSON.stringify(selectedField?.geometry ?? null))

  function resetDraw() {
    setDrawing(false)
    setDrawPts([])
    setPlacing(false)
    setPinTarget(null)
    setAddingTrack(false)
    setMeasuring(false)
    setMeasure([])
    setRouteEditing(false)
    setPlacingTest(false)
    setVertexEdit(null)
    setImportError(null)
  }

  function toggleLayer(id: LayerId) {
    setVisibility((prev) => {
      const next = { ...prev, [id]: !prev[id] }
      saveVisibility(next)
      return next
    })
  }

  // ── Manual shelter pins (shelter_mode = 'manual') ─────────────────────────
  function setManualPins(pins: Array<[number, number]>) {
    setDraft((prev) => (prev ? { ...prev, shelter_mode: 'manual', manual_shelter_pins: pins } : prev))
  }
  function addManualPin(lat: number, lon: number) {
    setManualPins([...manualPins, [lat, lon]])
  }
  function updateManualPin(i: number, lat: number, lon: number) {
    setManualPins(manualPins.map((p, idx) => (idx === i ? [lat, lon] : p)))
  }
  function deleteManualPin(i: number) {
    setManualPins(manualPins.filter((_, idx) => idx !== i))
  }

  function selectField(id: string) {
    setEditing(false)
    setDraft(null)
    resetDraw()
    setSelectedId(id)
  }

  function enterEdit() {
    if (!selectedField) return
    const center = mapRef.current
      ? (mapRef.current.getCenter().toArray() as [number, number])
      : DEFAULT_CENTER
    const base = selectedField.geometry
      ? (structuredClone(selectedField.geometry) as FieldGeometry)
      : defaultPivotGeometry(center)
    setDraft(base)
    setDraftName(selectedField.name)
    resetDraw()
    setEditing(true)
  }

  // Apply a boundary ring ([lat,lon]) to the draft: set the polygon, its acreage,
  // and re-centre the pivot/ENU origin on the ring so the engine stays stable.
  function applyBoundary(ring: Array<[number, number]>, acres: number) {
    const lat = ring.reduce((s, p) => s + p[0], 0) / ring.length
    const lon = ring.reduce((s, p) => s + p[1], 0) / ring.length
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            boundary_polygon: ring,
            acres: String(Math.round(acres * 100) / 100),
            PP_Latitude: String(lat),
            PP_Longitude: String(lon),
          }
        : prev,
    )
  }

  function fitToRing(ring: Array<[number, number]>) {
    const map = mapRef.current
    if (!map || ring.length < 3) return
    const lons = ring.map((p) => p[1])
    const lats = ring.map((p) => p[0])
    map.fitBounds(
      [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      ],
      { padding: 64, duration: 600, maxZoom: 16 },
    )
  }

  // ── Undo / redo over the whole draft (spec §9) ────────────────────────────
  // Every mutating action pushes the PREVIOUS draft first, so one action = one
  // undo. Capped like the desktop app so a long session can't grow unbounded.
  const UNDO_CAP = 40
  function pushHistory() {
    setDraft((prev) => {
      if (prev) {
        undoRef.current = [...undoRef.current.slice(-(UNDO_CAP - 1)), structuredClone(prev)]
        redoRef.current = [] // a new edit invalidates the redo branch
        setHistoryTick((t) => t + 1)
      }
      return prev
    })
  }
  function undo() {
    const prev = undoRef.current.pop()
    if (!prev) return
    setDraft((cur) => {
      if (cur) redoRef.current = [...redoRef.current, structuredClone(cur)]
      return prev
    })
    setHistoryTick((t) => t + 1)
  }
  function redo() {
    const next = redoRef.current.pop()
    if (!next) return
    setDraft((cur) => {
      if (cur) undoRef.current = [...undoRef.current, structuredClone(cur)]
      return next
    })
    setHistoryTick((t) => t + 1)
  }

  // ── Rings: boundary + the three exclusion types share one draw machine ────
  function startDraw(target: RingTarget) {
    setImportError(null)
    setDrawPts([])
    setDrawTarget(target)
    setPinTarget(null)
    setAddingTrack(false)
    setMeasuring(false)
    setDrawing(true)
  }

  function finishDraw() {
    if (drawPts.length < 3) return
    pushHistory()
    if (drawTarget === 'boundary') {
      applyBoundary(drawPts, ringAcres(drawPts))
    } else {
      const { key } = RING_SPEC[drawTarget]
      setDraft((prev) => {
        if (!prev) return prev
        const existing = Array.isArray(prev[key]) ? (prev[key] as unknown[]) : []
        return { ...prev, [key]: [...existing, drawPts] }
      })
    }
    fitToRing(drawPts)
    resetDraw()
  }

  /** Read a ring out of the draft: the boundary, or ring `index` of a list type. */
  function readRing(target: RingTarget, index: number): Array<[number, number]> | null {
    const g = draft
    if (!g) return null
    const raw = g[RING_SPEC[target].key]
    if (!Array.isArray(raw)) return null
    const ring = RING_SPEC[target].list ? (raw[index] as unknown) : raw
    if (!Array.isArray(ring) || ring.length < 3) return null
    return (ring as Array<[unknown, unknown]>).map((p) => [num(p[0]), num(p[1])] as [number, number])
  }

  /** Write a ring back, keeping acreage in step when it's the outer boundary. */
  function writeRing(target: RingTarget, index: number, ring: Array<[number, number]>) {
    setDraft((prev) => {
      if (!prev) return prev
      const { key, list } = RING_SPEC[target]
      if (!list) {
        return { ...prev, [key]: ring, acres: String(Math.round(ringAcres(ring) * 100) / 100) }
      }
      const cur = Array.isArray(prev[key]) ? [...(prev[key] as unknown[])] : []
      cur[index] = ring
      return { ...prev, [key]: cur }
    })
  }

  /** Drag one vertex of a ring to a new position. */
  function moveVertex(target: RingTarget, index: number, vertex: number, lat: number, lon: number) {
    const ring = readRing(target, index)
    if (!ring || vertex < 0 || vertex >= ring.length) return
    const next = ring.map((p, i) => (i === vertex ? ([lat, lon] as [number, number]) : p))
    writeRing(target, index, next)
  }

  /** Remove a vertex (double-click). Refuses below 3 — a ring needs three. */
  function deleteVertex(target: RingTarget, index: number, vertex: number) {
    const ring = readRing(target, index)
    if (!ring || ring.length <= 3) return
    pushHistory()
    writeRing(
      target,
      index,
      ring.filter((_, i) => i !== vertex),
    )
  }

  /** Drop the most recently added ring of a type (§6.2 "Delete …"). */
  function deleteLastRing(target: Exclude<RingTarget, 'boundary'>) {
    const { key } = RING_SPEC[target]
    pushHistory()
    setDraft((prev) => {
      if (!prev) return prev
      const existing = Array.isArray(prev[key]) ? (prev[key] as unknown[]) : []
      return { ...prev, [key]: existing.slice(0, -1) }
    })
  }

  const ringCount = (target: Exclude<RingTarget, 'boundary'>): number => {
    const v = draft?.[RING_SPEC[target].key]
    return Array.isArray(v) ? v.length : 0
  }

  // ── Single-point pins + pivot tracks ──────────────────────────────────────
  function armPin(target: PinTarget) {
    setPinTarget(target)
    setDrawing(false)
    setAddingTrack(false)
    setMeasuring(false)
  }

  function setPin(target: PinTarget, lat: number, lon: number) {
    pushHistory()
    setDraft((prev) => {
      if (!prev) return prev
      switch (target) {
        case 'pivot':
          return { ...prev, PP_Latitude: String(lat), PP_Longitude: String(lon) }
        case 'pivot2':
          return { ...prev, two_pivots: true, PP2_Latitude: String(lat), PP2_Longitude: String(lon) }
        case 'entrance':
          return { ...prev, entrance_pin: [lat, lon] }
        case 'parking':
          return { ...prev, parking_pin: [lat, lon] }
      }
    })
    setPinTarget(null)
  }

  function clearPin(key: 'entrance_pin' | 'parking_pin') {
    pushHistory()
    setDraft((prev) => (prev ? { ...prev, [key]: null } : prev))
  }

  /** Click the map at a distance from the pivot → a new track at that radius. */
  function addTrackAt(lat: number, lon: number) {
    const g = draft
    if (!g) return
    const pLat = num(g.PP_Latitude)
    const pLon = num(g.PP_Longitude)
    if (!Number.isFinite(pLat) || !Number.isFinite(pLon)) return
    const r = haversineMeters({ lat: pLat, lng: pLon }, { lat, lng: lon })
    if (!(r > 1)) return
    pushHistory()
    setDraft((prev) => {
      if (!prev) return prev
      const cur = (Array.isArray(prev.pivot_tracks) ? (prev.pivot_tracks as unknown[]) : []).map(num).filter((x) => x > 0)
      const next = [...cur, Math.round(r * 100) / 100].sort((a, b) => a - b)
      return { ...prev, pivot_tracks: next }
    })
    setAddingTrack(false)
  }

  /**
   * Nudge the bays+flags (§6.4 "Shift") or the sprayer passes (§6.3 "Shift").
   * Bay shift is stored in ENU metres and moves bays and shelters together —
   * it's the same field the crew's GPS calibration writes.
   */
  function nudgeBays(dEast: number, dNorth: number) {
    pushHistory()
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            bay_shift_e_m: (num(prev.bay_shift_e_m) || 0) + dEast,
            bay_shift_n_m: (num(prev.bay_shift_n_m) || 0) + dNorth,
          }
        : prev,
    )
  }

  function nudgeSprayer(delta: number) {
    pushHistory()
    setDraft((prev) => (prev ? { ...prev, sprayer_shift: (num(prev.sprayer_shift) || 0) + delta } : prev))
  }

  function deleteTrack(idx: number) {
    pushHistory()
    setDraft((prev) => {
      if (!prev) return prev
      const cur = Array.isArray(prev.pivot_tracks) ? (prev.pivot_tracks as unknown[]) : []
      return { ...prev, pivot_tracks: cur.filter((_, i) => i !== idx) }
    })
  }

  const trackRadii: number[] = useMemo(
    () => (Array.isArray(draft?.pivot_tracks) ? (draft!.pivot_tracks as unknown[]).map(num).filter((x) => x > 0) : []),
    [draft],
  )

  /**
   * Trays per shelter for the pin labels — the Part 7.2 bee math, reusing the
   * cost module's port so the map and the estimator can never disagree.
   */
  const trayCounts: number[] = useMemo(() => {
    const g = previewGeom
    if (!g || shelters.length === 0) return []
    const gals = totalGals(num(g.gals_per_acre ?? 3) || 0, num(g.acres) || 0)
    const trays = totalTrays(mathTrays(gals, num(g.gals_per_tray ?? 2) || 0), shelters.length)
    return trayDistribution(trays, shelters.length)
  }, [previewGeom, shelters.length])

  /** Straight-line distance between the two measured points, in metres. */
  const measureM =
    measure.length === 2
      ? haversineMeters({ lat: measure[0][0], lng: measure[0][1] }, { lat: measure[1][0], lng: measure[1][1] })
      : null

  /** How many polylines / pins are stored under a field key. */
  const pathCount = (key: string): number => {
    const v = draft?.[key]
    return Array.isArray(v) ? v.length : 0
  }

  function clearPaths(key: string) {
    pushHistory()
    setDraft((prev) => (prev ? { ...prev, [key]: [] } : prev))
  }

  /** Import GPS polylines from a machine export (§6.3, §6.4). */
  async function onImportPaths(file: File, key: 'planter_passes' | 'sprayer_passes') {
    setImportError(null)
    try {
      const paths = await pathsFromFile(file)
      pushHistory()
      setDraft((prev) => {
        if (!prev) return prev
        const next: FieldGeometry = { ...prev, [key]: paths }
        // Imported planter passes are the authority when present (Part 4).
        if (key === 'planter_passes') next.use_imported_passes = true
        return next
      })
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'Import failed')
    }
  }

  /** Import the crew's scanned placements from CSV (§6.5). */
  async function onImportActual(file: File) {
    setImportError(null)
    try {
      const { pins, skipped } = await actualSheltersFromFile(file)
      if (pins.length === 0) {
        setImportError(`No usable rows in ${file.name}${skipped ? ` (${skipped} skipped)` : ''}.`)
        return
      }
      pushHistory()
      setDraft((prev) => (prev ? { ...prev, actual_shelter_pins: pins.map((p) => [p.lat, p.lng]) } : prev))
      if (skipped > 0) setImportError(`Imported ${pins.length} pins; skipped ${skipped} unreadable row(s).`)
      setShelterView('actual')
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'Import failed')
    }
  }

  async function onImportFile(file: File) {
    setImportError(null)
    try {
      const { ring, acres } = await boundaryFromFile(file)
      applyBoundary(ring, acres)
      fitToRing(ring)
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'Import failed')
    }
  }

  async function exportField(kind: 'kml' | 'geojson' | 'csv' | 'pdf' | 'shp' | 'jd' | 'aggps') {
    if (!selectedField) return
    const f = selectedField
    const s = slug(f.name)
    const g = f.geometry
    if (kind === 'kml') downloadText(`${s}.kml`, 'application/vnd.google-earth.kml+xml', sheltersKml(f.name, shelters, g))
    else if (kind === 'geojson') downloadText(`${s}.geojson`, 'application/geo+json', fieldGeoJson(f.name, shelters, g))
    else if (kind === 'csv') downloadText(`${s}_shelters.csv`, 'text/csv', shelterCsv(shelters))
    else if (kind === 'pdf') {
      const lines = [
        `${f.client || '—'} · ${f.region || '—'}`,
        `Company: ${str(g?.company) || '—'}   Year: ${str(g?.year) || '—'}`,
        `Type: ${f.shapeType}   Acres: ${str(g?.acres) || '—'}   Shelters: ${shelters.length}`,
      ]
      downloadBlob(`${s}.pdf`, await fieldPdf(f.name, lines, shelters))
    } else if (kind === 'shp') {
      downloadBlob(`${s}_shp.zip`, await shelterShapefileZip(f.name, shelters, g))
    } else if (kind === 'jd') {
      // Client/Farm: remembered on the field, else the desktop defaults.
      const client = str(g?.jd_client) || 'Riverview Ranch'
      const farm = str(g?.jd_farm) || f.name.split(' ')[0]
      downloadBlob(`${s}_jd_buffer_zones.zip`, await jdBufferZonesZip(f.name, shelters, num(g?.shelter_buffer_m) || 1.524, client, farm))
    } else if (kind === 'aggps') {
      downloadBlob(`${s}_aggps.zip`, await aggpsZip(f.name, shelters))
    }
  }

  function onChange(key: string, value: unknown) {
    setDraft((prev) => {
      if (!prev) return prev
      const next: FieldGeometry = { ...prev, [key]: value }
      // Keep total_rows in step with the bay counts (non-custom layouts).
      if ((key === 'num_female_rows' || key === 'num_male_rows') && str(next.row_layout) !== 'custom') {
        const nf = num(next.num_female_rows) || 0
        const nm = num(next.num_male_rows) || 0
        if (nf + nm > 0) next.total_rows = String(nf + nm)
      }
      // Combo-scoped overrides (§5.7): if this change switches the placement
      // combo, stash the live drags under the old combo and load the new one's.
      const prevCombo = comboKey(prev)
      if (comboKey(next) !== prevCombo) {
        const { patch } = syncComboAdjustments(next, prevCombo)
        Object.assign(next, patch)
      }
      return next
    })
  }

  // Drag/delete a COMPUTED pin → a per-combo override keyed by grid index.
  function setPinOverride(gridIdx: number, val: [number, number] | null) {
    setDraft((prev) => {
      if (!prev) return prev
      const ov = { ...((prev.shelter_overrides as ShelterOverrides) || {}), [String(gridIdx)]: val }
      const next: FieldGeometry = { ...prev, shelter_overrides: ov }
      const store = { ...((prev.adjust_by_combo as Record<string, unknown>) || {}) }
      store[comboKey(next)] = { shelter_overrides: ov, tray_overrides: (prev.tray_overrides as object) || {} }
      next.adjust_by_combo = store
      return next
    })
  }

  const overrideCount = Object.keys((draft?.shelter_overrides as ShelterOverrides) || {}).length

  function onReflow() {
    setDraft((prev) => (prev ? ({ ...prev, ...reflowToGrid(prev) } as FieldGeometry) : prev))
  }

  function onSave() {
    if (!selectedField || !draft) return
    saveField(selectedField.id, {
      name: draftName,
      geometry: draft,
      shelterCount: shelters.length,
      shapeType: draft.boundary_polygon ? 'polygon' : 'pivot',
    })
    setEditing(false)
    setDraft(null)
    resetDraw()
  }

  function onCancel() {
    setEditing(false)
    setDraft(null)
    resetDraw()
  }

  // Create the map once; add empty sources + layers on load.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: SATELLITE_STYLE,
      center: DEFAULT_CENTER,
      zoom: 9,
      attributionControl: { compact: true },
    })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl(), 'top-right')

    map.on('load', () => {
      map.addSource('boundary', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'boundary-fill', type: 'fill', source: 'boundary', paint: { 'fill-color': FIELD, 'fill-opacity': 0.1 } })
      map.addLayer({ id: 'boundary-line', type: 'line', source: 'boundary', paint: { 'line-color': FIELD, 'line-width': 2 } })

      // ── Overlay exclusion zones (below shelters) ───────────────────────────
      map.addSource('inner', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'inner-fill', type: 'fill', source: 'inner', paint: { 'fill-color': INNER, 'fill-opacity': 0.08 } })
      map.addSource('access', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'access-fill', type: 'fill', source: 'access', paint: { 'fill-color': ACCESS, 'fill-opacity': 0.08 } })
      map.addSource('wetzones', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'wet-fill', type: 'fill', source: 'wetzones', paint: { 'fill-color': WET, 'fill-opacity': 0.3 } })
      map.addLayer({ id: 'inner-line', type: 'line', source: 'inner', paint: { 'line-color': INNER, 'line-width': 1.5 } })
      map.addLayer({ id: 'access-line', type: 'line', source: 'access', paint: { 'line-color': ACCESS, 'line-width': 1.5 } })
      map.addLayer({ id: 'wet-line', type: 'line', source: 'wetzones', paint: { 'line-color': WET_LINE, 'line-width': 1.5 } })
      map.addSource('tracks', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'tracks-line', type: 'line', source: 'tracks', paint: { 'line-color': TRACK, 'line-width': 1.5, 'line-opacity': 0.85, 'line-dasharray': [2, 2] } })
      map.addSource('corner', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'corner-line', type: 'line', source: 'corner', paint: { 'line-color': TRACK, 'line-width': 2 } })
      map.addSource('crewroute', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'crewroute-line', type: 'line', source: 'crewroute', paint: { 'line-color': CREW, 'line-width': 3, 'line-opacity': 0.9 } })

      // ── Planter / sprayer overlays (spec §6.3, §6.4) ───────────────────────
      map.addSource('malebays', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'malebays-fill', type: 'fill', source: 'malebays', paint: { 'fill-color': MALE_BAY, 'fill-opacity': 0.22 } })
      map.addLayer({ id: 'malebays-line', type: 'line', source: 'malebays', paint: { 'line-color': MALE_BAY, 'line-width': 1, 'line-opacity': 0.7 } })
      map.addSource('sprayerpasses', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'sprayerpasses-line', type: 'line', source: 'sprayerpasses', paint: { 'line-color': SPRAY, 'line-width': 1, 'line-dasharray': [3, 2], 'line-opacity': 0.8 } })
      map.addSource('sprayerlimit', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'sprayerlimit-line', type: 'line', source: 'sprayerlimit', paint: { 'line-color': SPRAY, 'line-width': 2 } })
      map.addSource('tirezone', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'tirezone-fill', type: 'fill', source: 'tirezone', paint: { 'fill-color': TIRE, 'fill-opacity': 0.28 } })
      map.addSource('edgezone', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'edgezone-fill', type: 'fill', source: 'edgezone', paint: { 'fill-color': EDGE, 'fill-opacity': 0.2 } })
      map.addSource('planterlines', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'planterlines-line', type: 'line', source: 'planterlines', paint: { 'line-color': PLANTER_NUM, 'line-width': 1, 'line-opacity': 0.7 } })
      map.addLayer({
        id: 'planterlines-label',
        type: 'symbol',
        source: 'planterlines',
        layout: { 'symbol-placement': 'line-center', 'text-field': ['to-string', ['get', 'number']], 'text-size': 11 },
        paint: { 'text-color': PLANTER_NUM, 'text-halo-color': '#000000', 'text-halo-width': 1.2 },
      })
      map.addSource('alignment', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'alignment-line', type: 'line', source: 'alignment', paint: { 'line-color': ALIGN, 'line-width': 0.8, 'line-opacity': 0.75 } })
      map.addSource('buffers', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'buffers-line', type: 'line', source: 'buffers', paint: { 'line-color': BUFFER, 'line-width': 1 } })

      // Imported machine paths + the crew's scanned placements (§6.3–6.5).
      map.addSource('planterpaths', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'planterpaths-line', type: 'line', source: 'planterpaths', paint: { 'line-color': PLANTER_PATH, 'line-width': 1.5 } })
      map.addSource('sprayerpaths', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'sprayerpaths-line', type: 'line', source: 'sprayerpaths', paint: { 'line-color': SPRAY_PATH, 'line-width': 1.5 } })
      map.addSource('testshelters', { type: 'geojson', data: EMPTY })
      map.addLayer({
        id: 'testshelters-dot',
        type: 'circle',
        source: 'testshelters',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 14, 5, 16, 7],
          'circle-color': TEST_PIN,
          'circle-stroke-color': '#0A3D7A',
          'circle-stroke-width': 1.5,
        },
      })
      map.addSource('actualshelters', { type: 'geojson', data: EMPTY })
      map.addLayer({
        id: 'actualshelters-dot',
        type: 'circle',
        source: 'actualshelters',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 14, 5, 16, 7],
          'circle-color': ACTUAL,
          'circle-stroke-color': ACTUAL_OUTLINE,
          'circle-stroke-width': 1.5,
        },
      })
      // Pin labels — shelter number or tray count (§6.5).
      map.addLayer({
        id: 'shelters-label',
        type: 'symbol',
        source: 'shelters',
        layout: { 'text-field': ['get', 'label'], 'text-size': 11, 'text-offset': [0, -1.1] },
        paint: { 'text-color': '#FFFFFF', 'text-halo-color': '#000000', 'text-halo-width': 1.2 },
      })

      map.addSource('shelters', { type: 'geojson', data: EMPTY })
      map.addLayer({
        id: 'shelters',
        type: 'circle',
        source: 'shelters',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 14, 5, 16, 7],
          'circle-color': BRAND,
          'circle-stroke-color': PIN_OUTLINE,
          'circle-stroke-width': 1,
        },
      })
      map.addSource('pivot', { type: 'geojson', data: EMPTY })
      map.addLayer({
        id: 'pivot',
        type: 'circle',
        source: 'pivot',
        paint: { 'circle-radius': 5, 'circle-color': PIVOT_PT, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 },
      })

      // In-progress boundary draw (on top).
      map.addSource('draw', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'draw-fill', type: 'fill', source: 'draw', paint: { 'fill-color': BRAND, 'fill-opacity': 0.12 } })
      map.addLayer({ id: 'draw-line', type: 'line', source: 'draw', paint: { 'line-color': BRAND, 'line-width': 2, 'line-dasharray': [2, 1.5] } })
      map.addSource('drawv', { type: 'geojson', data: EMPTY })
      map.addLayer({
        id: 'draw-vertices',
        type: 'circle',
        source: 'drawv',
        paint: { 'circle-radius': 4, 'circle-color': BRAND, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5 },
      })
      setReady(true)
    })

    return () => {
      pinMarkersRef.current.forEach((m) => m.remove())
      pinMarkersRef.current = []
      shelterMarkersRef.current.forEach((m) => m.remove())
      shelterMarkersRef.current = []
      crewMarkersRef.current.forEach((m) => m.remove())
      crewMarkersRef.current = []
      vertexMarkersRef.current.forEach((m) => m.remove())
      vertexMarkersRef.current = []
      map.remove()
      mapRef.current = null
      setReady(false)
    }
  }, [])

  // Draw the current geometry (live) — pins + boundary + pivot.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const boundary = boundaryFeature(previewGeom)
    const pivot = pivotFeature(previewGeom)
    ;(map.getSource('boundary') as GeoJSONSource | undefined)?.setData(
      boundary && visibility.boundary ? { type: 'FeatureCollection', features: [boundary] } : EMPTY,
    )
    ;(map.getSource('pivot') as GeoJSONSource | undefined)?.setData(
      pivot && visibility.pivot ? { type: 'FeatureCollection', features: [pivot] } : EMPTY,
    )
    // While editing, draggable markers stand in for the dots (manual pins AND
    // computed pins — the latter drag into per-combo overrides).
    ;(map.getSource('shelters') as GeoJSONSource | undefined)?.setData(
      editing || !visibility.shelters || shelterView === 'actual'
        ? EMPTY
        : sheltersCollection(shelters, pinNumbers, trayCounts),
    )

    // Overlays: tracks, exclusion zones, corner arms — each gated by its layer
    // toggle so `visibility` is the single switch for what's drawn (§6).
    const geom = previewGeom ?? {}
    const corner = cornerArms(geom)
    const gate = <T,>(on: boolean, data: T): T | FeatureCollection => (on ? data : EMPTY)
    ;(map.getSource('tracks') as GeoJSONSource | undefined)?.setData(gate(visibility.tracks, trackRings(geom)) as FeatureCollection)
    ;(map.getSource('inner') as GeoJSONSource | undefined)?.setData(gate(visibility.inner, ringPolygons(geom.boundary_inner)) as FeatureCollection)
    ;(map.getSource('access') as GeoJSONSource | undefined)?.setData(gate(visibility.accessRoad, ringPolygons(geom.access_road_boundary)) as FeatureCollection)
    ;(map.getSource('wetzones') as GeoJSONSource | undefined)?.setData(gate(visibility.wetZones, ringPolygons(geom.wet_zones)) as FeatureCollection)
    ;(map.getSource('corner') as GeoJSONSource | undefined)?.setData(
      visibility.cornerArms
        ? { type: 'FeatureCollection', features: [...corner.lines.features, ...corner.circles.features] }
        : EMPTY,
    )

    // Planter + sprayer overlays (spec §6.3, §6.4) — computed from the SAME
    // frame the placement engine uses, so bays line up with the pins.
    const tireEdge = visibility.tireEdge ? tireAndEdgeZones(geom) : null
    ;(map.getSource('malebays') as GeoJSONSource | undefined)?.setData(
      visibility.maleBays ? (maleBayBands(geom) as FeatureCollection) : EMPTY,
    )
    ;(map.getSource('planterlines') as GeoJSONSource | undefined)?.setData(
      visibility.planterNumbers ? (planterPassLines(geom) as FeatureCollection) : EMPTY,
    )
    ;(map.getSource('sprayerpasses') as GeoJSONSource | undefined)?.setData(
      visibility.sprayerPasses ? (sprayerPassLines(geom) as FeatureCollection) : EMPTY,
    )
    ;(map.getSource('sprayerlimit') as GeoJSONSource | undefined)?.setData(
      visibility.sprayerLimit ? (outerSprayerLimit(geom) as FeatureCollection) : EMPTY,
    )
    ;(map.getSource('tirezone') as GeoJSONSource | undefined)?.setData((tireEdge?.tire as FeatureCollection) ?? EMPTY)
    ;(map.getSource('edgezone') as GeoJSONSource | undefined)?.setData((tireEdge?.edge as FeatureCollection) ?? EMPTY)
    ;(map.getSource('alignment') as GeoJSONSource | undefined)?.setData(
      visibility.alignment ? (alignmentLines(shelters, geom) as FeatureCollection) : EMPTY,
    )
    ;(map.getSource('buffers') as GeoJSONSource | undefined)?.setData(
      visibility.buffers ? (shelterBufferSquares(shelters, geom) as FeatureCollection) : EMPTY,
    )

    // Imported machine paths ([lat,lon] stored → [lon,lat] for GeoJSON).
    const pathsFC = (key: string): FeatureCollection => {
      const raw = Array.isArray(geom[key]) ? (geom[key] as unknown[]) : []
      return {
        type: 'FeatureCollection',
        features: raw
          .filter((p): p is Array<[number, number]> => Array.isArray(p) && p.length >= 2)
          .map((line) => ({
            type: 'Feature' as const,
            properties: {},
            geometry: { type: 'LineString' as const, coordinates: line.map(([la, lo]) => [num(lo), num(la)]) },
          })),
      }
    }
    ;(map.getSource('planterpaths') as GeoJSONSource | undefined)?.setData(
      visibility.planterPaths ? pathsFC('planter_passes') : EMPTY,
    )
    ;(map.getSource('sprayerpaths') as GeoJSONSource | undefined)?.setData(
      visibility.sprayerPaths ? pathsFC('sprayer_passes') : EMPTY,
    )
    ;(map.getSource('testshelters') as GeoJSONSource | undefined)?.setData(
      visibility.shelters
        ? {
            type: 'FeatureCollection',
            features: (Array.isArray(geom.test_shelter_pins) ? (geom.test_shelter_pins as unknown[]) : [])
              .filter((p): p is [number, number] => Array.isArray(p) && p.length >= 2)
              .map((p) => ({
                type: 'Feature' as const,
                properties: { test: true },
                geometry: { type: 'Point' as const, coordinates: [num(p[1]), num(p[0])] },
              })),
          }
        : EMPTY,
    )
    ;(map.getSource('actualshelters') as GeoJSONSource | undefined)?.setData(
      visibility.actualShelters || shelterView === 'actual'
        ? {
            type: 'FeatureCollection',
            features: (Array.isArray(geom.actual_shelter_pins) ? (geom.actual_shelter_pins as unknown[]) : [])
              .filter((p): p is [number, number] => Array.isArray(p) && p.length >= 2)
              .map((p, i) => ({
                type: 'Feature' as const,
                properties: { n: i + 1 },
                geometry: { type: 'Point' as const, coordinates: [num(p[1]), num(p[0])] },
              })),
          }
        : EMPTY,
    )
    ;(map.getSource('crewroute') as GeoJSONSource | undefined)?.setData(
      crew.route.length >= 2 && visibility.crewRoute
        ? {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: {},
                geometry: { type: 'LineString', coordinates: crew.route.map(([lat, lon]) => [lon, lat]) },
              },
            ],
          }
        : EMPTY,
    )

    // Entrance / parking / home pins as lettered HTML markers.
    pinMarkersRef.current.forEach((m) => m.remove())
    pinMarkersRef.current = (visibility.fieldInfo ? overlayPins(geom) : []).map((pin) => {
      const el = document.createElement('div')
      el.textContent = PIN_LABEL[pin.kind]
      el.style.cssText =
        `display:flex;align-items:center;justify-content:center;width:20px;height:20px;` +
        `border-radius:9999px;background:${PIN_COLORS[pin.kind]};color:#fff;font:700 11px/1 sans-serif;` +
        `border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)`
      return new maplibregl.Marker({ element: el }).setLngLat([pin.lng, pin.lat]).addTo(map)
    })
  }, [ready, previewGeom, shelters, editing, crew, visibility])

  // While editing, every shelter pin is a draggable marker (drag to move,
  // double-click to delete). Manual mode edits manual_shelter_pins directly;
  // computed modes record per-combo shelter_overrides keyed by grid index.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    shelterMarkersRef.current.forEach((m) => m.remove())
    if (!editing) {
      shelterMarkersRef.current = []
      return
    }
    shelterMarkersRef.current = shelters.map((pin) => {
      const el = document.createElement('div')
      el.title = 'Drag to move · double-click to delete'
      el.style.cssText =
        `width:14px;height:14px;border-radius:9999px;background:${BRAND};` +
        `border:2px solid ${PIN_OUTLINE};box-shadow:0 1px 3px rgba(0,0,0,.5);cursor:grab`
      el.addEventListener('dblclick', (ev) => {
        ev.stopPropagation()
        if (manualEditing) deleteManualPin(pin.gridIdx)
        else setPinOverride(pin.gridIdx, null)
      })
      const marker = new maplibregl.Marker({ element: el, draggable: true }).setLngLat([pin.lng, pin.lat]).addTo(map)
      marker.on('dragend', () => {
        const ll = marker.getLngLat()
        if (manualEditing) updateManualPin(pin.gridIdx, ll.lat, ll.lng)
        else setPinOverride(pin.gridIdx, [ll.lat, ll.lng])
      })
      return marker
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, editing, manualEditing, shelters])

  // Placing TEST shelters — blue, counted separately from the working grid (§6.5).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !placingTest) return
    const handler = (e: maplibregl.MapMouseEvent) => {
      pushHistory()
      setDraft((prev) => {
        if (!prev) return prev
        const cur = Array.isArray(prev.test_shelter_pins) ? (prev.test_shelter_pins as unknown[]) : []
        return { ...prev, test_shelter_pins: [...cur, [e.lngLat.lat, e.lngLat.lng]] }
      })
    }
    map.on('click', handler)
    map.getCanvas().style.cursor = 'crosshair'
    return () => {
      map.off('click', handler)
      if (mapRef.current) map.getCanvas().style.cursor = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, placingTest])

  // While placing, each map click drops a manual shelter pin.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !placing || !manualEditing) return
    const handler = (e: maplibregl.MapMouseEvent) => addManualPin(e.lngLat.lat, e.lngLat.lng)
    map.on('click', handler)
    map.getCanvas().style.cursor = 'crosshair'
    return () => {
      map.off('click', handler)
      if (mapRef.current) map.getCanvas().style.cursor = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, placing, manualEditing, manualPins])

  // Live crews: subscribe to Field Mode broadcasts; prune stale (>90 s) nodes.
  useEffect(() => {
    if (!supabase) return
    const channel = supabase
      .channel('crew_live')
      .on('broadcast', { event: 'crew' }, ({ payload }) => {
        const c = payload as LiveCrew
        if (!c?.name || !Number.isFinite(c.lat) || !Number.isFinite(c.lng)) return
        setLiveCrews((prev) => ({ ...prev, [c.name]: c }))
      })
      .subscribe()
    const prune = setInterval(
      () =>
        setLiveCrews((prev) =>
          Object.fromEntries(Object.entries(prev).filter(([, c]) => Date.now() - new Date(c.at).getTime() < 90_000)),
        ),
      30_000,
    )
    return () => {
      clearInterval(prune)
      supabase?.removeChannel(channel)
    }
  }, [])

  // Draw live-crew pins (teal, name + progress).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    crewMarkersRef.current.forEach((m) => m.remove())
    crewMarkersRef.current = Object.values(liveCrews).map((c) => {
      const el = document.createElement('div')
      el.textContent = `${c.name} ${c.placed}/${c.total}`
      el.title = `${c.name} — ${c.fieldName} (${c.placed}/${c.total} placed)`
      el.style.cssText =
        `padding:2px 8px;border-radius:9999px;background:${CREW_LIVE};color:#04201C;` +
        `font:600 11px/1.4 sans-serif;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5);white-space:nowrap`
      return new maplibregl.Marker({ element: el }).setLngLat([c.lng, c.lat]).addTo(map)
    })
  }, [ready, liveCrews])

  // Render the in-progress draw ring (polygon once ≥3 pts) + its vertices.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const src = map.getSource('draw') as GeoJSONSource | undefined
    const vsrc = map.getSource('drawv') as GeoJSONSource | undefined
    if (!drawing || drawPts.length === 0) {
      src?.setData(EMPTY)
      vsrc?.setData(EMPTY)
      return
    }
    const lngLat: Position[] = drawPts.map(([lat, lon]) => [lon, lat])
    const shape: Feature =
      drawPts.length >= 3
        ? { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...lngLat, lngLat[0]]] } }
        : { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: lngLat } }
    src?.setData({ type: 'FeatureCollection', features: [shape] })
    vsrc?.setData({
      type: 'FeatureCollection',
      features: lngLat.map((c) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: c } })),
    })
  }, [ready, drawing, drawPts])

  // While drawing, each map click drops a ring vertex.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !drawing) return
    const handler = (e: maplibregl.MapMouseEvent) => setDrawPts((prev) => [...prev, [e.lngLat.lat, e.lngLat.lng]])
    map.on('click', handler)
    map.getCanvas().style.cursor = 'crosshair'
    return () => {
      map.off('click', handler)
      if (mapRef.current) map.getCanvas().style.cursor = ''
    }
  }, [ready, drawing])

  // Click-to-place: pivot / 2nd pivot / entrance / parking (§6.1, §6.2).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !pinTarget) return
    const handler = (e: maplibregl.MapMouseEvent) => setPin(pinTarget, e.lngLat.lat, e.lngLat.lng)
    map.on('click', handler)
    map.getCanvas().style.cursor = 'crosshair'
    return () => {
      map.off('click', handler)
      if (mapRef.current) map.getCanvas().style.cursor = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, pinTarget])

  // Click at a distance from the pivot to add a track at that radius (§6.1).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !addingTrack) return
    const handler = (e: maplibregl.MapMouseEvent) => addTrackAt(e.lngLat.lat, e.lngLat.lng)
    map.on('click', handler)
    map.getCanvas().style.cursor = 'crosshair'
    return () => {
      map.off('click', handler)
      if (mapRef.current) map.getCanvas().style.cursor = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, addingTrack, draft])

  // Vertex handles for the ring being edited (§6.2). Drag to move a corner,
  // double-click to remove it. Rebuilt whenever the ring changes so the handles
  // and the drawn polygon can never drift apart.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    vertexMarkersRef.current.forEach((m) => m.remove())
    vertexMarkersRef.current = []
    if (!editing || !vertexEdit) return
    const ring = readRing(vertexEdit.target, vertexEdit.index)
    if (!ring) return
    vertexMarkersRef.current = ring.map(([lat, lon], i) => {
      const el = document.createElement('div')
      el.title = 'Drag to move · double-click to remove'
      el.style.cssText =
        `width:11px;height:11px;border-radius:2px;background:${FIELD};` +
        `border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.5);cursor:grab`
      el.addEventListener('dblclick', (ev) => {
        ev.stopPropagation()
        deleteVertex(vertexEdit.target, vertexEdit.index, i)
      })
      const marker = new maplibregl.Marker({ element: el, draggable: true }).setLngLat([lon, lat]).addTo(map)
      // Snapshot once at drag START so a whole drag is a single undo step (§9).
      marker.on('dragstart', () => pushHistory())
      marker.on('dragend', () => {
        const ll = marker.getLngLat()
        moveVertex(vertexEdit.target, vertexEdit.index, i, ll.lat, ll.lng)
      })
      return marker
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, editing, vertexEdit, draft])

  // Two clicks = a distance measurement (§6.7).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !measuring) return
    const handler = (e: maplibregl.MapMouseEvent) =>
      setMeasure((prev) => (prev.length >= 2 ? [[e.lngLat.lat, e.lngLat.lng]] : [...prev, [e.lngLat.lat, e.lngLat.lng]]))
    map.on('click', handler)
    map.getCanvas().style.cursor = 'crosshair'
    return () => {
      map.off('click', handler)
      if (mapRef.current) map.getCanvas().style.cursor = ''
    }
  }, [ready, measuring])

  // Hand-editing the crew route: each click appends a vertex to the override.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !routeEditing) return
    const handler = (e: maplibregl.MapMouseEvent) =>
      setDraft((prev) => {
        if (!prev) return prev
        const cur = Array.isArray(prev.crew_route_override) ? (prev.crew_route_override as Array<[number, number]>) : []
        return { ...prev, crew_route_override: [...cur, [e.lngLat.lat, e.lngLat.lng]] }
      })
    map.on('click', handler)
    map.getCanvas().style.cursor = 'crosshair'
    return () => {
      map.off('click', handler)
      if (mapRef.current) map.getCanvas().style.cursor = ''
    }
  }, [ready, routeEditing])

  // Fit the view when the SELECTED FIELD changes (not on every draft keystroke).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const boundary = boundaryFeature(selectedField?.geometry)
    const pins = selectedField?.geometry ? getTentPositions(selectedField.geometry) : []
    const features: Feature[] = [...(boundary ? [boundary] : []), ...sheltersCollection(pins).features]
    if (features.length === 0) return
    const [minX, minY, maxX, maxY] = turfBbox({ type: 'FeatureCollection', features })
    map.fitBounds(
      [
        [minX, minY],
        [maxX, maxY],
      ],
      { padding: 64, duration: 700, maxZoom: 16 },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, selectedField])

  // While editing a pivot field, clicking the map moves the pivot centre.
  // (Disabled during boundary drawing — that handler owns clicks then.)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !editing || !isPivotDraft || drawing || placing) return
    const handler = (e: maplibregl.MapMouseEvent) => {
      setDraft((prev) =>
        prev ? { ...prev, PP_Longitude: String(e.lngLat.lng), PP_Latitude: String(e.lngLat.lat) } : prev,
      )
    }
    map.on('click', handler)
    map.getCanvas().style.cursor = 'crosshair'
    return () => {
      map.off('click', handler)
      if (mapRef.current) map.getCanvas().style.cursor = ''
    }
  }, [ready, editing, isPivotDraft, drawing, placing])

  /**
   * The active tool layer's actions (spec Part 6). Only meaningful while
   * editing — the map is read-only otherwise, matching the desktop app where
   * authoring tools belong to an open field.
   */
  const toolActions: ToolAction[] = useMemo(() => {
    if (!editing || !draft) return []
    /** Vertex-edit the MOST RECENT ring of a list type (§6.2 "Edit …"). */
    const editRingAction = (t: Exclude<RingTarget, 'boundary'>): ToolAction => {
      const n = ringCount(t)
      const on = vertexEdit?.target === t
      return {
        id: `edit-${t}`,
        label: on ? 'Done editing vertices' : `Edit ${RING_SPEC[t].label} vertices`,
        active: on,
        disabled: n === 0,
        onClick: () => setVertexEdit(on ? null : { target: t, index: n - 1 }),
      }
    }
    const drawAction = (t: RingTarget, label: string): ToolAction => ({
      id: `draw-${t}`,
      label: drawing && drawTarget === t ? `Drawing ${RING_SPEC[t].label}…` : label,
      active: drawing && drawTarget === t,
      onClick: () => (drawing && drawTarget === t ? resetDraw() : startDraw(t)),
    })
    switch (tool) {
      case 'pivot':
        return [
          { id: 'set-pivot', label: pinTarget === 'pivot' ? 'Click the map…' : 'Set pivot point', active: pinTarget === 'pivot', onClick: () => (pinTarget === 'pivot' ? setPinTarget(null) : armPin('pivot')) },
          { id: 'set-pivot2', label: pinTarget === 'pivot2' ? 'Click the map…' : 'Set 2nd pivot', active: pinTarget === 'pivot2', onClick: () => (pinTarget === 'pivot2' ? setPinTarget(null) : armPin('pivot2')) },
          { id: 'add-track', label: addingTrack ? 'Click at the track radius…' : 'Add pivot track', active: addingTrack, onClick: () => setAddingTrack((v) => !v) },
          ...trackRadii.map((r, i) => ({
            id: `del-track-${i}`,
            label: `Delete ${Math.round(r)} m`,
            onClick: () => deleteTrack(i),
          })),
        ]
      case 'boundary':
        return [
          drawAction('boundary', 'Draw boundary'),
          {
            id: 'edit-boundary',
            label: vertexEdit?.target === 'boundary' ? 'Done editing vertices' : 'Edit boundary vertices',
            active: vertexEdit?.target === 'boundary',
            disabled: !readRing('boundary', 0),
            onClick: () => setVertexEdit((v) => (v?.target === 'boundary' ? null : { target: 'boundary', index: 0 })),
          },
          { id: 'import', label: 'Import file', onClick: () => fileInputRef.current?.click() },
          drawAction('inner', 'Add inner boundary'),
          editRingAction('inner'),
          { id: 'del-inner', label: `Delete inner (${ringCount('inner')})`, disabled: ringCount('inner') === 0, onClick: () => deleteLastRing('inner') },
          drawAction('access', 'Add access road'),
          editRingAction('access'),
          { id: 'del-access', label: `Delete access (${ringCount('access')})`, disabled: ringCount('access') === 0, onClick: () => deleteLastRing('access') },
          drawAction('wet', 'Add wet zone'),
          editRingAction('wet'),
          { id: 'del-wet', label: `Delete wet zone (${ringCount('wet')})`, disabled: ringCount('wet') === 0, onClick: () => deleteLastRing('wet') },
          { id: 'set-entrance', label: pinTarget === 'entrance' ? 'Click the map…' : 'Set entrance', active: pinTarget === 'entrance', onClick: () => (pinTarget === 'entrance' ? setPinTarget(null) : armPin('entrance')) },
          { id: 'set-parking', label: pinTarget === 'parking' ? 'Click the map…' : 'Set parking', active: pinTarget === 'parking', onClick: () => (pinTarget === 'parking' ? setPinTarget(null) : armPin('parking')) },
          { id: 'clr-entrance', label: 'Clear entrance', disabled: !draft.entrance_pin, onClick: () => clearPin('entrance_pin') },
          { id: 'clr-parking', label: 'Clear parking', disabled: !draft.parking_pin, onClick: () => clearPin('parking_pin') },
        ]
      case 'sprayer':
        return [
          { id: 'import-sprayer', label: 'Import sprayer data', onClick: () => pathInputRef.current?.click() },
          { id: 'clear-sprayer', label: `Clear paths (${pathCount('sprayer_passes')})`, disabled: pathCount('sprayer_passes') === 0, onClick: () => clearPaths('sprayer_passes') },
          { id: 'shift-sprayer-l', label: '◀ Shift 1 m', onClick: () => nudgeSprayer(-1) },
          { id: 'shift-sprayer-r', label: 'Shift 1 m ▶', onClick: () => nudgeSprayer(1) },
          {
            id: 'through-inner',
            label: `Passes ${draft.sprayer_routes_around_inner === false ? 'run through' : 'break at'} inner`,
            onClick: () => {
              pushHistory()
              setDraft((p) => (p ? { ...p, sprayer_routes_around_inner: p.sprayer_routes_around_inner === false } : p))
            },
          },
          { id: 'sprayer-note', label: `Boom ${str(draft.Sprayer_width) || '133'} ft · edge ${str(draft.pass_edge_buffer_ft) || '25'} ft · tire ${str(draft.tire_width_ft) || '14'} ft`, disabled: true, onClick: () => {} },
        ]
      case 'planter':
        return [
          { id: 'import-planter', label: 'Import planter data', onClick: () => planterInputRef.current?.click() },
          { id: 'clear-planter', label: `Clear paths (${pathCount('planter_passes')})`, disabled: pathCount('planter_passes') === 0, onClick: () => clearPaths('planter_passes') },
          { id: 'shift-w', label: '◀ Shift bays 1 m', onClick: () => nudgeBays(-1, 0) },
          { id: 'shift-e', label: 'Shift bays 1 m ▶', onClick: () => nudgeBays(1, 0) },
          { id: 'shift-reset', label: 'Reset bay shift', disabled: !num(draft.bay_shift_e_m) && !num(draft.bay_shift_n_m), onClick: () => { pushHistory(); setDraft((p) => (p ? { ...p, bay_shift_e_m: 0, bay_shift_n_m: 0 } : p)) } },
          {
            id: 'bays-through-inner',
            label: `Bays ${truthyVal(draft.bays_through_inner) ? 'run through' : 'clip at'} inner`,
            onClick: () => {
              pushHistory()
              setDraft((p) => (p ? { ...p, bays_through_inner: !truthyVal(p.bays_through_inner) } : p))
            },
          },
          { id: 'planter-note', label: `${str(draft.total_rows) || '—'} rows @ ${str(draft.row_spacing_in) || '—'} in · ${str(draft.num_female_rows) || '—'}F/${str(draft.num_male_rows) || '—'}M`, disabled: true, onClick: () => {} },
        ]
      case 'shelters':
        return [
          { id: 'view', label: `Showing: ${shelterView}`, onClick: () => setShelterView((v) => (v === 'planned' ? 'actual' : 'planned')) },
          { id: 'numbers', label: `Numbers: ${pinNumbers === 'off' ? 'off' : pinNumbers === 'shelter' ? 'shelter #' : 'tray count'}`, onClick: () => setPinNumbers((m) => (m === 'off' ? 'shelter' : m === 'shelter' ? 'trays' : 'off')) },
          { id: 'reflow', label: 'Reflow to grid', disabled: overrideCount === 0, onClick: onReflow },
          ...(manualEditing
            ? [{ id: 'add-shelter', label: placing ? 'Click the map…' : 'Add shelter pin', active: placing, onClick: () => { setPlacingTest(false); setPlacing((v) => !v) } }]
            : []),
          { id: 'add-test', label: placingTest ? 'Click the map…' : 'Add test shelter', active: placingTest, onClick: () => { setPlacing(false); setPlacingTest((v) => !v) } },
          { id: 'import-actual', label: 'Import actual pins (CSV)', onClick: () => csvInputRef.current?.click() },
          { id: 'clear-actual', label: `Clear actual (${pathCount('actual_shelter_pins')})`, disabled: pathCount('actual_shelter_pins') === 0, onClick: () => clearPaths('actual_shelter_pins') },
        ]
      case 'crews':
        return [
          { id: 'edit-route', label: routeEditing ? 'Click to add points — done' : 'Edit crew route', active: routeEditing, onClick: () => setRouteEditing((v) => !v) },
          { id: 'reset-route', label: 'Reset crew route', disabled: !draft.crew_route_override, onClick: () => { pushHistory(); setDraft((p) => (p ? { ...p, crew_route_override: null } : p)) } },
        ]
    }
  }, [
    editing,
    draft,
    tool,
    drawing,
    drawTarget,
    pinTarget,
    addingTrack,
    trackRadii,
    placing,
    placingTest,
    manualEditing,
    routeEditing,
    pinNumbers,
    shelterView,
    vertexEdit,
    overrideCount,
  ])


  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Shelter Maps" subtitle="Bee-shelter placement on pollination fields (MapLibre)" />
      <MapToolbar
        visibility={visibility}
        onToggleLayer={toggleLayer}
        tool={tool}
        onTool={setTool}
        actions={[
          ...toolActions,
          ...(editing
            ? ([
                {
                  id: 'measure',
                  label: measuring ? (measureM != null ? `${measureM.toFixed(1)} m (${(measureM * 3.28084).toFixed(0)} ft)` : 'Click two points…') : 'Measure',
                  active: measuring,
                  onClick: () => {
                    setMeasure([])
                    setMeasuring((v) => !v)
                  },
                },
                // historyTick forces this list to rebuild after each push/pop so
                // the buttons enable and disable with the stacks.
                { id: `undo-${historyTick}`, label: 'Undo', disabled: undoRef.current.length === 0, onClick: undo },
                { id: 'redo', label: 'Redo', disabled: redoRef.current.length === 0, onClick: redo },
              ] as ToolAction[])
            : []),
        ]}
        status={
          !editing
            ? 'Open a field and press Edit to use the authoring tools.'
            : measureM != null
              ? `Measured ${measureM.toFixed(1)} m · ${(measureM * 3.28084).toFixed(0)} ft`
              : null
        }
      />
      <div
        className={`grid min-h-0 flex-1 ${
          editing ? 'md:grid-cols-[18rem_1fr_22rem]' : 'md:grid-cols-[18rem_1fr]'
        }`}
      >
        {/* Field list */}
        <aside className="overflow-y-auto border-r border-subtle bg-surface p-3">
          <h2 className="mb-2 px-1 text-sm font-semibold text-secondary">Fields</h2>
          {/* Search by name / company / year / LLD (§6.7 "Find by LLD", §9). */}
          <input
            className="input mb-2 min-h-0 px-2 py-1.5 text-sm"
            value={fieldQuery}
            onChange={(e) => setFieldQuery(e.target.value)}
            placeholder="Find by name, company, year, LLD…"
          />
          {visibleFields.length === 0 && <p className="px-1 py-2 text-xs text-muted">No fields match.</p>}
          {visibleFields.map((f) => {
            const active = selectedField?.id === f.id
            return (
              <button
                key={f.id}
                onClick={() => selectField(f.id)}
                className={`mb-2 block w-full rounded-lg border p-3 text-left transition ${
                  active ? 'border-brand bg-brand-light' : 'border-subtle hover:bg-[color:var(--hover-wash)]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-primary">{f.name}</span>
                  <Badge tone={f.geometry ? 'brand' : 'blue'}>{f.geometry ? f.shapeType : 'no map'}</Badge>
                </div>
                <p className="mt-0.5 text-xs text-muted">{f.region}</p>
                <p className="mt-1 text-xs text-secondary">
                  {f.shelterCount} shelters · {f.client}
                </p>
              </button>
            )
          })}
        </aside>

        {/* Map + detail overlay */}
        <div className="relative min-h-[20rem]">
          <div ref={containerRef} className="absolute inset-0" />

          {/* Drawing HUD — only while a click-to-place mode is armed */}
          {editing && (drawing || placing || pinTarget || addingTrack || measuring || routeEditing || importError) && (
            <div
              className="absolute left-3 top-3 flex flex-col gap-2 rounded-lg border border-subtle p-2 shadow-md backdrop-blur"
              style={{ background: 'color-mix(in srgb, var(--bg-raised) 92%, transparent)' }}
            >
              {drawing && (
                <>
                  <div className="max-w-[13rem] text-[11px] text-muted">
                    Click the map to trace the {RING_SPEC[drawTarget].label} ({drawPts.length} placed). Finish needs 3+.
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      className="btn-primary min-h-0 px-2 py-1.5 text-xs disabled:opacity-40"
                      onClick={finishDraw}
                      disabled={drawPts.length < 3}
                    >
                      <Check size={14} /> Finish
                    </button>
                    <button className="btn-ghost min-h-0 px-2 py-1.5 text-xs" onClick={() => setDrawPts((p) => p.slice(0, -1))} disabled={!drawPts.length}>
                      <Undo2 size={14} />
                    </button>
                    <button className="btn-ghost min-h-0 px-2 py-1.5 text-xs" onClick={resetDraw}>
                      <XIcon size={14} />
                    </button>
                  </div>
                </>
              )}
              {pinTarget && (
                <div className="max-w-[13rem] text-[11px] text-muted">
                  Click the map to set the {PIN_SPEC[pinTarget].label}.
                </div>
              )}
              {addingTrack && (
                <div className="max-w-[13rem] text-[11px] text-muted">
                  Click anywhere on the track — its distance from the pivot becomes the radius.
                </div>
              )}
              {routeEditing && (
                <div className="max-w-[13rem] text-[11px] text-muted">
                  Click to add crew-route points, then press Edit crew route again.
                </div>
              )}
              {measuring && (
                <div className="max-w-[13rem] text-[11px] text-muted">
                  {measure.length < 2 ? 'Click two points to measure.' : 'Click to start a new measurement.'}
                </div>
              )}
              {placing && (
                <>
                  <div className="max-w-[13rem] text-[11px] text-muted">
                    Click map to add a shelter. Drag a pin to move, double-click to delete.
                  </div>
                  <button
                    className="btn-ghost min-h-0 px-2 py-1.5 text-xs"
                    onClick={() => setManualPins([])}
                    disabled={!manualPins.length}
                  >
                    Clear {manualPins.length} pins
                  </button>
                </>
              )}
              {importError && <p className="max-w-[13rem] text-[11px] text-danger">{importError}</p>}
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept=".kml,.kmz,.zip,.shp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onImportFile(f)
              e.target.value = ''
            }}
          />
          <input
            ref={planterInputRef}
            type="file"
            accept=".geojson,.json,.kml,.kmz,.zip,.shp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onImportPaths(f, 'planter_passes')
              e.target.value = ''
            }}
          />
          <input
            ref={pathInputRef}
            type="file"
            accept=".geojson,.json,.kml,.kmz,.zip,.shp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onImportPaths(f, 'sprayer_passes')
              e.target.value = ''
            }}
          />
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv,.txt"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onImportActual(f)
              e.target.value = ''
            }}
          />

          {selectedField && !editing && (
            <div
              className="absolute left-3 top-3 max-w-xs rounded-lg border border-subtle p-3 shadow-md backdrop-blur"
              style={{ background: 'color-mix(in srgb, var(--bg-raised) 92%, transparent)' }}
            >
              <div className="font-display font-bold text-primary">{selectedField.name}</div>
              <div className="text-xs text-muted">
                {selectedField.region} · {selectedField.client}
              </div>
              {selectedField.geometry ? (
                <>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: BRAND }} />
                      <span className="font-mono tabular font-semibold text-primary">{shelters.length}</span>
                      <span className="text-muted">shelters (live)</span>
                    </span>
                    {crew.totalM > 0 && (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="inline-block h-0.5 w-3" style={{ backgroundColor: CREW }} />
                        <span className="font-mono tabular font-semibold text-primary">{(crew.totalM / 1000).toFixed(1)}</span>
                        <span className="text-muted">km route</span>
                      </span>
                    )}
                  </div>
                  {hasOverlays(selectedField.geometry) && (
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] capitalize text-secondary">
                      {legendItems(selectedField.geometry).map((it) => (
                        <span key={it.label} className="inline-flex items-center gap-1">
                          <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: it.color }} />
                          {it.label}
                        </span>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <p className="mt-2 text-sm text-muted">No field geometry imported yet.</p>
              )}
              {selectedField.geometry && shelters.length > 0 && (
                <div className="mt-3">
                  <div className="label mb-1">Export</div>
                  <div className="flex flex-wrap gap-1.5">
                    {(['kml', 'geojson', 'csv', 'pdf', 'shp', 'jd', 'aggps'] as const).map((k) => (
                      <button
                        key={k}
                        className="btn-ghost min-h-0 px-2 py-1 text-[11px] uppercase"
                        onClick={() => exportField(k)}
                      >
                        {k}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {canEdit && (
                <button className="btn-primary mt-3 w-full" onClick={enterEdit}>
                  {selectedField.geometry ? 'Edit field' : 'Add pivot geometry'}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Editor (third column, only while editing) */}
        {editing && draft && selectedField && (
          <aside className="min-h-0 border-l border-subtle bg-surface">
            <FieldEditor
              name={draftName}
              draft={draft}
              isPivot={isPivotDraft}
              count={shelters.length}
              dirty={dirty}
              warnings={warnings}
              onName={setDraftName}
              onChange={onChange}
              onSave={onSave}
              onCancel={onCancel}
            />
          </aside>
        )}
      </div>
    </div>
  )
}
