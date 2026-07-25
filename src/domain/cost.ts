/**
 * Cost-estimator math. Pure functions — no React, no DB.
 *
 * Faithful port of the beetent-maps Financial View engine
 * (`beetent_app.py::_field_cost` + `_cost_compute` + `_resolve_year_data`),
 * per docs/web-rebuild-spec.md PART 8. The spec §8.2 pseudocode is the
 * contract; where it is ambiguous the Python resolves it.
 *
 * Key model (from §8.2):
 *  - Capital items are AMORTIZED: `unit_cost ÷ life_years × qty` (life ≤ 0
 *    counts as 1). Bees are a 1-yr item — full cost every season.
 *  - WORK (handling + loading) is crew-count INVARIANT: total person-hours
 *    split across people. Adding crews shortens wall-clock duration only.
 *  - TRAVEL (home↔field round trip) and FUEL scale with crew count: every
 *    crew drives the full round trip; the in-field route is shared once.
 *
 * Differences from the Python, on purpose:
 *  - Field geometry is NOT recomputed here. The Python derives shelters,
 *    trays and route km from the field JSON inside `_field_cost`; the web
 *    app already has those through the tent-grid domain functions, so
 *    `fieldCost` takes them as inputs (`FieldCostInput`).
 *  - Divide-by-zero guards return `null` (Python returned 0.0 for
 *    cost/profit per acre on 0 acres — `null` is honest and the UI can
 *    render an em dash).
 */

// ═══════════════════════════════════════════════════════════════════════════
// Preferences (per pricing year) — spec §8.1 / Python COST_FIELD_SPEC
// ═══════════════════════════════════════════════════════════════════════════

/** All General-Information cost inputs for ONE pricing year. */
export interface CostPrefs {
  // ── Items (unit cost + depreciation life in years) ──
  costPerShelter: number
  shelterLifeYr: number
  costPerTray: number
  trayLifeYr: number
  costPerBlock: number
  blockLifeYr: number
  /** Nesting blocks installed per shelter. */
  blocksPerShelter: number
  costPerFlag: number
  flagLifeYr: number

  // ── Bees (1-yr life — full cost every year) ──
  costPerGalBee: number

  // ── Chemical ──
  chemCostPerAcre: number

  // ── Fuel ──
  /** Equipment fuel use, litres per km. Spec default 0.35. */
  fuelLPerKm: number
  fuelCostPerL: number

  // ── Labour ──
  payPerHour: number
  /** In-field driving speed between shelters, km/h. Spec default 15. */
  driveSpeedKmh: number
  crewsSetup: number
  empPerCrewSetup: number
  /** Setup handling minutes per shelter. */
  timeSetupMin: number
  /** Truck-loading minutes per shelter (setup). */
  loadSetupMinPerShelter: number
  crewsBees: number
  empPerCrewBees: number
  /** Bee-distribution handling minutes per shelter. */
  timeBeesMin: number
  /** Truck-loading minutes per tray (bees). */
  loadBeesMinPerTray: number
  crewsRemoval: number
  empPerCrewRemoval: number
  /** Removal handling minutes per shelter. */
  timeRemovalMin: number
  /** Truck-loading minutes per shelter (removal). */
  loadRemovalMinPerShelter: number

  // ── Contracts (revenue) ──
  /** Contract $/acre per company name. */
  contractPerAcre: Record<string, number>

  // ── Home / depot pin ──
  // NOTE: in the Python this is GLOBAL (top level of cost_prefs.json, not
  // per year). It rides along here so one object carries everything the
  // estimator needs; per-year storage should leave it null.
  homeLat: number | null
  homeLon: number | null
}

/**
 * Spec defaults (§8.1 table + Python `COST_FIELD_SPEC` third column — the
 * Python is the superset: item lives 5/5/5/3 yr, 1 block/shelter, 1 crew ×
 * 1 employee per task, handling 10/5/5 min, bee loading 1.06 min/tray).
 * Money inputs with no default ("" in the Python spec) parse to 0.
 * Gallons defaults (gals/acre 3, gals/tray 2) live on the FIELD, not here.
 */
export function defaultCostPrefs(): CostPrefs {
  return {
    costPerShelter: 0,
    shelterLifeYr: 5,
    costPerTray: 0,
    trayLifeYr: 5,
    costPerBlock: 0,
    blockLifeYr: 5,
    blocksPerShelter: 1,
    costPerFlag: 0,
    flagLifeYr: 3,
    costPerGalBee: 0,
    chemCostPerAcre: 0,
    fuelLPerKm: 0.35,
    fuelCostPerL: 0,
    payPerHour: 0,
    driveSpeedKmh: 15,
    crewsSetup: 1,
    empPerCrewSetup: 1,
    timeSetupMin: 10,
    loadSetupMinPerShelter: 0,
    crewsBees: 1,
    empPerCrewBees: 1,
    timeBeesMin: 5,
    loadBeesMinPerTray: 1.06,
    crewsRemoval: 1,
    empPerCrewRemoval: 1,
    timeRemovalMin: 5,
    loadRemovalMinPerShelter: 0,
    contractPerAcre: {},
    homeLat: null,
    homeLon: null,
  }
}

/**
 * Resolve the cost prefs for a pricing year from per-year stored forms.
 * WHOLE-FORM carry-forward, mirroring `_resolve_year_data`:
 *   1. exact year if stored;
 *   2. else the most recent EARLIER year's form;
 *   3. else the most recent stored year overall (even if later — the
 *      Python's tiebreak when no earlier year exists);
 *   4. else nothing stored → pure defaults.
 * The chosen form is then filled key-by-key from `defaultCostPrefs()`
 * (mirroring `_cost_inputs_for_year`) — but NO cross-year per-field
 * merging: one year's form wins wholesale.
 */
export function resolvePrefsForYear(
  byYear: Record<string, Partial<CostPrefs>>,
  year: string | number,
): CostPrefs {
  const y = String(year)
  // String sort like the Python (fine for 4-digit years).
  const yrs = Object.keys(byYear).sort()
  let stored: Partial<CostPrefs> | undefined = byYear[y]
  if (!stored && yrs.length > 0) {
    const le = yrs.filter((k) => k <= y)
    stored = byYear[le.length > 0 ? le[le.length - 1] : yrs[yrs.length - 1]]
  }
  const out = defaultCostPrefs()
  if (stored) {
    for (const [k, v] of Object.entries(stored)) {
      if (v !== undefined && v !== null && k in out) {
        ;(out as unknown as Record<string, unknown>)[k] = v
      }
    }
    if (stored.contractPerAcre) out.contractPerAcre = { ...stored.contractPerAcre }
  }
  return out
}

// ═══════════════════════════════════════════════════════════════════════════
// Bee / tray derivation — spec §7.2 / `_compute_bee_distribution`
// ═══════════════════════════════════════════════════════════════════════════

/** Total gallons of bees for a field: `gals_per_acre × acres`. */
export function totalGals(galsPerAcre: number, acres: number): number {
  return galsPerAcre * acres
}

/** Trays the gallons mathematically require: `ceil(gals / gals_per_tray)` (0 if no tray size). */
export function mathTrays(gals: number, galsPerTray: number): number {
  if (!galsPerTray || galsPerTray <= 0) return 0
  return Math.ceil(gals / galsPerTray)
}

/** Trays actually deployed — never fewer trays than shelters. */
export function totalTrays(mathTrayCount: number, numShelters: number): number {
  return Math.max(mathTrayCount, numShelters)
}

/**
 * Per-shelter tray counts, "even" strategy: base = `total // n`, and the
 * `extras = total % n` upgrade trays are spread evenly along the shelter
 * order (Bresenham-style `((i+1)·e/n)⌋ − (i·e/n)⌋`, exactly the Python's
 * no-row-info fallback). Always sums to exactly `trayTotal`.
 */
export function trayDistribution(trayTotal: number, numShelters: number): number[] {
  if (numShelters <= 0) return []
  const base = Math.floor(trayTotal / numShelters)
  const extras = trayTotal % numShelters
  const per: number[] = []
  for (let i = 0; i < numShelters; i++) {
    const add =
      Math.floor(((i + 1) * extras) / numShelters) - Math.floor((i * extras) / numShelters)
    per.push(base + add)
  }
  return per
}

// ═══════════════════════════════════════════════════════════════════════════
// Per-field cost — spec §8.2 / `_field_cost` + `_cost_compute`
// ═══════════════════════════════════════════════════════════════════════════

/** The field-derived quantities the estimator consumes (geometry already computed upstream). */
export interface FieldCostInput {
  /** Shelter count `n` (from the tent grid / manual pins). */
  shelters: number
  /** Deployed trays (see `totalTrays` — already max'd with shelters). */
  trays: number
  /** Gallons of bees (see `totalGals`). */
  gallons: number
  acres: number
  /** In-field crew-route km (crew route or override polyline). */
  routeKm: number
  /** One-way home→parking road km (Google travel cache; 0 until fetched). */
  rtKm: number
  /** One-way home→parking road minutes (Google travel cache; 0 until fetched). */
  rtMin: number
  /** Company name, for the contract $/acre lookup. */
  company?: string
}

/** One task's (setup / bees / removal) cost breakdown. */
export interface TaskCost {
  crews: number
  /** Total people on the task: `crews × employees_per_crew`. */
  people: number
  /** Total handling person-hours: `n × min/60`. */
  workH: number
  /** Total truck-loading person-hours: `units × load_min/60`. */
  loadH: number
  /** In-field driving hours per crew: `route_km / crews / speed`. */
  driveH: number
  /** Wall-clock duration: `(work_h + load_h)/people + drive_h`. */
  durH: number
  /** Handling + paid in-field driving: `work_h×pay + people×drive_h×pay`. */
  fieldLabour: number
  loadLabour: number
  /** Paid home↔field round trip: `people × rt_h × pay`. */
  travel: number
  /** `rt_km × 2 × crews + route_km` (route shared once across crews). */
  fuelKm: number
  fuel: number
  /** `fieldLabour + loadLabour + travel`. */
  taskLabour: number
}

export interface ItemsBreakdown {
  shelter: number
  bee: number
  tray: number
  block: number
  flag: number
  total: number
}

export interface FieldCostResult {
  items: ItemsBreakdown
  chemical: number
  setup: TaskCost
  bees: TaskCost
  removal: TaskCost
  labourTotal: number
  fuelTotal: number
  /** Σ task travel (home↔field labour) — a sub-line of labourTotal. */
  travelTotal: number
  total: number
  /** `total / acres`, or null when acres ≤ 0. */
  costPerAcre: number | null
  /** Contract $/acre for the field's company (0 when unknown). */
  contractRate: number
  contractValue: number
  netProfit: number
  /** `netProfit / acres`, or null when acres ≤ 0. */
  profitPerAcre: number | null
}

/** Depreciation life: years if > 0, else 1 (mirrors the Python `life()`). */
function life(years: number): number {
  return years > 0 ? years : 1
}

/**
 * Line-item estimated cost for one field — the exact §8.2 math.
 * All values are raw dollars/hours (no rounding — display rounds).
 */
export function fieldCost(input: FieldCostInput, prefs: CostPrefs): FieldCostResult {
  const { shelters: n, trays, gallons, acres, routeKm, rtKm, rtMin } = input
  const pay = prefs.payPerHour
  // Python: `c.get("drive_speed_kmh", 0) or 15.0` — 0/blank falls back to 15.
  const speed = prefs.driveSpeedKmh || 15
  /** Round-trip home↔field hours everyone is paid for. */
  const rtH = (rtMin / 60) * 2

  // ── Amortized item costs ──
  const shelter = (n * prefs.costPerShelter) / life(prefs.shelterLifeYr)
  const bee = gallons * prefs.costPerGalBee // 1-yr life: full cost each year
  const tray = (trays * prefs.costPerTray) / life(prefs.trayLifeYr)
  const block = (n * prefs.blocksPerShelter * prefs.costPerBlock) / life(prefs.blockLifeYr)
  const flag = (n * prefs.costPerFlag) / life(prefs.flagLifeYr)
  const itemsTotal = shelter + bee + tray + block + flag
  const chemical = acres * prefs.chemCostPerAcre

  // ── Per task ──
  const task = (crewsRaw: number, epcRaw: number, mins: number, loadMin: number, units: number): TaskCost => {
    const crews = Math.max(crewsRaw, 0)
    const epc = Math.max(epcRaw, 0)
    const people = crews * epc
    const workH = (n * mins) / 60
    const loadH = (units * loadMin) / 60
    const driveH = crews > 0 ? routeKm / crews / speed : 0
    const durH = people > 0 ? (workH + loadH) / people + driveH : 0
    const driveLabour = people * driveH * pay
    const fieldLabour = workH * pay + driveLabour
    const loadLabour = loadH * pay
    const travel = people * rtH * pay
    const fuelKm = rtKm * 2 * crews + routeKm
    const fuel = fuelKm * prefs.fuelLPerKm * prefs.fuelCostPerL
    return {
      crews,
      people,
      workH,
      loadH,
      driveH,
      durH,
      fieldLabour,
      loadLabour,
      travel,
      fuelKm,
      fuel,
      taskLabour: fieldLabour + loadLabour + travel,
    }
  }

  const setup = task(
    prefs.crewsSetup, prefs.empPerCrewSetup, prefs.timeSetupMin,
    prefs.loadSetupMinPerShelter, n, // units = shelters
  )
  const bees = task(
    prefs.crewsBees, prefs.empPerCrewBees, prefs.timeBeesMin,
    prefs.loadBeesMinPerTray, trays, // units = trays
  )
  const removal = task(
    prefs.crewsRemoval, prefs.empPerCrewRemoval, prefs.timeRemovalMin,
    prefs.loadRemovalMinPerShelter, n, // units = shelters
  )

  // ── Totals ──
  const labourTotal = setup.taskLabour + bees.taskLabour + removal.taskLabour
  const fuelTotal = setup.fuel + bees.fuel + removal.fuel
  const travelTotal = setup.travel + bees.travel + removal.travel
  const total = itemsTotal + chemical + fuelTotal + labourTotal

  // ── Revenue / profit (Python `_cost_compute` attachment) ──
  const contractRate = (input.company && prefs.contractPerAcre[input.company]) || 0
  const contractValue = contractRate * acres
  const netProfit = contractValue - total

  return {
    items: { shelter, bee, tray, block, flag, total: itemsTotal },
    chemical,
    setup,
    bees,
    removal,
    labourTotal,
    fuelTotal,
    travelTotal,
    total,
    costPerAcre: acres > 0 ? total / acres : null,
    contractRate,
    contractValue,
    netProfit,
    profitPerAcre: acres > 0 ? netProfit / acres : null,
  }
}
