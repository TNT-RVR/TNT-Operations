/**
 * The phone home screen: which shortcuts a person keeps on it.
 *
 * A phone is not a small desktop. The sidebar has eleven sections and the
 * bottom bar holds four, so anything a crew or an office phone actually uses —
 * scan a block, tick a step, look at today — is two or three taps in. This is
 * the launcher that fixes that, and it is per person because a crew lead and
 * the office want completely different six things.
 *
 * ── The catalogue ────────────────────────────────────────────────────────────
 *
 * Every tile is a real destination, not a category: "Scan blocks" goes to the
 * scanner, not to Blocks. A launcher that lands you on another menu has just
 * moved the problem.
 *
 * Each tile names the MODULE it belongs to, so the list a person sees is
 * already filtered by what they may open — a device account offered Sales would
 * be offered a locked door.
 */

export interface HomeTile {
  key: string
  label: string
  /** What it is for, in the settings list. Not shown on the tile itself. */
  hint: string
  to: string
  /** Permission module; the tile is hidden from anyone who cannot open it. */
  module: string
  /** Lucide icon name, resolved by the component. */
  icon: string
}

/**
 * Ordered as a season runs: today's work first, then the records, then the
 * office. The order is also the order tiles appear, so nobody has to arrange
 * them by hand to get something sensible.
 */
export const HOME_TILES: HomeTile[] = [
  { key: 'field', label: 'Field Mode', hint: 'The crew screen — placement and scanning', to: '/field', module: 'field', icon: 'Tractor' },
  { key: 'shelters', label: 'Place shelters', hint: 'Mark shelters as placed at your position', to: '/field/shelters', module: 'field', icon: 'Tent' },
  { key: 'trays', label: 'Place trays', hint: 'Record trays out to a shelter', to: '/field/trays', module: 'field', icon: 'Boxes' },
  { key: 'crews', label: 'Crews', hint: 'Who is out, and where', to: '/field/crews', module: 'field', icon: 'Users' },
  { key: 'checklist', label: 'Checklist', hint: 'What has been done on which field', to: '/tasks/overall', module: 'tasks', icon: 'ListChecks' },
  { key: 'tasks', label: 'Tasks', hint: 'Assigned work and its checklists', to: '/tasks', module: 'tasks', icon: 'SquareCheck' },
  { key: 'calendar', label: 'Calendar', hint: 'The season by day', to: '/calendar', module: 'calendar', icon: 'CalendarDays' },
  { key: 'blockScan', label: 'Scan blocks', hint: 'Straight to the block scanner', to: '/blocks/scan', module: 'blocks', icon: 'ScanLine' },
  { key: 'blocks', label: 'Blocks', hint: 'Lots, labels and weights', to: '/blocks', module: 'blocks', icon: 'Grid3x3' },
  { key: 'returns', label: 'Returns map', hint: 'How the blocks came back', to: '/blocks/map', module: 'blocks', icon: 'MapPinned' },
  { key: 'experiments', label: 'Experiments', hint: 'Write down what a trial did, where you saw it', to: '/experiments', module: 'blocks', icon: 'FlaskConical' },
  { key: 'incubation', label: 'Incubation', hint: 'Incubators, temperatures and alerts', to: '/incubation', module: 'incubation', icon: 'Thermometer' },
  { key: 'hypoxia', label: 'Hypoxia', hint: 'Oxygen in the storage chambers', to: '/incubation/hypoxia', module: 'incubation', icon: 'Wind' },
  { key: 'incScan', label: 'Scan trays', hint: 'The incubation scanner', to: '/incubation/scan', module: 'incubation', icon: 'QrCode' },
  { key: 'samples', label: 'Samples', hint: 'X-ray grading and tray maths', to: '/incubation/samples', module: 'incubation', icon: 'Microscope' },
  { key: 'trayList', label: 'Trays', hint: 'Every tray, filterable', to: '/incubation/trays', module: 'incubation', icon: 'LayoutList' },
  { key: 'maps', label: 'Shelter Maps', hint: 'The office map and its tools', to: '/maps', module: 'maps', icon: 'Map' },
  { key: 'season', label: 'Season Setup', hint: "This year's fields and their details", to: '/maps/season', module: 'maps', icon: 'ClipboardList' },
  { key: 'costs', label: 'Field Costs', hint: 'Cost and profitability per field', to: '/finances/costs', module: 'maps', icon: 'Wallet' },
  // The KEYS are stable on purpose: they are what a person's chosen tiles are
  // stored as, so renaming one would silently drop it off their home screen.
  // Only the routes moved under /finances.
  { key: 'sales', label: 'Estimates', hint: 'Quotes and orders', to: '/finances/sales', module: 'sales', icon: 'FileText' },
  { key: 'invoices', label: 'Invoices', hint: 'What has been billed', to: '/finances/sales/invoices', module: 'sales', icon: 'Receipt' },
  { key: 'inventory', label: 'Inventory', hint: 'Stock on hand', to: '/finances/sales/inventory', module: 'sales', icon: 'Package' },
  { key: 'bees', label: 'Bee purchases', hint: 'Gallons bought, by supplier', to: '/finances/bees', module: 'sales', icon: 'ShoppingCart' },
  { key: 'analysis', label: 'Analysis', hint: 'Season results and correlations', to: '/analysis', module: 'analysis', icon: 'ChartLine' },
  { key: 'grants', label: 'Grants', hint: 'Funding pipeline', to: '/grants', module: 'grants', icon: 'Landmark' },
  { key: 'notifications', label: 'Alerts', hint: 'Everything the app has flagged', to: '/notifications', module: 'dashboard', icon: 'Bell' },
  { key: 'settings', label: 'Settings', hint: 'People, access and integrations', to: '/users', module: 'users', icon: 'Settings' },
]

/**
 * What a new person gets: the day-to-day six.
 *
 * Deliberately not "everything" — a wall of twenty-five tiles is the same
 * problem as the sidebar, and a default that has to be pruned teaches nobody
 * that it can be changed.
 */
export const DEFAULT_TILE_KEYS = ['field', 'checklist', 'blockScan', 'calendar', 'tasks', 'incubation']

const BY_KEY = new Map(HOME_TILES.map((t) => [t.key, t]))

/**
 * The tiles to show: the person's chosen keys, in THEIR order, dropping any
 * they may no longer open and any key that no longer exists.
 *
 * Order is kept because someone who put the scanner first meant it. Unknown
 * keys are skipped rather than erroring: a tile can be renamed or retired
 * between deploys, and a stale key in a saved list should cost nothing.
 */
export function resolveTiles(keys: string[] | null | undefined, can: (module: string) => boolean): HomeTile[] {
  const wanted = keys && keys.length > 0 ? keys : DEFAULT_TILE_KEYS
  const out: HomeTile[] = []
  const seen = new Set<string>()
  for (const k of wanted) {
    const tile = BY_KEY.get(k)
    if (!tile || seen.has(k) || !can(tile.module)) continue
    seen.add(k)
    out.push(tile)
  }
  return out
}

/** Everything this person could choose from, catalogue order. */
export function availableTiles(can: (module: string) => boolean): HomeTile[] {
  return HOME_TILES.filter((t) => can(t.module))
}

/**
 * Add or remove one key, keeping the rest in place.
 *
 * Adding appends rather than sorting into catalogue order: a tile someone just
 * chose should appear where they can find it, not jump into the middle.
 */
export function toggleTile(keys: string[], key: string): string[] {
  return keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]
}

/** Move a tile one place earlier or later, for arranging the grid. */
export function moveTile(keys: string[], key: string, delta: number): string[] {
  const i = keys.indexOf(key)
  if (i < 0) return keys
  const j = i + delta
  if (j < 0 || j >= keys.length) return keys
  const out = [...keys]
  ;[out[i], out[j]] = [out[j], out[i]]
  return out
}
