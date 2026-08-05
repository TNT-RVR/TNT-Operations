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
  type ReturnsGrid,
  type SamplePoint,
} from '@/domain/returnsMap'
import { readSheet, guessColumns, toSamples, groupValues, type SheetTable, type ColMap } from './returnsImport'
import { beeReturnLbs, seasonsOf } from '@/domain/blocks'
import { findGpsOutliers } from '@/domain/gpsOutliers'
import type { FieldDict } from '@/domain/tentGrid'

// Block markers sit on satellite imagery and inside exported PNGs, so they are
// fixed light-on-dark rather than theme-following: an exported map must read the
// same for whoever opens it, and the app's theme is not part of the data.
const MARKER_FILL = '#FFFFFF' // token-exempt: map pin over imagery
const MARKER_EDGE = '#111111' // token-exempt: map pin over imagery
// Excluded points stay on the map in red so a removal is never silent.
const MARKER_BAD = '#FF4D4F' // token-exempt: map pin over imagery

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

  // Imported spreadsheet (ad-hoc, never written to the database). When present
  // it REPLACES the live samples, so a past season can be checked on its own.
  const [sheet, setSheet] = useState<SheetTable | null>(null)
  const [cols, setCols] = useState<ColMap>({ lat: -1, lng: -1, value: -1, label: -1, group: -1 })
  /** Which field within the imported sheet is being mapped. */
  const [groupPick, setGroupPick] = useState<string | null>(null)
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

  const grid: ReturnsGrid | null = useMemo(() => {
    if (active.length === 0) return null
    // Imported points rarely sit inside a field we hold geometry for, so they
    // get an extent built around themselves instead of being clipped to none.
    const geom = imported
      ? syntheticField(active)
      : (field?.geometry as Record<string, unknown> | undefined)
    if (!geom) return null
    return idwGrid(geom, active, { cellM, power })
  }, [field, active, imported, cellM, power])

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
  }, [grid, active, cleaned, showPoints])

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
                ? 'No weighed blocks with a location for this field and season yet. Place blocks, then weigh them full and empty — the map builds itself from that. Or load a spreadsheet above to test.'
                : 'This field has no boundary or pivot set, so there’s nothing to interpolate across. Add its geometry on the Shelter Maps tab.'}
          </EmptyState>
        )}

        <div className={`overflow-hidden rounded-lg border border-default ${grid ? '' : 'hidden'}`}>
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
