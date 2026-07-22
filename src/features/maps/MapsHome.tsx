import { useEffect, useRef } from 'react'
import maplibregl, { type StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { PageHeader, Badge } from '@/components/ui'
import { useData } from '@/data/context'

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

export default function MapsHome() {
  const { fields } = useData()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    mapRef.current = new maplibregl.Map({
      container: containerRef.current,
      style: OSM_STYLE,
      center: DEFAULT_CENTER,
      zoom: 9,
      attributionControl: { compact: true },
    })
    mapRef.current.addControl(new maplibregl.NavigationControl(), 'top-right')
    return () => {
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [])

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Shelter Maps" subtitle="Bee-shelter placement on pollination fields (MapLibre)" />
      <div className="grid min-h-0 flex-1 md:grid-cols-[20rem_1fr]">
        {/* Field list */}
        <aside className="overflow-y-auto border-r border-slate-200 bg-white p-3">
          <h2 className="mb-2 px-1 text-sm font-semibold text-slate-600">Fields</h2>
          {fields.map((f) => (
            <div key={f.id} className="mb-2 rounded-lg border border-slate-200 p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium">{f.name}</span>
                <Badge tone="brand">{f.shapeType}</Badge>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">{f.region}</p>
              <p className="mt-1 text-xs text-slate-600">
                {f.shelterCount} shelters · {f.client}
              </p>
            </div>
          ))}
        </aside>

        {/* Map */}
        <div ref={containerRef} className="min-h-[20rem] w-full" />
      </div>
    </div>
  )
}
