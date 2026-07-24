import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { type StyleSpecification, type GeoJSONSource } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { circle as turfCircle, bbox as turfBbox } from '@turf/turf'
import type { Feature, FeatureCollection, Polygon, Point, Position } from 'geojson'
import { PageHeader, Badge } from '@/components/ui'
import { useData } from '@/data/context'
import type { Field, FieldGeometry } from '@/data/types'
import { getTentPositions } from '@/domain/tentGrid'

// Theme colours (tailwind.config.js) used for map features.
const BRAND = '#B8860B' // honey amber — shelter pins
const FIELD = '#4D7C0F' // canola green — field boundary
const INK = '#1A1206' // pivot centre

// Free OpenStreetMap raster basemap — no API key. For satellite imagery in
// production, swap in a MapTiler/ESRI source keyed by VITE_MAP_TILE_KEY.
const OSM_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
}

// Southern Alberta pollination country (Grassy Lake / Bow Island / Taber).
const DEFAULT_CENTER: [number, number] = [-111.6, 49.83]
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }

const num = (v: unknown): number => Number(v)

/** Field boundary as a GeoJSON polygon: the drawn polygon, or a pivot circle. */
function boundaryFeature(geom?: FieldGeometry): Feature<Polygon> | null {
  if (!geom) return null
  const poly = geom.boundary_polygon
  if (Array.isArray(poly) && poly.length >= 3) {
    const ring: Position[] = poly.map((p) => [num((p as unknown[])[1]), num((p as unknown[])[0])])
    ring.push(ring[0]) // close the ring
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

export default function MapsHome() {
  const { fields } = useData()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [ready, setReady] = useState(false)

  // Default the selection to the first field that has renderable geometry.
  const selectedField: Field | null = useMemo(
    () =>
      fields.find((f) => f.id === selectedId) ??
      fields.find((f) => f.geometry) ??
      fields[0] ??
      null,
    [fields, selectedId],
  )

  // Live shelter placement from the ported engine (memoised per field).
  const shelters = useMemo(
    () => (selectedField?.geometry ? getTentPositions(selectedField.geometry) : []),
    [selectedField],
  )

  // Create the map once; add empty sources + layers on load.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: OSM_STYLE,
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
      map.remove()
      mapRef.current = null
      setReady(false)
    }
  }, [])

  // Push the selected field's geometry to the map + fit the view to it.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return

    const boundary = boundaryFeature(selectedField?.geometry)
    const pivot = pivotFeature(selectedField?.geometry)
    const shelterFC = sheltersCollection(shelters)

    ;(map.getSource('boundary') as GeoJSONSource | undefined)?.setData(
      boundary ? { type: 'FeatureCollection', features: [boundary] } : EMPTY,
    )
    ;(map.getSource('pivot') as GeoJSONSource | undefined)?.setData(
      pivot ? { type: 'FeatureCollection', features: [pivot] } : EMPTY,
    )
    ;(map.getSource('shelters') as GeoJSONSource | undefined)?.setData(shelterFC)

    const forBounds: FeatureCollection = {
      type: 'FeatureCollection',
      features: [...(boundary ? [boundary] : []), ...shelterFC.features],
    }
    if (forBounds.features.length > 0) {
      const [minX, minY, maxX, maxY] = turfBbox(forBounds)
      map.fitBounds(
        [
          [minX, minY],
          [maxX, maxY],
        ],
        { padding: 64, duration: 700, maxZoom: 16 },
      )
    }
  }, [ready, selectedField, shelters])

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Shelter Maps" subtitle="Bee-shelter placement on pollination fields (MapLibre)" />
      <div className="grid min-h-0 flex-1 md:grid-cols-[20rem_1fr]">
        {/* Field list */}
        <aside className="overflow-y-auto border-r border-slate-200 bg-white p-3">
          <h2 className="mb-2 px-1 text-sm font-semibold text-slate-600">Fields</h2>
          {fields.map((f) => {
            const active = selectedField?.id === f.id
            return (
              <button
                key={f.id}
                onClick={() => setSelectedId(f.id)}
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
          {selectedField && (
            <div className="pointer-events-none absolute left-3 top-3 max-w-xs rounded-xl border border-slate-200 bg-white/95 p-3 shadow-md backdrop-blur">
              <div className="font-bold text-ink">{selectedField.name}</div>
              <div className="text-xs text-slate-500">
                {selectedField.region} · {selectedField.client}
              </div>
              {selectedField.geometry ? (
                <div className="mt-2 flex items-center gap-3 text-sm">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: BRAND }} />
                    <span className="font-semibold text-slate-900">{shelters.length}</span>
                    <span className="text-slate-500">shelters (live)</span>
                  </span>
                </div>
              ) : (
                <p className="mt-2 text-sm text-slate-500">
                  No field geometry imported yet — draw or import a boundary to place shelters.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
