import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { type StyleSpecification, type GeoJSONSource } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { circle as turfCircle, bbox as turfBbox } from '@turf/turf'
import type { Feature, FeatureCollection, Polygon, Point, Position } from 'geojson'
import { PageHeader, Badge } from '@/components/ui'
import { useData } from '@/data/context'
import { useSession } from '@/auth/session'
import type { Field, FieldGeometry } from '@/data/types'
import { getTentPositions } from '@/domain/tentGrid'
import { FieldEditor } from './FieldEditor'
import { trackRings, ringPolygons, cornerArms, overlayPins, hasOverlays, type PinKind } from './overlays'

// Theme colours (tailwind.config.js) used for map features.
const BRAND = '#B8860B' // honey amber — shelter pins
const FIELD = '#4D7C0F' // canola green — field boundary
const INK = '#1A1206' // pivot centre

// Overlay colours — matched to the old desktop app.
const TRACK = '#FF2A2A' // pivot wheel tracks / corner arms
const INNER = '#FF6600' // inner boundary exclusion
const ACCESS = '#FF2D95' // pivot access road
const WET = '#1E90FF' // wet zones (fill)
const WET_LINE = '#0A3D7A' // wet zones (outline)
const PIN_COLORS: Record<PinKind, string> = { entrance: '#16A34A', parking: '#F59E0B', home: '#2563EB' }
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

// Satellite basemap — Esri World Imagery (free raster tiles, no API key), with a
// light labels/roads overlay so towns + roads stay legible over the imagery.
const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    satellite: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    },
    labels: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© Esri',
    },
  },
  layers: [
    { id: 'satellite', type: 'raster', source: 'satellite' },
    { id: 'labels', type: 'raster', source: 'labels' },
  ],
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

/** A sensible default pivot field, centred where the user is looking. */
function defaultPivotGeometry([lng, lat]: [number, number]): FieldGeometry {
  return {
    PP_Longitude: String(lng),
    PP_Latitude: String(lat),
    Radius: '400',
    Sprayer_width: '120',
    num_female_rows: '8',
    num_male_rows: '2',
    row_spacing_in: '22',
    total_rows: '10',
    row_layout: 'centered',
    custom_row_mask: '',
    use_bays: true,
    shelter_mode: 'total',
    num_structures: '24',
    Planting_angle: '0',
    shelters_in_outside_pass: 'Yes',
    pivot_tracks: [],
    track_exclusion_ft: '10',
    pass_edge_buffer_ft: '25',
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
  const [ready, setReady] = useState(false)

  const selectedField: Field | null = useMemo(
    () => fields.find((f) => f.id === selectedId) ?? fields.find((f) => f.geometry) ?? fields[0] ?? null,
    [fields, selectedId],
  )

  // What the map draws: the live draft while editing, else the saved geometry.
  const previewGeom = useMemo(
    () => (editing && draft ? draft : selectedField?.geometry),
    [editing, draft, selectedField],
  )
  const shelters = useMemo(() => (previewGeom ? getTentPositions(previewGeom) : []), [previewGeom])

  const isPivotDraft = !!draft && !draft.boundary_polygon
  const dirty =
    editing &&
    (draftName !== (selectedField?.name ?? '') ||
      JSON.stringify(draft) !== JSON.stringify(selectedField?.geometry ?? null))

  function selectField(id: string) {
    setEditing(false)
    setDraft(null)
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
    setEditing(true)
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
      return next
    })
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
  }

  function onCancel() {
    setEditing(false)
    setDraft(null)
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
      map.addLayer({ id: 'tracks-line', type: 'line', source: 'tracks', paint: { 'line-color': TRACK, 'line-width': 1.5, 'line-opacity': 0.85 } })
      map.addSource('corner', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'corner-line', type: 'line', source: 'corner', paint: { 'line-color': TRACK, 'line-width': 2 } })

      map.addSource('shelters', { type: 'geojson', data: EMPTY })
      map.addLayer({
        id: 'shelters',
        type: 'circle',
        source: 'shelters',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 14, 5, 16, 7],
          'circle-color': BRAND,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1,
        },
      })
      map.addSource('pivot', { type: 'geojson', data: EMPTY })
      map.addLayer({
        id: 'pivot',
        type: 'circle',
        source: 'pivot',
        paint: { 'circle-radius': 5, 'circle-color': INK, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 },
      })
      setReady(true)
    })

    return () => {
      pinMarkersRef.current.forEach((m) => m.remove())
      pinMarkersRef.current = []
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
    ;(map.getSource('shelters') as GeoJSONSource | undefined)?.setData(sheltersCollection(shelters))

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
  }, [ready, previewGeom, shelters])

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
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !editing || !isPivotDraft) return
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
  }, [ready, editing, isPivotDraft])

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Shelter Maps" subtitle="Bee-shelter placement on pollination fields (MapLibre)" />
      <div
        className={`grid min-h-0 flex-1 ${
          editing ? 'md:grid-cols-[18rem_1fr_22rem]' : 'md:grid-cols-[18rem_1fr]'
        }`}
      >
        {/* Field list */}
        <aside className="overflow-y-auto border-r border-slate-200 bg-white p-3">
          <h2 className="mb-2 px-1 text-sm font-semibold text-slate-600">Fields</h2>
          {fields.map((f) => {
            const active = selectedField?.id === f.id
            return (
              <button
                key={f.id}
                onClick={() => selectField(f.id)}
                className={`mb-2 block w-full rounded-lg border p-3 text-left transition ${
                  active ? 'border-brand bg-brand-light' : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{f.name}</span>
                  <Badge tone={f.geometry ? 'brand' : 'blue'}>{f.geometry ? f.shapeType : 'no map'}</Badge>
                </div>
                <p className="mt-0.5 text-xs text-slate-500">{f.region}</p>
                <p className="mt-1 text-xs text-slate-600">
                  {f.shelterCount} shelters · {f.client}
                </p>
              </button>
            )
          })}
        </aside>

        {/* Map + detail overlay */}
        <div className="relative min-h-[20rem]">
          <div ref={containerRef} className="absolute inset-0" />
          {selectedField && !editing && (
            <div className="absolute left-3 top-3 max-w-xs rounded-xl border border-slate-200 bg-white/95 p-3 shadow-md backdrop-blur">
              <div className="font-bold text-ink">{selectedField.name}</div>
              <div className="text-xs text-slate-500">
                {selectedField.region} · {selectedField.client}
              </div>
              {selectedField.geometry ? (
                <>
                  <div className="mt-2 flex items-center gap-3 text-sm">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: BRAND }} />
                      <span className="font-semibold text-slate-900">{shelters.length}</span>
                      <span className="text-slate-500">shelters (live)</span>
                    </span>
                  </div>
                  {hasOverlays(selectedField.geometry) && (
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] capitalize text-slate-600">
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
                <p className="mt-2 text-sm text-slate-500">No field geometry imported yet.</p>
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
          <aside className="min-h-0 border-l border-slate-200 bg-white">
            <FieldEditor
              name={draftName}
              draft={draft}
              isPivot={isPivotDraft}
              count={shelters.length}
              dirty={dirty}
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
