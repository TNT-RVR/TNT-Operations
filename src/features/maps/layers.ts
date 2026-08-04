/**
 * The map's layer registry — every overlay the planner can draw, grouped by the
 * six tool layers of the desktop app (spec Part 6), with the canonical Part 13
 * colours so a crew and an operator see literally the same map.
 *
 * Colours are literal hex on purpose: MapLibre paint properties can't read CSS
 * custom properties. `src/features/maps/**` is allow-listed in the token lint
 * for exactly this reason. Keep these values in sync with Part 13.
 */

export type LayerGroup = 'pivot' | 'boundary' | 'sprayer' | 'planter' | 'shelters' | 'crews'

/** How the legend draws this layer's swatch. */
export type Swatch = 'line' | 'dash' | 'box' | 'ring' | 'pin'

export interface LayerDef {
  id: LayerId
  label: string
  group: LayerGroup
  color: string
  swatch: Swatch
  /** Visible on a freshly-opened field. */
  defaultOn: boolean
}

const DEFS = [
  // 🎯 Pivot
  { id: 'pivot', label: 'Pivot point', group: 'pivot', color: '#F5453D', swatch: 'pin', defaultOn: true },
  { id: 'tracks', label: 'Pivot tracks', group: 'pivot', color: '#FF8A2B', swatch: 'dash', defaultOn: true },
  { id: 'cornerArms', label: 'Corner arms', group: 'pivot', color: '#FF8A2B', swatch: 'line', defaultOn: true },
  // ⭕ Boundary
  { id: 'boundary', label: 'Boundary', group: 'boundary', color: '#00CED1', swatch: 'line', defaultOn: true },
  { id: 'inner', label: 'Inner boundary', group: 'boundary', color: '#FF6600', swatch: 'line', defaultOn: true },
  { id: 'accessRoad', label: 'Access road', group: 'boundary', color: '#FF2D95', swatch: 'line', defaultOn: true },
  { id: 'wetZones', label: 'Wet zones', group: 'boundary', color: '#39B7D6', swatch: 'box', defaultOn: true },
  { id: 'fieldInfo', label: 'Entrance / parking', group: 'boundary', color: '#16A34A', swatch: 'pin', defaultOn: true },
  // ⋰⋮⋱ Sprayer
  { id: 'sprayerLimit', label: 'Sprayer limit', group: 'sprayer', color: '#33FF66', swatch: 'line', defaultOn: false },
  { id: 'sprayerPasses', label: 'Sprayer passes', group: 'sprayer', color: '#33FF66', swatch: 'dash', defaultOn: false },
  { id: 'tireEdge', label: 'Tire & edge zones', group: 'sprayer', color: '#FF2A2A', swatch: 'box', defaultOn: false },
  { id: 'sprayerPaths', label: 'Uploaded sprayer paths', group: 'sprayer', color: '#FF8C00', swatch: 'line', defaultOn: false },
  // 🌱 Planter
  { id: 'maleBays', label: 'Male bays', group: 'planter', color: '#2E9BF0', swatch: 'box', defaultOn: false },
  { id: 'planterNumbers', label: 'Pass numbers', group: 'planter', color: '#FFB000', swatch: 'line', defaultOn: false },
  { id: 'planterPaths', label: 'Imported planter paths', group: 'planter', color: '#1E90FF', swatch: 'line', defaultOn: false },
  // 🐝 Shelters
  { id: 'shelters', label: 'Shelters', group: 'shelters', color: '#FFCE3A', swatch: 'pin', defaultOn: true },
  { id: 'alignment', label: 'Alignment lines', group: 'shelters', color: '#86E0FF', swatch: 'line', defaultOn: false },
  { id: 'buffers', label: 'Shelter buffer zones', group: 'shelters', color: '#1E90FF', swatch: 'ring', defaultOn: false },
  { id: 'actualShelters', label: 'Actual (scanned)', group: 'shelters', color: '#19E36B', swatch: 'pin', defaultOn: false },
  // 🚜 Crews
  { id: 'crewRoute', label: 'Crew route', group: 'crews', color: '#A855F7', swatch: 'line', defaultOn: true },
] as const

/** Every layer id, derived from the table above — add a row, get a new id. */
export type LayerId = (typeof DEFS)[number]['id']

export const LAYER_DEFS: readonly LayerDef[] = DEFS

export type LayerVisibility = Record<LayerId, boolean>

export const GROUP_LABEL: Record<LayerGroup, string> = {
  pivot: 'Pivot',
  boundary: 'Boundary',
  sprayer: 'Sprayer',
  planter: 'Planter',
  shelters: 'Shelters',
  crews: 'Crews',
}

export const GROUPS: LayerGroup[] = ['pivot', 'boundary', 'sprayer', 'planter', 'shelters', 'crews']

export function defaultVisibility(): LayerVisibility {
  const v = {} as LayerVisibility
  for (const d of LAYER_DEFS) v[d.id] = d.defaultOn
  return v
}

const LS_KEY = 'tnt.map.layers'

/** Device-local layer prefs (spec §9: `ui_prefs.json` remembers the map state). */
export function loadVisibility(): LayerVisibility {
  const base = defaultVisibility()
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return base
    const saved = JSON.parse(raw) as Partial<LayerVisibility>
    for (const d of LAYER_DEFS) {
      if (typeof saved[d.id] === 'boolean') base[d.id] = saved[d.id] as boolean
    }
  } catch {
    /* corrupt or unavailable — defaults are fine */
  }
  return base
}

export function saveVisibility(v: LayerVisibility): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(v))
  } catch {
    /* private mode — not worth surfacing */
  }
}

/** Layers in a group that are currently on — drives the dynamic legend (§6.8). */
export function activeLayers(v: LayerVisibility): LayerDef[] {
  return (LAYER_DEFS as readonly LayerDef[]).filter((d) => v[d.id])
}
