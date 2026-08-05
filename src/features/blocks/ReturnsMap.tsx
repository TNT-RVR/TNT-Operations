import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { Download, Image as ImageIcon, Info } from 'lucide-react'
import { PageHeader, Select, Button, EmptyState } from '@/components/ui'
import { useData } from '@/data/context'
import { SATELLITE_STYLE } from '@/features/maps/basemap'
import {
  idwGrid,
  gridStats,
  rampColor,
  gridToCsv,
  type ReturnsGrid,
  type SamplePoint,
} from '@/domain/returnsMap'
import { beeReturnLbs, seasonsOf } from '@/domain/blocks'

// Block markers sit on satellite imagery and inside exported PNGs, so they are
// fixed light-on-dark rather than theme-following: an exported map must read the
// same for whoever opens it, and the app's theme is not part of the data.
const MARKER_FILL = '#FFFFFF' // token-exempt: map pin over imagery
const MARKER_EDGE = '#111111' // token-exempt: map pin over imagery

/**
 * Interpolated bee-return map — the job that used to mean exporting points,
 * running IDW in QGIS, styling it, and exporting an image.
 *
 * The surface is painted to an offscreen canvas and handed to MapLibre as an
 * image source pinned to the field's corners. That keeps it a real map layer
 * (pan, zoom, satellite underneath) while being a single texture rather than
 * thousands of polygons.
 */
export default function ReturnsMap() {
  const { fields, blocks, blockPlacements, loadBlocks } = useData()
  const [fieldId, setFieldId] = useState('')
  const [season, setSeason] = useState<number | null>(null)
  const [cellM, setCellM] = useState(10)
  const [power, setPower] = useState(2)
  const [showPoints, setShowPoints] = useState(true)

  const mapEl = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<maplibregl.Marker[]>([])

  useEffect(() => {
    void loadBlocks()
  }, [loadBlocks])

  const seasons = useMemo(() => seasonsOf(blockPlacements), [blockPlacements])
  const activeSeason = season ?? seasons[0] ?? new Date().getFullYear()

  // Fields that actually have weighed blocks this season — no point offering
  // a field the map would render empty for.
  const fieldsWithData = useMemo(() => {
    const ids = new Set(
      blockPlacements
        .filter((p) => p.season === activeSeason && p.lat != null && p.lng != null && beeReturnLbs(p) != null)
        .map((p) => p.fieldId),
    )
    return fields.filter((f) => ids.has(f.id))
  }, [fields, blockPlacements, activeSeason])

  useEffect(() => {
    if (!fieldId && fieldsWithData.length) setFieldId(fieldsWithData[0].id)
  }, [fieldsWithData, fieldId])

  const field = fields.find((f) => f.id === fieldId)

  const samples: SamplePoint[] = useMemo(() => {
    return blockPlacements
      .filter((p) => p.fieldId === fieldId && p.season === activeSeason && p.lat != null && p.lng != null)
      .map((p) => ({ p, value: beeReturnLbs(p) }))
      .filter((x): x is { p: (typeof blockPlacements)[number]; value: number } => x.value != null)
      .map(({ p, value }) => ({
        lat: p.lat!,
        lng: p.lng!,
        value,
        label: blocks.find((b) => b.id === p.blockId)?.label,
      }))
  }, [blockPlacements, blocks, fieldId, activeSeason])

  const grid: ReturnsGrid | null = useMemo(() => {
    if (!field?.geometry || samples.length === 0) return null
    return idwGrid(field.geometry as Record<string, unknown>, samples, { cellM, power })
  }, [field, samples, cellM, power])

  const stats = useMemo(() => (grid ? gridStats(grid) : null), [grid])

  /** Paint the grid to a canvas: one pixel per cell, transparent where empty. */
  const renderCanvas = (g: ReturnsGrid): HTMLCanvasElement => {
    const cv = document.createElement('canvas')
    cv.width = g.cols
    cv.height = g.rows
    const ctx = cv.getContext('2d')!
    const img = ctx.createImageData(g.cols, g.rows)
    const span = g.max - g.min || 1
    for (let i = 0; i < g.values.length; i++) {
      const v = g.values[i]
      const o = i * 4
      if (!Number.isFinite(v)) {
        img.data[o + 3] = 0 // outside the field — fully transparent
        continue
      }
      const [r, gg, b] = rampColor((v - g.min) / span)
      img.data[o] = r
      img.data[o + 1] = gg
      img.data[o + 2] = b
      img.data[o + 3] = 200 // let a little satellite through, as QGIS exports do
    }
    ctx.putImageData(img, 0, 0)
    return cv
  }

  // Build the map once.
  useEffect(() => {
    if (!mapEl.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: mapEl.current,
      style: SATELLITE_STYLE,
      center: [-111.6, 49.83],
      zoom: 12,
      // Needed for toDataURL to work on the WebGL canvas when exporting a PNG.
      preserveDrawingBuffer: true,
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Repaint whenever the surface changes.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const apply = () => {
      // Clear the previous surface and points.
      if (map.getLayer('returns')) map.removeLayer('returns')
      if (map.getSource('returns')) map.removeSource('returns')
      for (const m of markersRef.current) m.remove()
      markersRef.current = []
      if (!grid) return

      map.addSource('returns', {
        type: 'image',
        url: renderCanvas(grid).toDataURL(),
        // idwGrid always returns exactly four corners (NW, NE, SE, SW); the
        // tuple assertion just tells TypeScript what the shape guarantees.
        coordinates: grid.corners as [
          [number, number],
          [number, number],
          [number, number],
          [number, number],
        ],
      })
      map.addLayer({ id: 'returns', type: 'raster', source: 'returns', paint: { 'raster-opacity': 1 } })

      if (showPoints) {
        for (const s of samples) {
          const el = document.createElement('div')
          el.style.cssText =
            `width:10px;height:10px;border-radius:9999px;background:${MARKER_FILL};` +
            `border:2px solid ${MARKER_EDGE};box-shadow:0 1px 3px rgba(0,0,0,.6)`
          el.title = `${s.label ?? 'Block'}: ${s.value.toFixed(1)} lbs`
          markersRef.current.push(new maplibregl.Marker({ element: el }).setLngLat([s.lng, s.lat]).addTo(map))
        }
      }

      // Frame the field.
      const b = new maplibregl.LngLatBounds()
      for (const c of grid.corners) b.extend(c as [number, number])
      map.fitBounds(b, { padding: 40, duration: 400 })
    }

    if (map.isStyleLoaded()) apply()
    else map.once('load', apply)
  }, [grid, samples, showPoints])

  function exportPng() {
    const map = mapRef.current
    if (!map) return
    // Force a synchronous repaint so the WebGL buffer is current.
    map.triggerRepaint()
    requestAnimationFrame(() => {
      const url = map.getCanvas().toDataURL('image/png')
      const a = document.createElement('a')
      a.href = url
      a.download = `returns-${field?.name ?? 'field'}-${activeSeason}.png`.replace(/\s+/g, '-')
      a.click()
    })
  }

  function exportCsv() {
    if (!grid) return
    const url = URL.createObjectURL(new Blob([gridToCsv(grid)], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `returns-grid-${field?.name ?? 'field'}-${activeSeason}.csv`.replace(/\s+/g, '-')
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <PageHeader
        title="Returns map"
        subtitle="Bee returns interpolated across the field, from the blocks you weighed"
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={exportPng} disabled={!grid}>
              <ImageIcon size={16} className="mr-1 inline" />
              PNG
            </Button>
            <Button variant="ghost" onClick={exportCsv} disabled={!grid}>
              <Download size={16} className="mr-1 inline" />
              Grid CSV
            </Button>
          </div>
        }
      />

      <div className="space-y-3 p-4 md:p-6">
        <div className="grid gap-2 md:grid-cols-4">
          <Select value={activeSeason} onChange={(e) => setSeason(Number(e.target.value))}>
            {(seasons.length ? seasons : [activeSeason]).map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
          <Select value={fieldId} onChange={(e) => setFieldId(e.target.value)}>
            <option value="">Select a field…</option>
            {fieldsWithData.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </Select>
          <label className="flex items-center gap-2 text-sm text-muted">
            Detail
            <Select value={cellM} onChange={(e) => setCellM(Number(e.target.value))} className="flex-1">
              <option value={5}>Fine (5 m)</option>
              <option value={10}>Normal (10 m)</option>
              <option value={25}>Coarse (25 m)</option>
            </Select>
          </label>
          <label className="flex items-center gap-2 text-sm text-muted">
            Smoothing
            <Select value={power} onChange={(e) => setPower(Number(e.target.value))} className="flex-1">
              <option value={1}>Smooth</option>
              <option value={2}>Normal</option>
              <option value={4}>Sharp</option>
            </Select>
          </label>
        </div>

        {!grid && (
          <EmptyState>
            {samples.length === 0
              ? 'No weighed blocks with a location for this field and season yet. Place blocks, then weigh them full and empty — the map builds itself from that.'
              : 'This field has no boundary or pivot set, so there’s nothing to interpolate across. Add its geometry on the Shelter Maps tab.'}
          </EmptyState>
        )}

        <div className={`overflow-hidden rounded-lg border border-default ${grid ? '' : 'hidden'}`}>
          <div ref={mapEl} className="h-[60vh] w-full" />
        </div>

        {grid && stats && (
          <>
            {/* Legend */}
            <div className="card">
              <div className="mb-2 flex items-baseline justify-between text-sm">
                <span className="font-semibold">Bee return (lbs per block)</span>
                <label className="flex items-center gap-2 text-xs text-muted">
                  <input type="checkbox" checked={showPoints} onChange={(e) => setShowPoints(e.target.checked)} />
                  Show block locations
                </label>
              </div>
              <div
                className="h-4 w-full rounded"
                style={{
                  background: `linear-gradient(to right, ${[0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1]
                    .map((t) => {
                      const [r, g, b] = rampColor(t)
                      return `rgb(${r},${g},${b})`
                    })
                    .join(',')})`,
                }}
              />
              <div className="mt-1 flex justify-between text-xs text-muted">
                <span>{stats.min.toFixed(1)} lbs</span>
                <span>{stats.max.toFixed(1)} lbs</span>
              </div>
            </div>

            <div className="card grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
              <div>
                <div className="text-muted">Blocks used</div>
                <div className="text-lg font-bold">{samples.length}</div>
              </div>
              <div>
                <div className="text-muted">Field average</div>
                <div className="text-lg font-bold">{stats.mean.toFixed(1)} lbs</div>
              </div>
              <div>
                <div className="text-muted">Range</div>
                <div className="text-lg font-bold">
                  {stats.min.toFixed(1)}–{stats.max.toFixed(1)}
                </div>
              </div>
              <div>
                <div className="text-muted">Area mapped</div>
                <div className="text-lg font-bold">{stats.acres.toFixed(0)} ac</div>
              </div>
            </div>

            <p className="flex items-start gap-2 text-xs text-faint">
              <Info size={14} className="mt-0.5 shrink-0" />
              Interpolated by inverse distance weighting from {samples.length} weighed block
              {samples.length === 1 ? '' : 's'}, clipped to the field boundary. Colour between blocks is an estimate,
              not a measurement — with few blocks it shows broad trends rather than detail.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
