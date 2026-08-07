import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { Download, Image as ImageIcon, Info, Upload, X } from 'lucide-react'
import { PageHeader, Select, Button, EmptyState } from '@/components/ui'
import { useData } from '@/data/context'
import { SATELLITE_STYLE } from '@/features/maps/basemap'
import {
  idwGrid,
  gridStats,
  rampColor,
  gridToCsv,
  syntheticField,
  cornersValid,
  gridExtentM,
  autoTrimM,
  insideField,
  sampleGrid,
  matchFieldByGeometry,
  fieldContainment,
  fieldOutlineRing,
  type ReturnsGrid,
  type SamplePoint,
} from '@/domain/returnsMap'
import { readSheet, guessColumns, toSamples, groupValues, type SheetTable, type ColMap } from './returnsImport'
import { beeReturnLbs, seasonsOf, blockStage, STAGE_LABEL } from '@/domain/blocks'
import { findGpsOutliers } from '@/domain/gpsOutliers'
import type { FieldDict } from '@/domain/tentGrid'

// Block markers sit on satellite imagery and inside exported PNGs, so they are
// fixed light-on-dark rather than theme-following: an exported map must read the
// same for whoever opens it, and the app's theme is not part of the data.
const MARKER_FILL = '#FFFFFF' // token-exempt: map pin over imagery
const MARKER_EDGE = '#111111' // token-exempt: map pin over imagery
// Excluded points stay on the map in red so a removal is never silent.
const MARKER_BAD = '#FF4D4F' // token-exempt: map pin over imagery
// The field's own boundary, drawn over satellite imagery in both themes.
const OUTLINE_COLOR = '#00CED1' // token-exempt: map line over imagery
// Placed but not yet weighed: visible, but plainly not part of the surface.
const MARKER_PENDING = '#FFC53D' // token-exempt: map pin over imagery

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
  /** Drop points the GPS clearly got wrong before interpolating. */
  const [cleanGps, setCleanGps] = useState(true)
  const [strictness, setStrictness] = useState(5)
  /** How far past the outermost blocks the surface keeps drawing. */
  const [looseness, setLooseness] = useState(2)

  // Imported spreadsheet (ad-hoc, never written to the database). When present
  // it REPLACES the live samples, so a past season can be checked on its own.
  const [sheet, setSheet] = useState<SheetTable | null>(null)
  const [cols, setCols] = useState<ColMap>({ lat: -1, lng: -1, value: -1, label: -1, group: -1 })
  /** Which field within the imported sheet is being mapped. */
  const [groupPick, setGroupPick] = useState<string | null>(null)
  /**
   * Which recorded field's boundary to clip imported points to. Without one,
   * the surface is drawn to the shape of the blocks themselves — the best
   * that can be done for a season predating the field boundaries.
   */
  const [clipFieldId, setClipFieldId] = useState<string>('auto')
  const [importErr, setImportErr] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const mapEl = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<maplibregl.Marker[]>([])

  useEffect(() => {
    void loadBlocks()
  }, [loadBlocks])

  const seasons = useMemo(() => seasonsOf(blockPlacements), [blockPlacements])
  const activeSeason = season ?? seasons[0] ?? new Date().getFullYear()

  /**
   * Fields with a weighed RETURN this season — a surface can be drawn for them.
   * Needs both weigh-ins, so a block that's only been placed doesn't count.
   */
  const fieldIdsWithData = useMemo(
    () =>
      new Set(
        blockPlacements
          .filter((p) => p.season === activeSeason && p.lat != null && p.lng != null && beeReturnLbs(p) != null)
          .map((p) => p.fieldId),
      ),
    [blockPlacements, activeSeason],
  )

  /**
   * Fields with blocks merely PLACED this season.
   *
   * Kept separate because the two are wildly different situations, and
   * conflating them told people with blocks in the ground that they had none.
   * Placed blocks can't colour a surface, but they can and should be seen.
   */
  const placedByField = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of blockPlacements) {
      if (p.season !== activeSeason || p.lat == null || p.lng == null || !p.fieldId) continue
      counts.set(p.fieldId, (counts.get(p.fieldId) ?? 0) + 1)
    }
    return counts
  }, [blockPlacements, activeSeason])

  /** Blocks in this field awaiting a weight — drawn, but not part of the surface. */
  const awaitingWeights = useMemo(
    () =>
      blockPlacements
        .filter(
          (p) =>
            p.fieldId === fieldId &&
            p.season === activeSeason &&
            p.lat != null &&
            p.lng != null &&
            beeReturnLbs(p) == null,
        )
        .map((p) => ({
          lat: p.lat!,
          lng: p.lng!,
          label: blocks.find((b) => b.id === p.blockId)?.label,
          stage: blockStage(p),
        })),
    [blockPlacements, blocks, fieldId, activeSeason],
  )

  /**
   * EVERY field is offered, not only those with blocks. A field with no blocks
   * yet still draws its boundary, which is what you want when setting a season
   * up — seeing the ground before anything has been placed on it.
   */
  const selectableFields = useMemo(
    () =>
      [...fields].sort((a, b) => {
        // Fields with data first, then alphabetically.
        const ad = fieldIdsWithData.has(a.id) ? 0 : 1
        const bd = fieldIdsWithData.has(b.id) ? 0 : 1
        return ad - bd || a.name.localeCompare(b.name)
      }),
    [fields, fieldIdsWithData],
  )

  useEffect(() => {
    if (!fieldId && selectableFields.length) setFieldId(selectableFields[0].id)
  }, [selectableFields, fieldId])

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

  const groups = useMemo(() => (sheet ? groupValues(sheet, cols.group) : []), [sheet, cols.group])
  const imported = useMemo(
    () => (sheet ? toSamples(sheet, cols, groupPick) : null),
    [sheet, cols, groupPick],
  )
  const raw = imported ? imported.samples : samples

  // Bad fixes are excluded BEFORE interpolating: on an IDW surface a single
  // stray point doesn't just misplace itself, it colours the empty space
  // around it, so cleaning afterwards would be too late.
  const cleaned = useMemo(() => {
    if (!cleanGps) return null
    // Use the real field's boundary when we have one — it's definitive.
    const geom = imported ? null : ((field?.geometry as FieldDict | undefined) ?? null)
    return findGpsOutliers(raw, geom, { madK: strictness })
  }, [raw, cleanGps, imported, field, strictness])

  const active = cleaned ? cleaned.keep : raw

  /**
   * Which known field these points sit in, matched by geometry. Imported field
   * NAMES rarely match the app's, but coordinates either fall inside a
   * boundary or they don't.
   */
  const autoMatch = useMemo(
    () => matchFieldByGeometry(fields, active),
    [fields, active],
  )
  /** Share of the points each field contains — drives what's worth offering. */
  const containment = useMemo(() => fieldContainment(fields, active), [fields, active])
  const effectiveClipId = clipFieldId === 'auto' ? (autoMatch?.fieldId ?? '') : clipFieldId
  /** A chosen field that holds almost none of the points is a mis-click. */
  const chosenShare = effectiveClipId ? (containment.get(effectiveClipId) ?? 0) : null

  /**
   * The selected field's recorded boundary, as a ring to draw. Independent of
   * the surface: a field with no blocks still has an outline worth seeing.
   */
  const outline = useMemo(() => {
    const clipField = effectiveClipId ? fields.find((f) => f.id === effectiveClipId) : null
    const geom = (clipField?.geometry ?? field?.geometry) as FieldDict | undefined
    return geom ? fieldOutlineRing(geom) : null
  }, [fields, effectiveClipId, field])

  const grid: ReturnsGrid | null = useMemo(() => {
    if (active.length === 0) return null

    // The field's RECORDED boundary is the outline — the same geometry that
    // drives shelter placement. From 2026 every field has one, so this is the
    // normal path rather than a special case.
    //
    // Historical imports predate those boundaries, so they fall back to a
    // bounding box masked back to the blocks (see clipDistanceM). Shapes were
    // once fitted to the blocks, and outlines detected from satellite imagery,
    // for that case; both were removed as more trouble than they were worth.
    const clipField = effectiveClipId ? fields.find((f) => f.id === effectiveClipId) : null
    const geom =
      (clipField?.geometry as Record<string, unknown> | undefined) ??
      (imported ? syntheticField(active) : (field?.geometry as Record<string, unknown> | undefined))
    if (!geom) return null

    // A recorded outline IS the edge, so don't also trim back to the blocks.
    // Only the bounding-box fallback needs the point-cloud mask.
    // clipDistanceM only MASKS the edge; it must not limit which blocks a cell
    // averages, or every block gets its own flat disc instead of a surface.
    const clipDistanceM = clipField?.geometry ? null : looseness > 0 ? autoTrimM(active, looseness) : null
    return idwGrid(geom, active, { cellM, power, clipDistanceM })
  }, [field, fields, effectiveClipId, active, imported, cellM, power, looseness])

  const stats = useMemo(() => (grid ? gridStats(grid) : null), [grid])

  /**
   * A field is hundreds of metres across. Kilometres means the selection still
   * spans several fields, or a row carries a bad coordinate.
   */
  const extentWarning = useMemo(() => {
    if (!grid) return null
    if (!cornersValid(grid.corners)) {
      return 'These points are too far apart to map — they span more of the globe than a field can. Almost always a bad coordinate in one row, or several fields selected at once.'
    }
    const { widthM, heightM } = gridExtentM(grid)
    const km = Math.max(widthM, heightM) / 1000
    if (km > 25) {
      return `The selected points cover about ${km.toFixed(0)} km. That's far larger than one field — check the Field column, or look for a row with a bad coordinate.`
    }
    return null
  }, [grid])

  // Default to the first field in the sheet rather than mapping all of them at
  // once: points spread across several fields produce one vast extent with the
  // real surfaces too small to see.
  useEffect(() => {
    if (groups.length && (groupPick == null || !groups.some((g) => g.value === groupPick))) {
      setGroupPick(groups[0].value)
    }
  }, [groups, groupPick])

  async function onPickFile(file: File) {
    setImportErr(null)
    try {
      const t = await readSheet(file)
      if (!t.headers.length) throw new Error('That file has no rows.')
      setSheet(t)
      setCols(guessColumns(t.headers))
      setGroupPick(null)
    } catch (e) {
      setImportErr(e instanceof Error ? e.message : 'Could not read that file.')
    }
  }

  /**
   * Paint the surface.
   *
   * Rendered at a HIGHER resolution than the interpolation grid, testing the
   * field boundary per output pixel. One pixel per cell would draw the
   * boundary at the interpolation resolution, which makes a pivot's circle
   * visibly stair-stepped; per-pixel gives a true circle and true straight
   * edges regardless of how coarse the grid is.
   *
   * The edge is also anti-aliased by supersampling: each pixel takes several
   * sub-samples and its opacity is the fraction that landed inside the field,
   * so the rim is smooth rather than jagged.
   */
  /** Whether any cell touching this position is inside the field's extent. */
  const maskedNear = (g: ReturnsGrid, e: number, n: number): boolean => {
    const fx = (e - g.originE) / g.cellM - 0.5
    const fy = (g.originN - n) / g.cellM - 0.5
    const x0 = Math.floor(fx)
    const y0 = Math.floor(fy)
    // A 3x3 sweep, not the 2x2 the value sampler uses. This is a safety net
    // against a wrong outline, NOT the boundary itself — checking only the
    // immediate cells clipped pixels that the per-pixel boundary had rightly
    // included, and put the stair-steps back on an otherwise clean circle.
    for (let dy = -1; dy <= 2; dy++) {
      for (let dx = -1; dx <= 2; dx++) {
        const x = x0 + dx
        const y = y0 + dy
        if (x < 0 || y < 0 || x >= g.cols || y >= g.rows) continue
        if (g.mask[y * g.cols + x]) return true
      }
    }
    return false
  }

  const renderCanvas = (g: ReturnsGrid): HTMLCanvasElement => {
    // Cap the texture so a big field can't produce an enormous canvas.
    const target = Math.min(2048, Math.max(g.cols, g.rows) * 4)
    const scale = Math.max(1, Math.round(target / Math.max(g.cols, g.rows)))
    const W = g.cols * scale
    const H = g.rows * scale

    const cv = document.createElement('canvas')
    cv.width = W
    cv.height = H
    const ctx = cv.getContext('2d')!
    const img = ctx.createImageData(W, H)
    const span = g.max - g.min || 1

    // 2x2 sub-samples per pixel: enough to smooth the rim, cheap enough to
    // stay instant while dragging the controls.
    const SUB = [0.25, 0.75]
    const pxM = g.cellM / scale

    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        let hits = 0
        let sum = 0
        let samples = 0
        for (const sy of SUB) {
          for (const sx of SUB) {
            const e = g.originE + (px + sx) * pxM
            const n = g.originN - (py + sy) * pxM
            // Boundary decided per pixel; values exist just past the edge so
            // this line can be sharp rather than following the cell grid.
            if (!insideField(g.frame, e, n)) continue
            // AND inside the grid's own mask. Belt and braces: the mask is the
            // authoritative extent, so a bad frame can never paint the whole
            // bounding box the way a mis-set outline once did.
            if (!maskedNear(g, e, n)) continue
            hits++
            const v = sampleGrid(g, e, n)
            if (Number.isFinite(v)) {
              sum += v
              samples++
            }
          }
        }
        const o = (py * W + px) * 4
        if (hits === 0 || samples === 0) {
          img.data[o + 3] = 0 // outside the field, or no data here
          continue
        }
        const [r, gg, b] = rampColor((sum / samples - g.min) / span)
        img.data[o] = r
        img.data[o + 1] = gg
        img.data[o + 2] = b
        // Coverage-weighted alpha smooths the boundary; 200 lets a little
        // satellite through, as QGIS exports do.
        img.data[o + 3] = Math.round(200 * (hits / (SUB.length * SUB.length)))
      }
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
      if (map.getLayer('field-outline')) map.removeLayer('field-outline')
      if (map.getSource('field-outline')) map.removeSource('field-outline')
      for (const m of markersRef.current) m.remove()
      markersRef.current = []

      // The field's own boundary, drawn whether or not there's a surface yet.
      // Before any blocks exist this is the whole point of the screen: see the
      // ground you're about to work.
      if (outline) {
        map.addSource('field-outline', {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: outline },
          },
        })
        map.addLayer({
          id: 'field-outline',
          type: 'line',
          source: 'field-outline',
          paint: { 'line-color': OUTLINE_COLOR, 'line-width': 2, 'line-dasharray': [3, 2] },
        })
      }

      // Blocks placed but not yet weighed, in amber. They can't colour the
      // surface — a return needs both weigh-ins — but they ARE in the ground,
      // and saying nothing about them read as "you have no blocks".
      if (showPoints && !imported) {
        for (const p of awaitingWeights) {
          const el = document.createElement('div')
          el.style.cssText =
            `width:10px;height:10px;border-radius:9999px;background:${MARKER_PENDING};` +
            `border:2px solid ${MARKER_EDGE};box-shadow:0 1px 3px rgba(0,0,0,.6)`
          el.title = `${p.label ?? 'Block'} — ${STAGE_LABEL[p.stage]}, awaiting weights`
          markersRef.current.push(new maplibregl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(map))
        }
      }

      if (!grid) {
        // No surface, but frame the field so it's actually on screen.
        if (outline) {
          map.resize()
          const b = new maplibregl.LngLatBounds()
          for (const c of outline) b.extend(c as [number, number])
          map.fitBounds(b, { padding: 40, duration: 400 })
        }
        return
      }

      // Never hand MapLibre a coordinate it will throw on: one bad row used to
      // crash the entire view with "Invalid LngLat latitude value".
      if (!cornersValid(grid.corners)) {
        console.error('[returns] refusing to draw, corners out of range:', grid.corners)
        return
      }

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
        for (const f of cleaned?.removed ?? []) {
          const el = document.createElement('div')
          el.style.cssText =
            `width:10px;height:10px;border-radius:9999px;background:${MARKER_BAD};` +
            `border:2px solid ${MARKER_EDGE};box-shadow:0 1px 3px rgba(0,0,0,.6);opacity:.85`
          el.title = `Excluded — ${f.sample.label ?? 'block'}, ${Math.round(f.distM)} m away (${f.reason})`
          markersRef.current.push(
            new maplibregl.Marker({ element: el }).setLngLat([f.sample.lng, f.sample.lat]).addTo(map),
          )
        }
        for (const s of active) {
          const el = document.createElement('div')
          el.style.cssText =
            `width:10px;height:10px;border-radius:9999px;background:${MARKER_FILL};` +
            `border:2px solid ${MARKER_EDGE};box-shadow:0 1px 3px rgba(0,0,0,.6)`
          el.title = `${s.label ?? 'Block'}: ${s.value.toFixed(1)} lbs`
          markersRef.current.push(new maplibregl.Marker({ element: el }).setLngLat([s.lng, s.lat]).addTo(map))
        }
      }

      // The container is hidden until there's something to draw, so the canvas
      // was sized to zero when the map was created. Without this it stays blank.
      map.resize()

      // Frame the field.
      const b = new maplibregl.LngLatBounds()
      for (const c of grid.corners) b.extend(c as [number, number])
      map.fitBounds(b, { padding: 40, duration: 400 })
    }

    if (map.isStyleLoaded()) apply()
    else map.once('load', apply)
  }, [grid, outline, active, cleaned, showPoints, awaitingWeights, imported])

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
        <div className="grid gap-2 md:grid-cols-5">
          <Select value={activeSeason} onChange={(e) => setSeason(Number(e.target.value))}>
            {(seasons.length ? seasons : [activeSeason]).map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
          <Select value={fieldId} onChange={(e) => setFieldId(e.target.value)}>
            <option value="">Select a field…</option>
            {selectableFields.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
                {fieldIdsWithData.has(f.id)
                  ? ''
                  : placedByField.has(f.id)
                    ? ` — ${placedByField.get(f.id)} placed, not weighed`
                    : f.geometry
                      ? ' — no blocks yet'
                      : ' — no boundary'}
              </option>
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
            Edge
            <Select value={looseness} onChange={(e) => setLooseness(Number(e.target.value))} className="flex-1">
              <option value={1}>Tight</option>
              <option value={2}>Normal</option>
              <option value={3.5}>Loose</option>
              <option value={0}>Fill field</option>
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

        {/* Ad-hoc spreadsheet import — nothing here touches the database. */}
        <div className="card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="font-semibold text-primary">Test with a spreadsheet</div>
              <p className="text-xs text-muted">
                Load past block weights (.csv or .xlsx) to check the map against a result you already trust. Nothing
                is saved — it only affects what's drawn here.
              </p>
            </div>
            <div className="flex gap-2">
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void onPickFile(f)
                  e.target.value = ''
                }}
              />
              <Button variant="ghost" onClick={() => fileRef.current?.click()}>
                <Upload size={16} className="mr-1 inline" />
                Load file
              </Button>
              {sheet && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setSheet(null)
                    setImportErr(null)
                    setGroupPick(null)
                  }}
                >
                  <X size={16} className="mr-1 inline" />
                  Clear
                </Button>
              )}
            </div>
          </div>

          {importErr && <p className="mt-2 text-sm text-danger">{importErr}</p>}

          {sheet && (
            <div className="mt-3 space-y-2 border-t border-default pt-3">
              {/* What the reader actually saw. A single column here means the
                  separator was misread, which is otherwise invisible. */}
              <p className="text-xs text-faint">
                Read <span className="font-semibold text-muted">{sheet.sourceRows ?? sheet.rows.length}</span> rows ×{' '}
                <span className="font-semibold text-muted">{sheet.headers.length}</span> columns
                {sheet.delimiter
                  ? ` (separator: ${sheet.delimiter === '\t' ? 'tab' : sheet.delimiter === ',' ? 'comma' : sheet.delimiter})`
                  : ''}
                . Columns: {sheet.headers.slice(0, 12).join(' · ') || '(none)'}
                {sheet.headers.length > 12 ? ' …' : ''}
              </p>
              {sheet.headers.length === 1 && (
                <p className="text-xs text-danger">
                  Only one column was found — the file's separator wasn't recognised. Re-saving it as a standard CSV,
                  or as .xlsx, should fix it.
                </p>
              )}
              <p className="text-xs text-muted">
                Which column is which? Guessed from the headers — correct anything that's wrong.
              </p>
              <div className="grid gap-2 md:grid-cols-5">
                {(
                  [
                    ['lat', 'Latitude'],
                    ['lng', 'Longitude'],
                    ['value', 'Bee return (lbs)'],
                    ['label', 'Block label'],
                    ['group', 'Field'],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="text-xs text-muted">
                    {label}
                    <Select
                      value={cols[key]}
                      onChange={(e) => setCols((c) => ({ ...c, [key]: Number(e.target.value) }))}
                    >
                      <option value={-1}>— none —</option>
                      {sheet.headers.map((h, i) => (
                        <option key={i} value={i}>{h || `Column ${i + 1}`}</option>
                      ))}
                    </Select>
                  </label>
                ))}
              </div>
              {groups.length > 0 && (
                <label className="block text-xs text-muted">
                  Field to map ({groups.length} in this file)
                  <Select value={groupPick ?? ''} onChange={(e) => setGroupPick(e.target.value)}>
                    {groups.map((g) => (
                      <option key={g.value} value={g.value}>
                        {g.value} ({g.rows} rows)
                      </option>
                    ))}
                  </Select>
                </label>
              )}

              <label className="block text-xs text-muted">
                Field outline
                <Select value={clipFieldId} onChange={(e) => setClipFieldId(e.target.value)}>
                  <option value="auto">
                    {autoMatch
                      ? `Automatic — ${fields.find((f) => f.id === autoMatch.fieldId)?.name ?? 'matched field'}`
                      : 'Automatic — no matching field found'}
                  </option>
                  <option value="">Use the shape of the points</option>
                  {fields
                    // Only fields that actually hold some of these points.
                    // A boundary elsewhere can only ever produce a wrong map.
                    .filter((f) => f.geometry && ((containment.get(f.id) ?? 0) > 0.05 || f.id === clipFieldId))
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name} ({Math.round((containment.get(f.id) ?? 0) * 100)}% of points)
                      </option>
                    ))}
                </Select>
                <span className="mt-1 block text-faint">
                  {autoMatch && clipFieldId === 'auto'
                    ? `${Math.round(autoMatch.fraction * 100)}% of these points fall inside it — using its recorded boundary.`
                    : effectiveClipId
                      ? chosenShare != null && chosenShare < 0.5
                        ? `Warning: only ${Math.round(chosenShare * 100)}% of these points are inside that field, so the outline won't match the data. Switch back to Automatic.`
                        : 'Clipped to that field’s recorded boundary.'
                      : 'No matching field on record, so the surface is drawn to the shape of the blocks themselves. Fields recorded in the app get their real boundary.'}
                </span>
              </label>

              {sheet && cols.group < 0 && (
                <p className="text-xs text-muted">
                  No field column picked — every point in the file is being mapped as one surface. If the sheet covers
                  more than one field, choose its field column above.
                </p>
              )}

              {imported && (
                <p className="text-xs">
                  <span className="font-semibold text-primary">{imported.samples.length}</span> point
                  {imported.samples.length === 1 ? '' : 's'} loaded
                  {imported.skipped > 0 && (
                    <span className="text-danger"> · {imported.skipped} skipped ({imported.reasons.join('; ')})</span>
                  )}
                </p>
              )}
            </div>
          )}
        </div>

        {extentWarning && (
          <div className="card border-danger">
            <p className="text-sm text-danger">{extentWarning}</p>
          </div>
        )}

        {!grid && (
          <EmptyState>
            {sheet
              ? 'No usable rows in that file yet — check the column choices above.'
              : samples.length === 0
                ? awaitingWeights.length > 0
                  ? `${awaitingWeights.length} block${awaitingWeights.length === 1 ? '' : 's'} placed in ${field?.name ?? 'this field'}, shown in amber. The surface fills in once they're weighed full and empty — a return needs both.`
                  : outline
                  ? `${field?.name ?? 'This field'} has no blocks for ${activeSeason} yet, so its boundary is shown on its own. Place blocks, then weigh them full and empty, and the surface fills in.`
                  : 'No weighed blocks with a location for this field and season yet. Place blocks, then weigh them full and empty — the map builds itself from that. Or load a spreadsheet above to test.'
                : 'This field has no boundary or pivot set, so there’s nothing to interpolate across. Add its geometry on the Shelter Maps tab.'}
          </EmptyState>
        )}

        <div className={`overflow-hidden rounded-lg border border-default ${grid || outline ? '' : 'hidden'}`}>
          <div ref={mapEl} className="h-[60vh] w-full" />
        </div>

        {grid && stats && (
          <>
            {/* GPS cleaning — stated plainly, never silent. */}
            <div className="card">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <label className="flex items-center gap-2 font-semibold text-primary">
                    <input
                      type="checkbox"
                      checked={cleanGps}
                      onChange={(e) => setCleanGps(e.target.checked)}
                    />
                    Ignore bad GPS fixes
                  </label>
                  <p className="mt-1 text-xs text-muted">
                    {cleaned && cleaned.removed.length > 0 ? (
                      <>
                        <span className="font-semibold text-danger">{cleaned.removed.length}</span> point
                        {cleaned.removed.length === 1 ? '' : 's'} excluded, shown in red. Furthest{' '}
                        {Math.round(Math.max(...cleaned.removed.map((r) => r.distM)))} m from the others.
                      </>
                    ) : cleanGps ? (
                      'No obviously bad fixes found — every point is being used.'
                    ) : (
                      'Every point is being used, including any bad fixes.'
                    )}
                  </p>
                </div>
                {cleanGps && (
                  <label className="flex items-center gap-2 text-xs text-muted">
                    Sensitivity
                    <Select
                      value={strictness}
                      onChange={(e) => setStrictness(Number(e.target.value))}
                      className="w-32"
                    >
                      <option value={8}>Lenient</option>
                      <option value={5}>Normal</option>
                      <option value={3}>Strict</option>
                    </Select>
                  </label>
                )}
              </div>

              {cleaned && cleaned.removed.length > 0 && (
                <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto border-t border-default pt-2 text-xs">
                  {cleaned.removed.slice(0, 25).map((f, i) => (
                    <li key={i} className="flex justify-between gap-2 text-muted">
                      <span>{f.sample.label ?? `Point ${i + 1}`}</span>
                      <span>
                        {Math.round(f.distM)} m ·{' '}
                        {f.reason === 'outside-boundary'
                          ? 'outside the field'
                          : f.reason === 'beyond-hard-limit'
                            ? 'impossibly far'
                            : 'far from the others'}
                      </span>
                    </li>
                  ))}
                  {cleaned.removed.length > 25 && (
                    <li className="text-faint">…and {cleaned.removed.length - 25} more</li>
                  )}
                </ul>
              )}
            </div>

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
                <div className="text-lg font-bold">{active.length}</div>
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
              Interpolated by inverse distance weighting from {active.length} weighed block
              {active.length === 1 ? '' : 's'}, clipped to the field boundary. Colour between blocks is an estimate,
              not a measurement — with few blocks it shows broad trends rather than detail.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
