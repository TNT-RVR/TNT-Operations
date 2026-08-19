/**
 * Season data on the map — every field-season we have coordinates for, sized by
 * acres and coloured by a chosen metric.
 *
 * The Base44 version used react-leaflet with its own tile layer. This uses the
 * MapLibre satellite basemap the rest of the app already runs on
 * (`features/maps/basemap.ts`), so there is one map stack, one tile source and
 * one cache rather than two.
 *
 * Colour here is a SEQUENTIAL encoding of magnitude, not a categorical one —
 * a single hue ramped light to dark, per the design system's data palette.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl'
import { Button, Card, Input, Modal, PageHeader, Stat } from '@/components/ui'
import { useSession } from '@/auth/session'
import { useData } from '@/data/context'
import { looksLikeAlberta, parseCoordinatePair } from '@/domain/analysisImport'
import { SATELLITE_STYLE } from '@/features/maps/basemap'
import { METRIC_BY_KEY, METRIC_GROUP_LABELS, STORED_METRICS, formatMetric } from '@/domain/analysisMetrics'
import { parseMetric } from '@/domain/stats'
import { AnalysisProvider, useAnalysis } from './useAnalysis'
import { FilterBar, MetricSelect, NotEnoughData, StatLink } from './AnalysisChrome'

const METRIC_OPTIONS = STORED_METRICS.map((m) => ({
  key: m.key,
  label: m.label,
  group: METRIC_GROUP_LABELS[m.group],
}))

/** Southern Alberta, where the operation runs. Used when nothing has coords. */
const FALLBACK_CENTRE: [number, number] = [-111.9, 49.85]

function AnalysisMapView() {
  const { rows, loading, allRows } = useAnalysis()
  const s = useSession()
  const canEdit = s.can('analysis', 'edit')
  const [metricKey, setMetricKey] = useState('live_prepupae')
  const [fixing, setFixing] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const markersRef = useRef<maplibregl.Marker[]>([])

  const located = useMemo(
    () =>
      rows
        .filter((r) => r.lat !== null && r.lng !== null)
        .map((r) => ({
          id: r.id,
          name: r.field_name,
          year: r.year,
          company: r.company,
          acres: r.acres,
          lat: r.lat as number,
          lng: r.lng as number,
          value: parseMetric(r[metricKey as keyof typeof r]),
        })),
    [rows, metricKey],
  )

  // Ramp bounds from the data in view, so the colour scale always uses its
  // full range rather than compressing everything into one shade.
  const [lo, hi] = useMemo(() => {
    const values = located.map((p) => p.value).filter((v): v is number => v !== null)
    if (values.length === 0) return [0, 1]
    const min = Math.min(...values)
    const max = Math.max(...values)
    return min === max ? [min, min + 1] : [min, max]
  }, [located])

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: SATELLITE_STYLE,
      center: FALLBACK_CENTRE,
      zoom: 8,
      attributionControl: { compact: true },
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Redraw markers whenever the data or the metric changes.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    for (const m of markersRef.current) m.remove()
    markersRef.current = []

    for (const p of located) {
      const el = document.createElement('div')
      // Area scales with acres so a big field reads as big, floored so a small
      // one stays clickable.
      const size = Math.max(12, Math.min(34, Math.sqrt((p.acres ?? 40) / Math.PI) * 3.2))
      const t = p.value === null ? null : (p.value - lo) / (hi - lo)
      el.style.width = `${size}px`
      el.style.height = `${size}px`
      el.style.borderRadius = '50%'
      el.style.cursor = 'pointer'
      el.style.border = '2px solid rgba(255,255,255,0.85)'
      el.style.boxShadow = '0 1px 6px rgba(0,0,0,0.5)'
      el.style.background =
        t === null
          ? 'rgba(160,160,168,0.55)'
          : `color-mix(in oklab, var(--data-honey) ${Math.round(18 + t * 82)}%, var(--bg-surface))`
      el.title = `${p.name} (${p.year})`

      const popup = new maplibregl.Popup({ offset: size / 2 + 4, closeButton: false }).setHTML(
        `<div style="font-family:system-ui;font-size:12px;line-height:1.5">
           <strong>${escapeHtml(p.name)}</strong><br/>
           ${escapeHtml(p.year)} · ${escapeHtml(p.company)}<br/>
           ${escapeHtml(METRIC_BY_KEY[metricKey]?.label ?? metricKey)}:
           <strong>${escapeHtml(formatMetric(p.value, metricKey))}</strong>
         </div>`,
      )

      markersRef.current.push(
        new maplibregl.Marker({ element: el }).setLngLat([p.lng, p.lat]).setPopup(popup).addTo(map),
      )
    }

    // Frame the data rather than the province.
    if (located.length > 0) {
      const bounds = new maplibregl.LngLatBounds()
      for (const p of located) bounds.extend([p.lng, p.lat])
      map.fitBounds(bounds, { padding: 60, maxZoom: 12, duration: 0 })
    }
  }, [located, lo, hi, metricKey])

  if (loading && allRows.length === 0) return <p className="text-muted">Loading season data…</p>

  const missing = rows.length - located.length

  return (
    <div>
      <PageHeader title="Map" subtitle="Where each field-season sits, coloured by the metric you pick." />
      <FilterBar />

      {rows.length === 0 ? (
        <NotEnoughData what="the map" />
      ) : (
        <>
          <Card className="mb-4">
            <div className="flex flex-wrap items-end gap-3">
              <MetricSelect label="Colour by" value={metricKey} onChange={setMetricKey} options={METRIC_OPTIONS} />
              <div className="flex-1" />
              <div className="flex items-center gap-2 pb-1.5">
                <span className="text-xs text-muted">{formatMetric(lo, metricKey)}</span>
                <span
                  className="inline-block h-2.5 w-32 rounded-pill"
                  style={{
                    background:
                      'linear-gradient(to right, color-mix(in oklab, var(--data-honey) 18%, var(--bg-surface)), var(--data-honey))',
                  }}
                />
                <span className="text-xs text-muted">{formatMetric(hi, metricKey)}</span>
              </div>
            </div>
          </Card>

          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <StatLink
              to="/analysis/fields"
              label="Mapped"
              value={located.length}
              unit={`/ ${rows.length}`}
              hint="See them as a list"
            />
            {/*
              Clickable when there is something to fix. A count you can't act on
              is just a complaint — these 9 rows are invisible on the map AND
              carry no weather, so fixing one is worth more than reading it.
            */}
            {missing > 0 && canEdit ? (
              <button
                type="button"
                onClick={() => setFixing(true)}
                className="rounded-lg text-left transition hover:-translate-y-0.5"
              >
                <Stat
                  label="Missing coordinates"
                  value={missing}
                  tone="warn"
                  hint="Not on the map — click to fix"
                />
              </button>
            ) : (
              <Stat
                label="Missing coordinates"
                value={missing}
                tone={missing > 0 ? 'warn' : 'default'}
                hint={missing > 0 ? 'Not shown on the map' : undefined}
              />
            )}
            <StatLink
              to="/analysis/fields?sort=year"
              label="Seasons"
              value={new Set(rows.map((r) => r.year)).size}
              hint="Browse by season"
            />
          </div>

          <Card className="p-0">
            <div ref={containerRef} className="h-[560px] w-full overflow-hidden rounded-lg" />
          </Card>

          {fixing && <CoordinateFixer onClose={() => setFixing(false)} />}
        </>
      )}
    </div>
  )
}

/**
 * Fill in the coordinates the spreadsheet never had.
 *
 * One box per field-season rather than separate lat and lng inputs, because
 * the coordinate is always arriving from somewhere as a pair — copied out of
 * Google Maps, or read off a handheld. Splitting it would just make the user
 * do the splitting.
 *
 * Rows save one at a time and independently. A partial fix is a real fix: get
 * three of the nine right today and those three appear on the map, rather than
 * holding all nine hostage to a Save All that fails on one bad paste.
 */
function CoordinateFixer({ onClose }: { onClose: () => void }) {
  const { allRows } = useAnalysis()
  const { saveFieldAnalysis } = useData()
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Recomputed from allRows, so a saved row leaves the list on its own.
  const missing = useMemo(
    () =>
      allRows
        .filter((r) => r.lat === null || r.lng === null)
        .sort((a, b) => b.year.localeCompare(a.year) || a.field_name.localeCompare(b.field_name)),
    [allRows],
  )

  const save = async (id: string) => {
    const raw = drafts[id] ?? ''
    const parsed = parseCoordinatePair(raw)
    if (!parsed) {
      setErrors((e) => ({
        ...e,
        [id]: 'Could not read that. Try "49.8635, -111.963".',
      }))
      return
    }
    setSaving(id)
    setErrors((e) => ({ ...e, [id]: '' }))
    const res = await saveFieldAnalysis(id, { lat: parsed.lat, lng: parsed.lng })
    setSaving(null)
    if (!res.ok) {
      setErrors((e) => ({ ...e, [id]: res.error ?? 'Could not save.' }))
      return
    }
    setDrafts((d) => {
      const next = { ...d }
      delete next[id]
      return next
    })
  }

  return (
    <Modal title="Fix missing coordinates" onClose={onClose} wide>
      {missing.length === 0 ? (
        <p className="py-6 text-center text-sm text-secondary">
          Every field-season has coordinates. Nothing left to fix.
        </p>
      ) : (
        <>
          <p className="mb-4 text-sm text-secondary">
            {missing.length === 1
              ? 'One field-season has no location, so it is missing from the map and carries no weather data — which also drops it out of every weather correlation.'
              : `These ${missing.length} field-seasons have no location, so they are missing from the map and carry no weather data — which also drops them out of every weather correlation.`}{' '}
            Paste a coordinate from Google Maps or a handheld.
          </p>

          <div className="space-y-3">
            {missing.map((r) => {
              const raw = drafts[r.id] ?? ''
              const parsed = raw.trim() ? parseCoordinatePair(raw) : null
              const offPatch = parsed !== null && !looksLikeAlberta(parsed.lat, parsed.lng)
              return (
                <div key={r.id} className="rounded-sm bg-inset p-3">
                  <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm text-primary">{r.field_name}</span>
                    <span className="text-xs text-muted">
                      {[r.year, r.company, r.farmer_name].filter(Boolean).join(' · ')}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      value={raw}
                      placeholder="49.8635, -111.963"
                      className="min-w-[220px] flex-1"
                      onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && parsed) void save(r.id)
                      }}
                    />
                    <Button onClick={() => void save(r.id)} disabled={!parsed || saving === r.id}>
                      {saving === r.id ? 'Saving…' : 'Save'}
                    </Button>
                  </div>

                  {parsed && (
                    <p className="mt-1.5 text-xs text-muted">
                      Reads as{' '}
                      <span className="tabular-nums text-secondary">
                        {parsed.lat.toFixed(5)}, {parsed.lng.toFixed(5)}
                      </span>
                      {offPatch && (
                        // Valid on Earth, but not where this business operates —
                        // usually a swapped pair or a dropped minus sign.
                        <span style={{ color: 'var(--warn-fg)' }}>
                          {' '}
                          — that is outside Alberta. Check the order and the minus sign.
                        </span>
                      )}
                    </p>
                  )}
                  {errors[r.id] && (
                    <p className="mt-1.5 text-xs" style={{ color: 'var(--danger-fg)' }}>
                      {errors[r.id]}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </Modal>
  )
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  )
}

export default function AnalysisMap() {
  return (
    <AnalysisProvider>
      <AnalysisMapView />
    </AnalysisProvider>
  )
}
