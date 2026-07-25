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
import { Pencil, Upload, Check, Undo2, X as XIcon, MapPin } from 'lucide-react'
import { getTentPositions } from '@/domain/tentGrid'
import { applyShelterOverrides, comboKey, syncComboAdjustments, reflowToGrid, type ShelterOverrides } from '@/domain/shelterOverrides'
import { crewRoute } from '@/domain/crewRoute'
import { fieldWarnings } from '@/domain/fieldWarnings'
import { FieldEditor } from './FieldEditor'
import { SATELLITE_STYLE } from './basemap'
import { trackRings, ringPolygons, cornerArms, overlayPins, hasOverlays, type PinKind } from './overlays'
import { boundaryFromFile, ringAcres } from './importBoundary'
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

function sheltersCollection(pins: { lng: number; lat: number }[]): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: pins.map((p, i) => ({
      type: 'Feature',
      properties: { n: i + 1 },
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
  const [ready, setReady] = useState(false)
  // Boundary drawing: an in-progress ring of [lat, lon] vertices.
  const [drawing, setDrawing] = useState(false)
  const [drawPts, setDrawPts] = useState<Array<[number, number]>>([])
  const [importError, setImportError] = useState<string | null>(null)
  // Manual-shelter placement (mode = 'manual'): click to drop pins.
  const [placing, setPlacing] = useState(false)
  // Live crews broadcasting from Field Mode.
  const [liveCrews, setLiveCrews] = useState<Record<string, LiveCrew>>({})
  const crewMarkersRef = useRef<maplibregl.Marker[]>([])

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
    setImportError(null)
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

  function startDraw() {
    setImportError(null)
    setDrawPts([])
    setDrawing(true)
  }
  function finishDraw() {
    if (drawPts.length < 3) return
    applyBoundary(drawPts, ringAcres(drawPts))
    fitToRing(drawPts)
    resetDraw()
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
      boundary ? { type: 'FeatureCollection', features: [boundary] } : EMPTY,
    )
    ;(map.getSource('pivot') as GeoJSONSource | undefined)?.setData(
      pivot ? { type: 'FeatureCollection', features: [pivot] } : EMPTY,
    )
    // While editing, draggable markers stand in for the dots (manual pins AND
    // computed pins — the latter drag into per-combo overrides).
    ;(map.getSource('shelters') as GeoJSONSource | undefined)?.setData(editing ? EMPTY : sheltersCollection(shelters))

    // Overlays: tracks, exclusion zones, corner arms.
    const geom = previewGeom ?? {}
    const corner = cornerArms(geom)
    ;(map.getSource('tracks') as GeoJSONSource | undefined)?.setData(trackRings(geom))
    ;(map.getSource('inner') as GeoJSONSource | undefined)?.setData(ringPolygons(geom.boundary_inner))
    ;(map.getSource('access') as GeoJSONSource | undefined)?.setData(ringPolygons(geom.access_road_boundary))
    ;(map.getSource('wetzones') as GeoJSONSource | undefined)?.setData(ringPolygons(geom.wet_zones))
    ;(map.getSource('corner') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: [...corner.lines.features, ...corner.circles.features],
    })
    ;(map.getSource('crewroute') as GeoJSONSource | undefined)?.setData(
      crew.route.length >= 2
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
    pinMarkersRef.current = overlayPins(geom).map((pin) => {
      const el = document.createElement('div')
      el.textContent = PIN_LABEL[pin.kind]
      el.style.cssText =
        `display:flex;align-items:center;justify-content:center;width:20px;height:20px;` +
        `border-radius:9999px;background:${PIN_COLORS[pin.kind]};color:#fff;font:700 11px/1 sans-serif;` +
        `border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)`
      return new maplibregl.Marker({ element: el }).setLngLat([pin.lng, pin.lat]).addTo(map)
    })
  }, [ready, previewGeom, shelters, editing, crew])

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

  // While drawing, each map click drops a boundary vertex.
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

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Shelter Maps" subtitle="Bee-shelter placement on pollination fields (MapLibre)" />
      <div
        className={`grid min-h-0 flex-1 ${
          editing ? 'md:grid-cols-[18rem_1fr_22rem]' : 'md:grid-cols-[18rem_1fr]'
        }`}
      >
        {/* Field list */}
        <aside className="overflow-y-auto border-r border-subtle bg-surface p-3">
          <h2 className="mb-2 px-1 text-sm font-semibold text-secondary">Fields</h2>
          {fields.map((f) => {
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

          {/* Boundary tools (while editing) */}
          {editing && (
            <div
              className="absolute left-3 top-3 flex flex-col gap-2 rounded-lg border border-subtle p-2 shadow-md backdrop-blur"
              style={{ background: 'color-mix(in srgb, var(--bg-raised) 92%, transparent)' }}
            >
              {!drawing ? (
                <>
                  <button className="btn-ghost min-h-0 px-2 py-1.5 text-xs" onClick={startDraw}>
                    <Pencil size={14} /> Draw boundary
                  </button>
                  <button className="btn-ghost min-h-0 px-2 py-1.5 text-xs" onClick={() => fileInputRef.current?.click()}>
                    <Upload size={14} /> Import file
                  </button>
                  {importError && <p className="max-w-[12rem] text-[11px] text-danger">{importError}</p>}
                  {!manualEditing && overrideCount > 0 && (
                    <div className="mt-1 border-t border-subtle pt-2">
                      <div className="mb-1 text-[11px] text-muted">{overrideCount} pin override{overrideCount === 1 ? '' : 's'}</div>
                      <button className="btn-ghost min-h-0 px-2 py-1.5 text-xs" onClick={onReflow}>
                        <Undo2 size={14} /> Reflow to grid
                      </button>
                    </div>
                  )}
                  {manualEditing && (
                    <div className="mt-1 border-t border-subtle pt-2">
                      <div className="mb-1 text-[11px] text-muted">{manualPins.length} manual pins</div>
                      <div className="flex gap-1.5">
                        <button
                          className={`${placing ? 'btn-primary' : 'btn-ghost'} min-h-0 px-2 py-1.5 text-xs`}
                          onClick={() => setPlacing((v) => !v)}
                        >
                          <MapPin size={14} /> {placing ? 'Done' : 'Add shelters'}
                        </button>
                        <button
                          className="btn-ghost min-h-0 px-2 py-1.5 text-xs"
                          onClick={() => setManualPins([])}
                          disabled={!manualPins.length}
                        >
                          Clear
                        </button>
                      </div>
                      {placing && (
                        <p className="mt-1 max-w-[12rem] text-[11px] text-muted">
                          Click map to add. Drag a pin to move, double-click to delete.
                        </p>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="max-w-[12rem] text-[11px] text-muted">
                    Click the map to add points ({drawPts.length} placed). Finish needs 3+.
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
            </div>
          )}

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
