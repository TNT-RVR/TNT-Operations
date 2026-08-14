import maplibregl, { type GeoJSONSource } from 'maplibre-gl'
import { trackRings, ringPolygons, overlayPins } from '../maps/overlays'
import { tireAndEdgeZones } from '@/domain/sprayOverlays'
import { bayGuides } from '@/domain/bayGuides'
import { navigationUrl } from '@/domain/navLink'

/**
 * The optional map layers shared by both field views.
 *
 * Extracted because Shelter Placement and Tray Placement need the same picture
 * of the same ground, and a crew that switches between them and sees two
 * different maps has been given a reason to distrust both. This session has
 * already produced one pair of implementations that disagreed — bay guides
 * drawn two ways — and that is the failure being designed out here.
 *
 * Colours are token-exempt: these sit on satellite imagery, not on the app's
 * surfaces, and have to hold up against grass and dirt rather than match a
 * theme.
 */

export const FIELD_LINE = '#00CED1'
export const PIN = '#FFCE3A'
export const PIN_OUTLINE = '#1A1A1A'
export const EDGE_ZONE = '#FF8A2B'
export const ROW_GUIDE = '#7DD3FC'
export const PARKING = '#4ADE80'
export const PIN_OTHER = '#E5E7EB'

const PIN_LABEL = { entrance: 'E', parking: 'P', home: 'H' } as const
const PIN_TITLE = { entrance: 'Entrance', parking: 'Parking', home: 'Home' } as const

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

/** Which optional layers are on. */
export interface FieldLayerVisibility {
  boundary: boolean
  tracks: boolean
  wet: boolean
  edges: boolean
  rowGuides: boolean
  pins: boolean
  /** Where placed shelters were MEANT to go, against where they went. */
  planned: boolean
}

/**
 * Defaults: the field's own facts on, the analysis layers off.
 *
 * Edge zones and bay guides answer questions asked at the headland rather than
 * while working, and a map with everything on is a map nobody reads.
 */
export const DEFAULT_LAYERS: FieldLayerVisibility = {
  boundary: true,
  tracks: true,
  wet: false,
  edges: false,
  rowGuides: false,
  // Off by default: a crew placing shelters wants to see the next open pin,
  // not a second set of rings behind the ones already done. It answers a
  // question asked afterwards — how close did we get to the plan.
  planned: false,
  pins: true,
}

/**
 * Toggle rows, in the order they appear in the menu.
 *
 * `only` marks a row that one view can honour and another cannot — a switch
 * that does nothing is worse than no switch, because it teaches people the
 * menu is decorative.
 */
export const LAYER_TOGGLES: Array<[keyof FieldLayerVisibility, string, ('shelters' | 'trays')?]> = [
  ['boundary', 'Boundary'],
  ['tracks', 'Pivot tracks'],
  ['wet', 'Wet zones'],
  ['edges', 'Sprayer edge zones'],
  ['rowGuides', 'Bay guides'],
  ['planned', 'Planned positions', 'shelters'],
  ['pins', 'Parking & gates'],
]

/** Declare the sources and layers. Call once, on `style.load`. */
export function addFieldLayers(map: maplibregl.Map): void {
  map.addSource('boundary', { type: 'geojson', data: EMPTY })
  map.addLayer({
    id: 'boundary-line',
    type: 'line',
    source: 'boundary',
    paint: { 'line-color': FIELD_LINE, 'line-width': 2 },
  })

  map.addSource('tracks', { type: 'geojson', data: EMPTY })
  map.addLayer({
    id: 'tracks-line',
    type: 'line',
    source: 'tracks',
    paint: { 'line-color': '#FF8A2B', 'line-width': 1.5, 'line-dasharray': [2, 2] },
  })

  map.addSource('wet', { type: 'geojson', data: EMPTY })
  map.addLayer({
    id: 'wet-fill',
    type: 'fill',
    source: 'wet',
    paint: { 'fill-color': '#39B7D6', 'fill-opacity': 0.3 },
  })

  // Under the shelter pins: context for where a shelter sits, not the thing
  // being placed.
  map.addSource('edges', { type: 'geojson', data: EMPTY })
  map.addLayer({
    id: 'edges-fill',
    type: 'fill',
    source: 'edges',
    paint: { 'fill-color': EDGE_ZONE, 'fill-opacity': 0.22 },
  })
  map.addLayer({
    id: 'edges-line',
    type: 'line',
    source: 'edges',
    paint: { 'line-color': EDGE_ZONE, 'line-width': 1, 'line-opacity': 0.5 },
  })

  map.addSource('row-guides', { type: 'geojson', data: EMPTY })
  map.addLayer({
    id: 'row-guides-line',
    type: 'line',
    source: 'row-guides',
    paint: {
      'line-color': ROW_GUIDE,
      'line-width': 1.5,
      'line-dasharray': [4, 3],
      'line-opacity': 0.9,
    },
  })

  map.addSource('row-guide-labels', { type: 'geojson', data: EMPTY })
  map.addLayer({
    id: 'row-guide-labels-text',
    type: 'symbol',
    source: 'row-guide-labels',
    layout: { 'text-field': ['to-string', ['get', 'number']], 'text-size': 13 },
    paint: { 'text-color': ROW_GUIDE, 'text-halo-color': '#000', 'text-halo-width': 1.4 },
  })
}

/** Bay guide lines and their pass numbers, for a field. */
function bayGuideData(
  g: Record<string, unknown>,
  shelters: Array<{ lat: number; lng: number }>,
): { lines: GeoJSON.FeatureCollection; labels: GeoJSON.FeatureCollection } {
  const boundary = Array.isArray(g.boundary_polygon)
    ? (g.boundary_polygon as Array<[number, number]>)
    : null
  const guides = bayGuides(g, shelters, 40, boundary)
  return {
    lines: {
      type: 'FeatureCollection',
      features: guides.map((gd) => ({
        type: 'Feature',
        properties: { pass: gd.pass },
        geometry: { type: 'LineString', coordinates: gd.coordinates },
      })),
    },
    labels: {
      type: 'FeatureCollection',
      features: guides.map((gd) => ({
        type: 'Feature',
        properties: { number: gd.pass },
        geometry: { type: 'Point', coordinates: gd.label },
      })),
    },
  }
}

/**
 * Push current data into those layers, and rebuild the marker pins.
 *
 * Returns the markers it created so the caller can remove them — MapLibre
 * markers live outside the map's layer list, survive `map.remove()`, and leak
 * one set per redraw otherwise.
 */
export function updateFieldLayers(
  map: maplibregl.Map,
  geometry: Record<string, unknown> | undefined,
  shelters: Array<{ lat: number; lng: number }>,
  show: FieldLayerVisibility,
): maplibregl.Marker[] {
  const g = geometry ?? {}
  const poly = Array.isArray(g.boundary_polygon) ? (g.boundary_polygon as Array<[number, number]>) : null

  const src = (id: string) => map.getSource(id) as GeoJSONSource | undefined

  src('boundary')?.setData(
    show.boundary && poly && poly.length >= 3
      ? {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'Polygon',
                coordinates: [[...poly, poly[0]].map(([lat, lon]) => [lon, lat])],
              },
            },
          ],
        }
      : EMPTY,
  )
  src('tracks')?.setData(show.tracks ? trackRings(g as never) : EMPTY)
  src('wet')?.setData(show.wet ? ringPolygons(g.wet_zones) : EMPTY)
  src('edges')?.setData(show.edges ? (tireAndEdgeZones(g).edge as GeoJSON.FeatureCollection) : EMPTY)

  const guides = show.rowGuides ? bayGuideData(g, shelters) : null
  src('row-guides')?.setData(guides?.lines ?? EMPTY)
  src('row-guide-labels')?.setData(guides?.labels ?? EMPTY)

  if (!show.pins) return []
  return overlayPins(g as never).map((pin) => {
    const el = document.createElement('div')
    el.textContent = PIN_LABEL[pin.kind]
    el.title = `${PIN_TITLE[pin.kind]} — tap for directions`
    el.style.cssText =
      `display:grid;place-items:center;width:30px;height:30px;border-radius:9999px;` +
      `background:${pin.kind === 'parking' ? PARKING : PIN_OTHER};color:#111;` +
      `font:700 13px/1 system-ui;border:2px solid rgba(0,0,0,.6);` +
      `box-shadow:0 1px 4px rgba(0,0,0,.5);cursor:pointer`
    // Confirmed, because this leaves the app: a mis-tap mid-scan would drop
    // someone out of what they were doing.
    el.addEventListener('click', (ev) => {
      ev.stopPropagation()
      if (!window.confirm(`Open directions to the ${PIN_TITLE[pin.kind].toLowerCase()}?`)) return
      window.open(navigationUrl(pin.lat, pin.lng), '_blank', 'noopener')
    })
    return new maplibregl.Marker({ element: el }).setLngLat([pin.lng, pin.lat]).addTo(map)
  })
}
