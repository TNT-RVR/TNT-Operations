/**
 * A satellite map showing nothing but field OUTLINES.
 *
 * Deliberately not a small MapsHome. That screen is an authoring surface —
 * shelters, bays, sprayer passes, six tool layers — and at the sizes this is
 * used it would be unreadable. Here the only question is "which field is
 * where", so the answer is the boundary and nothing else.
 *
 * Two callers, one component: the dashboard passes every field of the current
 * season and an `onSelect`, the per-field page passes one field and no handler.
 * The outline itself comes from `boundaryFeature`, the same helper the office
 * map draws with, so a pivot field is the same circle in all three places.
 */
import { useEffect, useRef } from 'react'
import maplibregl, { type GeoJSONSource } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { bbox as turfBbox } from '@turf/turf'
import type { FeatureCollection } from 'geojson'
import type { Field } from '@/data/types'
import { SATELLITE_STYLE } from './basemap'
import { fieldOutlines } from './overlays'

// Map paint needs literal hex — MapLibre cannot read a CSS variable. These are
// the token values: --brand honey for the outline, ink for its casing.
const OUTLINE = '#FEB836'
const OUTLINE_HOVER = '#FFFFFF'
const FILL_OPACITY = 0.18
// Shelter pins in a layout preview — the same honey as the outline they sit in.
const PIN = '#FEB836'
const PIN_STROKE = '#050506'

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }
const DEFAULT_CENTER: [number, number] = [-111.6, 49.83] // southern Alberta

export function BoundaryMap({
  fields,
  onSelect,
  pins,
  className = 'h-[420px]',
}: {
  fields: Field[]
  /** Given, the outlines become clickable and the cursor says so. */
  onSelect?: (fieldId: string) => void
  /**
   * Shelter positions to draw inside the outline. Used by the layout preview,
   * where seeing 132 dots land where they will actually go is the difference
   * between accepting last year's settings and guessing at them.
   */
  pins?: Array<{ lat: number; lng: number }>
  className?: string
}) {
  const holder = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const readyRef = useRef(false)
  /**
   * The click handler as a ref: re-registering it on every render would need
   * the map torn down, and a map that reinitialises loses the viewport the
   * person just panned to.
   */
  const selectRef = useRef(onSelect)
  selectRef.current = onSelect

  useEffect(() => {
    if (!holder.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: holder.current,
      style: SATELLITE_STYLE,
      center: DEFAULT_CENTER,
      zoom: 7,
      attributionControl: { compact: true },
    })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')

    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8 })

    map.on('style.load', () => {
      map.addSource('outlines', { type: 'geojson', data: EMPTY })
      map.addLayer({
        id: 'outline-fill',
        type: 'fill',
        source: 'outlines',
        paint: { 'fill-color': OUTLINE, 'fill-opacity': FILL_OPACITY },
      })
      map.addLayer({
        id: 'outline-line',
        type: 'line',
        source: 'outlines',
        paint: {
          'line-color': ['case', ['boolean', ['feature-state', 'hover'], false], OUTLINE_HOVER, OUTLINE],
          'line-width': 2,
        },
      })
      map.addSource('preview-pins', { type: 'geojson', data: EMPTY })
      map.addLayer({
        id: 'preview-pins',
        type: 'circle',
        source: 'preview-pins',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2, 15, 5],
          'circle-color': PIN,
          'circle-stroke-color': PIN_STROKE,
          'circle-stroke-width': 1,
        },
      })
      readyRef.current = true
      map.resize()
    })

    // Hover: name the field under the cursor. A DOM popup, not a symbol layer —
    // this style ships no glyph server, so map-rendered text would not appear.
    let hovered: string | number | undefined
    map.on('mousemove', 'outline-fill', (e) => {
      const f = e.features?.[0]
      if (!f) return
      map.getCanvas().style.cursor = selectRef.current ? 'pointer' : ''
      if (hovered !== undefined) map.setFeatureState({ source: 'outlines', id: hovered }, { hover: false })
      hovered = f.id
      if (hovered !== undefined) map.setFeatureState({ source: 'outlines', id: hovered }, { hover: true })
      const name = String(f.properties?.name ?? '')
      const client = String(f.properties?.client ?? '')
      popup
        .setLngLat(e.lngLat)
        .setHTML(
          `<div style="font:600 12px system-ui;color:#111114">${name}</div>` +
            (client ? `<div style="font:12px system-ui;color:#3C3C46">${client}</div>` : ''),
        )
        .addTo(map)
    })
    map.on('mouseleave', 'outline-fill', () => {
      map.getCanvas().style.cursor = ''
      if (hovered !== undefined) map.setFeatureState({ source: 'outlines', id: hovered }, { hover: false })
      hovered = undefined
      popup.remove()
    })
    map.on('click', 'outline-fill', (e) => {
      const id = e.features?.[0]?.properties?.id
      if (id && selectRef.current) selectRef.current(String(id))
    })

    return () => {
      popup.remove()
      map.remove()
      mapRef.current = null
      readyRef.current = false
    }
  }, [])

  // Data + framing. Runs on every field change, and polls briefly while the
  // style is still parsing — `style.load` may not have fired on first paint.
  useEffect(() => {
    let cancelled = false
    const apply = () => {
      const map = mapRef.current
      if (cancelled || !map) return
      if (!readyRef.current) {
        setTimeout(apply, 60)
        return
      }
      ;(map.getSource('preview-pins') as GeoJSONSource | undefined)?.setData({
        type: 'FeatureCollection',
        features: (pins ?? []).map((p) => ({
          type: 'Feature',
          properties: {},
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        })),
      })
      const data = fieldOutlines(fields)
      // Numeric feature ids so hover state has something to key on; GeoJSON
      // sources cannot use a string property as a feature id.
      data.features.forEach((f, i) => (f.id = i))
      ;(map.getSource('outlines') as GeoJSONSource | undefined)?.setData(data)
      if (data.features.length > 0) {
        const [w, s, e, n] = turfBbox(data)
        map.fitBounds(
          [
            [w, s],
            [e, n],
          ],
          { padding: 40, duration: 0, maxZoom: 14 },
        )
      }
    }
    apply()
    return () => {
      cancelled = true
    }
  }, [fields, pins])

  return <div ref={holder} className={`w-full overflow-hidden rounded-lg border border-subtle ${className}`} />
}
