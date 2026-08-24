import { createContext, useContext } from 'react'
import type { BeePurchase } from '@/domain/beePurchases'
import type { CrewTask } from '@/domain/supplies'
import type {
  FieldSeason,
  PollinationField,
  FieldChecklistCell,
  Block,
  BlockPlacement,
  Field,
  Incubator,
  IncubationBatch,
  IncubatorAlert,
  IncubatorModeEvent,
  Inspection,
  Sample,
  SensorReading,
  Tray,
  TrayInspection,
  AppNotification,
  PlacedShelter,
  ShelterTrayLink,
  NestingBlock,
  BlockSeason,
  CalendarEvent,
  Grant,
  GrantTask,
  FieldAnalysis,
  FieldWeather,
  Product,
  ItemSpecRow,
  SalesCustomer,
  Supplier,
  SalesOrder,
  SalesOrderLine,
  SalesOrderCharge,
  OrderKind,
  Shipment,
  InventoryLevel,
  StockMovement,
  StockReason,
  Task,
  TaskStatus,
  TaskStep,
  Checklist,
  ExperimentNote,
  ExperimentNoteItem,
} from './types'
import type { SettingsSlice } from './useSettings'
import type { CostPrefs } from '@/domain/cost'
import type { Crew, CrewMember } from '@/domain/crews'

/** A tray examined during an inspection, before it has a parent or an id. */
export type TrayObservation = Pick<
  TrayInspection,
  'trayId' | 'trayNumber' | 'stackPosition' | 'depthPosition' | 'cellsOpened' | 'devStage' | 'notes'
>

/** Which channels a given alert type is delivered on, for the current user. */
export interface NotificationPref {
  inApp: boolean
  email: boolean
  push: boolean
}

/**
 * The ONE seam every screen talks to. Screens import `useData()` — never a
 * backend directly. Two providers implement this contract:
 *   - MockProvider     (src/data/AppData.tsx)      → localStorage, seeded
 *   - SupabaseProvider (src/data/SupabaseProvider) → live backend  [TODO]
 * Selected by VITE_DATA_SOURCE. Any new method MUST be added to BOTH providers.
 */
export interface DataContextValue extends SalesSlice, TasksSlice, SettingsSlice {
  fields: Field[]
  incubators: Incubator[]
  inspections: Inspection[]
  readings: SensorReading[]
  /** Raw bee samples (lots) with x-ray grading. */
  samples: Sample[]
  /**
   * Incubation trays. NOT loaded on mount — there are thousands and most
   * screens never touch them. Call `loadTrays()` from a screen that needs them.
   */
  trays: Tray[]
  /** True while the tray list is being fetched. */
  traysLoading: boolean
  /** Fetch every tray once. Idempotent — safe to call from every screen. */
  loadTrays: () => Promise<void>
  /** Incubation batches (runs) with timeline milestones. */
  batches: IncubationBatch[]
  /**
   * Incubation alert history from the monitoring rules (temp/humidity out of
   * band, thermometer drift, Vapona sensor offline). Distinct from
   * `notifications`, which is the app-wide bell inbox.
   */
  alerts: IncubatorAlert[]

  /**
   * Log an inspection, optionally with the trays examined during it. The
   * observations are written against the new inspection's id, so the provider
   * does the linking rather than the screen.
   */
  addInspection: (input: Omit<Inspection, 'id'>, trayObservations?: TrayObservation[]) => void
  /** Trays examined during inspections (position, cells opened, stage seen). */
  trayInspections: TrayInspection[]
  /**
   * Pull inspections (and their tray observations) from BEFORE this season.
   * Hydration loads the current season only, so anything reaching further back
   * — a block's earlier runs, last year's rounds — has to ask.
   * Idempotent: the second call resolves without refetching.
   */
  loadEarlierInspections: () => Promise<void>
  /** True while that older window is being fetched. */
  earlierInspectionsLoaded: boolean

  latestReading: (incubatorId: string) => SensorReading | undefined
  /**
   * Pull this incubator's readings back to `sinceIso` and merge them in.
   * Hydration only loads a recent window per incubator (~16h of live data), so
   * anything asking for a longer span — the chart's 7D/30D/ALL ranges — must
   * request it. Idempotent: already-loaded windows resolve without refetching.
   */
  loadReadings: (incubatorId: string, sinceIso: string) => Promise<void>
  /**
   * Readings for one incubator between two instants, RETURNED rather than
   * merged into state.
   *
   * `loadReadings` is wrong for a report on two counts. It only takes a lower
   * bound, so asking for 2024 would drag every reading since into memory on top
   * of the ~16k already hydrated; and because it resolves into React state, the
   * caller that awaited it still holds the pre-load array in its closure and
   * would build the report from stale rows.
   */
  fetchReadings: (incubatorId: string, fromIso: string, toIso: string) => Promise<SensorReading[]>
  /**
   * Recorded temperature-setting changes for one incubator, oldest first.
   *
   * Same shape as `fetchReadings` and for the same reasons: bounded and
   * returned rather than merged into state. The log is written by a database
   * trigger (migration 0025), so it holds changes made from anywhere, not only
   * the ones the app performed.
   */
  fetchModeEvents: (
    incubatorId: string,
    fromIso: string,
    toIso: string,
  ) => Promise<IncubatorModeEvent[]>
  /** Persist edits to a field (geometry, shelter count, name…). */
  saveField: (id: string, patch: Partial<Field>) => void
  /**
   * Persist edits to an incubator (temp mode, targets, location…).
   * `tempMode` is operationally important: the cloud Govee poller reads it to
   * decide whether an incubator is running and therefore worth polling at the
   * fast cadence (see netlify/functions/poll-govee.mjs).
   */
  saveIncubator: (id: string, patch: Partial<Incubator>) => void
  /** Persist edits to a sample (x-ray figures, per-tray weight, notes…). */
  saveSample: (id: string, patch: Partial<Sample>) => Promise<{ ok: boolean; error?: string }>
  /**
   * Create next season's lot from a field's block returns, closing the cycle
   * from placed blocks back to the bees that go into the incubators.
   *
   * Idempotent per field and harvest season (a unique index backs it): calling
   * it twice UPDATES the lot's weight rather than making a second one, so
   * running it again after the last blocks are weighed is the intended way to
   * finish an early lot.
   */
  createLotFromReturns: (input: {
    fieldId: string
    harvestSeason: number
    name: string
    totalWeightLbs: number
    notes?: string
  }) => Promise<{ ok: boolean; sampleId?: string; created?: boolean; error?: string }>
  /**
   * Import x-ray rows, matching each BY NAME: an existing sample is updated
   * (keeping its tray links), an unknown name creates one. Mirrors the desktop
   * app's `upsert_sample_by_name`.
   */
  importSamples: (
    rows: Array<Partial<Sample> & { name: string }>,
  ) => Promise<{ updated: number; created: number; error?: string }>
  /**
   * Put a physical tray into service: link the scanned label to the sample it
   * holds and the incubator it's in.
   *
   * Upserts on `(sample_id, tray_number)` — the tray's real identity (see
   * migration 0010). Same sample, different incubator → UPDATES that row (a
   * mid-season move, not a duplicate). New sample → INSERTS a new row, so the
   * physical tray keeps its history across seasons.
   *
   * Weight comes from the sample's per-tray figure and the date is stamped
   * automatically; neither is entered by hand.
   */
  assignTray: (input: {
    trayNumber: string
    sampleId: string
    incubatorId: string
  }) => Promise<{ ok: boolean; created: boolean; error?: string }>

  // ── Crews (migration 0023) ────────────────────────────────────────────────
  /** Crews for the current season, and who is on them right now. */
  crews: Crew[]
  crewMembers: CrewMember[]
  /** Fetch crews and memberships. Idempotent. */
  loadCrews: () => Promise<void>
  /**
   * Put the signed-in user on a crew, leaving whatever crew they were on.
   * `asLead` claims the position-broadcasting role (normally the crew's iPad).
   */
  joinCrew: (crewId: string, asLead: boolean) => Promise<{ ok: boolean; error?: string }>
  /** Step off the crew. Recorded with a timestamp, never deleted. */
  leaveCrew: () => Promise<{ ok: boolean; error?: string }>
  /** Start a crew for this season. */
  createCrew: (name: string) => Promise<{ ok: boolean; crewId?: string; error?: string }>
  /**
   * Rename a crew, or retire one that is no longer running.
   *
   * Retiring sets `active` false rather than deleting: the memberships and
   * everything attributed through them are history, and deleting the crew
   * would orphan a season of work to tidy a list.
   */
  updateCrew: (id: string, patch: { name?: string; active?: boolean }) => Promise<{ ok: boolean; error?: string }>
  /**
   * Set what a crew is working on — the field and the job.
   *
   * Stored rather than inferred from whichever screen a device has open: an
   * assignment has to survive a locked iPad, a closed app and a dead battery,
   * and it can be set the night before rather than discovered at 7am.
   * Passing nulls clears it.
   */
  /**
   * Admin-only: name which member's device reports a crew's position, or move
   * somebody onto a crew, without touching that device.
   *
   * The self-service buttons need the device in your hands. An office deciding
   * on Sunday which iPad belongs to which crew, or fixing a crew whose lead
   * went home with the iPad in a pocket, cannot work that way.
   */
  setCrewLead: (crewId: string, userId: string) => Promise<{ ok: boolean; error?: string }>
  /** Admin-only: put someone on a crew (or move them), as lead or member. */
  addCrewMember: (
    crewId: string,
    userId: string,
    asLead?: boolean,
  ) => Promise<{ ok: boolean; error?: string }>
  /** Admin-only: take someone off a crew. */
  removeCrewMember: (membershipId: string) => Promise<{ ok: boolean; error?: string }>
  assignCrew: (
    id: string,
    assignment: { fieldId: string | null; task: CrewTask | null },
  ) => Promise<{ ok: boolean; error?: string }>

  // ── Calendar (migration 0029) ─────────────────────────────────────────────
  /**
   * Events people have typed. Incubation milestones are NOT in here: those are
   * derived from run start dates and shown alongside these, so that moving a
   * run moves its milestones without touching anything anyone wrote.
   */
  calendarEvents: CalendarEvent[]
  loadCalendarEvents: () => Promise<void>
  saveCalendarEvent: (
    input: Partial<CalendarEvent> & { title: string; startDate: string },
  ) => Promise<{ ok: boolean; id?: string; error?: string }>
  deleteCalendarEvent: (id: string) => Promise<{ ok: boolean; error?: string }>

  // ── Experiment notes (migration 0033) ──────────────────────────────────────
  /**
   * Observations from trials, newest first, with their blocks and trays.
   *
   * Loaded on demand rather than at sign-in: most people never open this
   * screen, and a season of notes is not worth carrying in every phone's
   * memory for the ones who do.
   */
  experimentNotes: ExperimentNote[]
  loadExperimentNotes: () => Promise<void>
  saveExperimentNote: (
    input: Partial<Omit<ExperimentNote, 'items'>> & {
      items: Array<Omit<ExperimentNoteItem, 'id' | 'noteId' | 'addedAt'>>
    },
  ) => Promise<{ ok: boolean; id?: string; error?: string }>
  deleteExperimentNote: (id: string) => Promise<{ ok: boolean; error?: string }>

  /** Alert inbox (active = not deleted), newest first. */
  notifications: AppNotification[]
  markNotificationsRead: (ids: string[]) => void
  markAllNotificationsRead: () => void
  deleteNotification: (id: string) => void
  /** Per-user alert preferences: which alert types arrive on which channel.
   *  Missing type = default (in-app on, email/push off). */
  notificationPrefs: Record<string, NotificationPref>
  saveNotificationPref: (type: string, pref: NotificationPref) => void

  /** Cost-estimator pricing forms, keyed by pricing year (spec Part 8). */
  costPrefsByYear: Record<string, Partial<CostPrefs>>
  saveCostPrefs: (year: string, prefs: Partial<CostPrefs>) => void

  // ── Bee lineage (blocks → shelters → trays → incubators, spec Part 1.3) ──
  /** Physically placed shelters (QR + GPS), as captured in the field. */
  placedShelters: PlacedShelter[]
  addPlacedShelter: (input: Omit<PlacedShelter, 'id'>) => void
  /** Tray↔shelter scan links. */
  shelterTrayLinks: ShelterTrayLink[]
  linkTrayToShelter: (input: Omit<ShelterTrayLink, 'id'>) => void
  /**
   * Put a tray out: link it to the shelter AND take it out of the incubator.
   *
   * One call because it is one event seen from two sides. Writing the link
   * without releasing the tray leaves an incubator showing trays that are
   * sitting in a field, which is the sort of wrong that survives a season.
   *
   * `moveFrom` is the shelter it was previously scanned into, when the crew
   * has confirmed moving it.
   */
  releaseTrayToShelter: (input: {
    trayId: string
    shelterId: string
    crewId?: string | null
    moveFrom?: string | null
  }) => Promise<{ ok: boolean; error?: string }>
  /** Nesting blocks (bees' homes), tied to their shelter. */
  nestingBlocks: NestingBlock[]
  addNestingBlock: (input: Omit<NestingBlock, 'id' | 'createdAt'>) => void

  // ── Nesting blocks (place → retrieve → strip, migration 0012) ────────────
  /** Physical block registry, keyed by the QR label. Loaded via loadBlocks(). */
  blocks: Block[]
  /** Per-season block records. Loaded alongside `blocks`. */
  blockPlacements: BlockPlacement[]
  blocksLoading: boolean
  /**
   * Fetch ONE season of placements (defaults to the current year) and the
   * blocks they refer to, merging into what's already loaded. Idempotent per
   * season — safe to call from every screen on every mount.
   *
   * Season-scoped because a big season runs to ~14,000 blocks: loading every
   * season to look at one would put tens of thousands of rows on a phone.
   */
  loadBlocks: (season?: number) => Promise<void>
  /**
   * Which seasons exist and how many blocks are in each — from a view, so the
   * season picker costs one small request instead of a season of rows.
   */
  blockSeasons: BlockSeason[]
  /**
   * Every season of one block, for its history view. Needed because the lists
   * only load the season on screen — without this, a block's history would
   * show the year you happened to be looking at and call it the whole story.
   */
  loadBlockHistory: (blockId: string) => Promise<void>
  /**
   * Scan 1 — put a block out in a field. Captures where it is and when.
   *
   * An unrecognised label REGISTERS a new block rather than failing: blocks
   * reach the field faster than anyone will pre-enter them, and refusing the
   * scan would stop work in its tracks.
   *
   * Upserts on `(block_id, season)`, so re-scanning a block already placed
   * this season corrects its location instead of duplicating it — while last
   * season's row stays untouched.
   */
  placeBlock: (input: {
    label: string
    fieldId: string | null
    lat: number | null
    lng: number | null
    season?: number
  }) => Promise<{
    ok: boolean
    created: boolean
    error?: string
    /** The saved placement, so the scan screen can offer to undo it. */
    placementId?: string
    /**
     * The field this block was in BEFORE, when a re-scan has just moved it.
     * Null when nothing moved. Surfaced because a whole field can be walked
     * with the wrong field selected, and silently reassigning blocks is the
     * kind of mistake nobody notices until the returns look wrong.
     */
    movedFromFieldId?: string | null
  }>
  /**
   * Undo a placement scan: delete the row, and the block registration too when
   * that scan is what created it. Refuses once the block has been weighed —
   * that is no longer an undo, it is deleting a season's data.
   */
  undoPlacement: (placementId: string) => Promise<{ ok: boolean; blockRemoved?: boolean; error?: string }>
  /**
   * Scans 2 and 3 — weigh a block full (`retrieve`) then empty (`strip`).
   * Bee return is the difference, computed on read.
   *
   * Fails on a block with no placement this season: a weight that can't be
   * attributed to a field says nothing about returns.
   */
  /**
   * Record a weigh-in or weigh-out.
   *
   * NEVER refuses for missing history. An unknown label is registered and an
   * absent placement is created, because the alternative is a crew at a
   * trailer being told no by a screen — which loses the whole day's data
   * rather than one block's. A block missing a weigh-in simply yields no
   * return; that is a small, visible loss.
   *
   * `fieldId`/`lat`/`lng` are used only when a placement has to be created.
   */
  weighBlock: (input: {
    label: string
    stage: 'retrieve' | 'strip'
    weightLbs: number
    season?: number
    fieldId?: string | null
    lat?: number | null
    lng?: number | null
  }) => Promise<{ ok: boolean; error?: string; backfilled?: boolean }>
  /** Edit a placement directly (fix a weight, move it to the right field…). */
  saveBlockPlacement: (id: string, patch: Partial<BlockPlacement>) => Promise<{ ok: boolean; error?: string }>
  /**
   * Bulk-import placements from a spreadsheet — blocks already out in the
   * field, recorded before the app was scanning them.
   *
   * Same rules as scanning, because both routes fill the same season: an
   * unknown label registers a block, and a block already placed this season is
   * UPDATED rather than duplicated. So re-running an import is safe.
   *
   * The caller plans first (see domain/blockImport) and shows that plan; this
   * only carries it out.
   */
  importBlockPlacements: (
    rows: Array<{
      label: string
      fieldId: string | null
      lat: number
      lng: number
      placedAt?: string | null
    }>,
    season: number,
  ) => Promise<{ created: number; updated: number; newBlocks: number; error?: string }>

  // ── Season analysis (0014) ───────────────────────────────────────────────
  /**
   * One row per field per season, for after-harvest analysis. NOT loaded on
   * mount — only the Analysis section reads them. Call `loadFieldAnalysis()`.
   */
  // ── Season field list (the intake that feeds everything else) ────────────
  /** Every field on record, place-level. Loaded once. */
  pollinationFields: PollinationField[]
  /** The seasons loaded so far, newest request last. Keyed by year in-app. */
  fieldSeasons: FieldSeason[]
  seasonsLoading: boolean
  loadFieldSeasons: (year: string) => Promise<void>
  /**
   * Add a field to a season, creating the FIELD itself if the name is new.
   * Returns the season row so the caller can keep editing it.
   */
  addFieldSeason: (input: {
    year: string
    name: string
    grower?: string
    region?: string
    lld?: string
    company?: string
    crop?: string
    acres?: number | null
    plannedShelters?: number | null
  }) => Promise<{ ok: boolean; error?: string; season?: FieldSeason }>
  /** Edit one season's intake. Only the keys passed are written. */
  saveFieldSeason: (
    id: string,
    patch: Partial<Pick<FieldSeason, 'company' | 'crop' | 'acres' | 'plannedShelters' | 'status' | 'notes'>>,
  ) => Promise<{ ok: boolean; error?: string }>
  /** Drop a field from a season. The FIELD stays; only this year's plan goes. */
  removeFieldSeason: (id: string) => Promise<{ ok: boolean; error?: string }>
  /**
   * Copy fields forward into a new season. Geometry is deliberately NOT copied
   * here — that is its own question, asked per field with a preview.
   */
  copySeasonForward: (input: {
    fromYear: string
    toYear: string
    fieldIds: string[]
  }) => Promise<{ ok: boolean; error?: string; created: number }>

  // ── Overall Checklist (field × season step) ──────────────────────────────
  /** Marks for the loaded season. Loaded per year, like blocks. */
  fieldChecklist: FieldChecklistCell[]
  fieldChecklistLoading: boolean
  loadFieldChecklist: (year: string) => Promise<void>
  /**
   * Set a cell. Upserts on (year, field_name, step): a mark is one row per
   * field per step per season, so ticking twice must update rather than
   * accumulate. Passing `null` for a date clears it.
   */
  /**
   * Run the Google Sheets sync for a season, now. The schedule already runs it
   * every half hour; this is for when someone has just edited the sheet and
   * does not want to wait. Returns how many marks moved each way.
   */
  syncChecklistSheet: (year: string) => Promise<{ ok: boolean; error?: string; toApp?: number; toSheet?: number }>
  saveChecklistCell: (input: {
    year: string
    fieldName: string
    step: string
    shelterFieldId?: string | null
    plannedDate?: string | null
    completedDate?: string | null
    note?: string
  }) => Promise<{ ok: boolean; error?: string }>
  fieldAnalysis: FieldAnalysis[]
  fieldAnalysisLoading: boolean
  /** Fetch every analysis row once. Idempotent — safe to call from any screen. */
  loadFieldAnalysis: () => Promise<void>
  /**
   * Season weather per field, keyed by `weatherKey(lat, lng, year)`.
   * Populated by `loadFieldWeather`; empty until then.
   */
  fieldWeather: Record<string, FieldWeather>
  /**
   * Fetch and cache season weather for the given field-seasons.
   *
   * Deduplicates by rounded coordinate before going out, so the six analysis
   * panels that all want weather for the same 157 fields cause one round of
   * work rather than six. Rows without coordinates are skipped, not guessed.
   */
  loadFieldWeather: (
    rows: ReadonlyArray<Pick<FieldAnalysis, 'lat' | 'lng' | 'year'>>,
  ) => Promise<void>
  /**
   * Edit one analysis row in place.
   *
   * Analysis data normally arrives by import, but coordinates are the
   * exception: 9 of the 157 imported field-seasons have none, and a row without
   * lat/lng is invisible on the map and carries no weather. Those are fixed by
   * hand rather than by re-cutting the spreadsheet.
   */
  saveFieldAnalysis: (
    id: string,
    patch: Partial<FieldAnalysis>,
  ) => Promise<{ ok: boolean; error?: string }>
  /**
   * Replace a season's analysis rows from an uploaded CSV.
   *
   * Upserts on `(field_name, year)` — the natural key — so re-uploading a
   * corrected sheet updates in place rather than duplicating the season.
   */
  importFieldAnalysis: (
    rows: ReadonlyArray<Record<string, unknown>>,
  ) => Promise<{ inserted: number; updated: number; skipped: number; error?: string }>

  // ── Grants (funding pipeline) ────────────────────────────────────────────
  grants: Grant[]
  /** Returns the new grant's id so the UI can open it immediately. */
  addGrant: (input: Partial<Grant> & { title: string }) => Promise<string> | string
  updateGrant: (id: string, patch: Partial<Grant>) => void
  deleteGrant: (id: string) => void
  /** Assignable work items / subtasks per grant. */
  grantTasks: GrantTask[]
  addGrantTask: (input: Omit<GrantTask, 'id' | 'createdAt'>) => void
  updateGrantTask: (id: string, patch: Partial<GrantTask>) => void
  deleteGrantTask: (id: string) => void
}

/** What every sales mutation returns. */
export interface SalesResult {
  ok: boolean
  error?: string
}

/**
 * Sales: estimates, invoices, shipping paperwork, finished-goods inventory
 * (migration 0015).
 *
 * Kept as its own interface, and implemented by `useSalesMock` /
 * `useSalesSupabase` rather than inline in the providers — the two provider
 * files are already ~400 and ~1000 lines, and this slice is self-contained.
 * Both providers spread the same shape in, so the seam rule still holds.
 */
export interface SalesSlice {
  products: Product[]
  itemSpecs: ItemSpecRow[]
  salesCustomers: SalesCustomer[]
  suppliers: Supplier[]
  salesOrders: SalesOrder[]
  shipments: Shipment[]
  inventory: InventoryLevel[]
  stockMovements: StockMovement[]

  /** NOT loaded on mount — only the Sales section reads any of it. */
  salesLoading: boolean
  /** Fetch the whole sales slice once. Idempotent. */
  loadSales: () => Promise<void>

  /**
   * Bee larvae purchases, newest first. QuickBooks-synced rows and hand-typed
   * history in one list — see `src/domain/beePurchases.ts` for why they share
   * a shape, and why `gallons` may be null but is never 0.
   */
  beePurchases: BeePurchase[]
  addBeePurchase: (input: Partial<BeePurchase>) => Promise<{ ok: boolean; id?: string; error?: string }>
  saveBeePurchase: (id: string, patch: Partial<BeePurchase>) => Promise<SalesResult>
  deleteBeePurchase: (id: string) => Promise<SalesResult>
  /** Pull a season from QuickBooks now, rather than waiting for the weekly run. */
  syncBeePurchases: (season?: number) => Promise<{
    ok: boolean
    error?: string
    lines?: number
    gallons?: number
    amount?: number
    linesWithoutGallons?: number
  }>

  saveProduct: (id: string, patch: Partial<Product>) => Promise<SalesResult>
  saveSalesCustomer: (id: string, patch: Partial<SalesCustomer>) => Promise<SalesResult>
  addSalesCustomer: (input: Partial<SalesCustomer>) => Promise<{ ok: boolean; id?: string; error?: string }>

  /** Create an estimate or invoice. Returns the new id so the UI can open it. */
  createOrder: (
    input: Partial<SalesOrder> & { kind: OrderKind },
  ) => Promise<{ ok: boolean; id?: string; error?: string }>
  /** Patch an order's header, lines and/or charges. Lines replace wholesale. */
  saveOrder: (
    id: string,
    patch: Partial<SalesOrder>,
    lines?: SalesOrderLine[],
    charges?: SalesOrderCharge[],
  ) => Promise<SalesResult>
  deleteOrder: (id: string) => Promise<SalesResult>

  /**
   * Turn an accepted estimate into an invoice.
   *
   * Copies the lines with their PRICES AS QUOTED, rather than re-pricing from
   * the catalogue — the customer accepted a number and that is the number they
   * get billed, even if a BOM changed in between. The estimate survives,
   * linked by `fromEstimateId`.
   *
   * Reserves stock for every line: see `markShipped` for the other half.
   */
  convertEstimateToInvoice: (
    estimateId: string,
  ) => Promise<{ ok: boolean; id?: string; error?: string }>

  /**
   * Record that an invoice physically shipped, which COMMITS the stock draw.
   *
   * Reserved quantity moves out of `onHand`. Packing figures are frozen on the
   * shipment row so the paperwork keeps matching what went on the truck.
   */
  markShipped: (
    orderId: string,
    input: {
      carrier?: string
      tracking?: string
      palletCount?: number | null
      netWeightLbs?: number | null
      grossWeightLbs?: number | null
      notes?: string
    },
  ) => Promise<SalesResult>

  /** Receive, count, or correct stock. Journalled in `stockMovements`. */
  adjustStock: (input: {
    productId: string
    delta: number
    reason: StockReason
    note?: string
  }) => Promise<SalesResult>
  /** Set (or clear, with null) the level that triggers a low-stock alert. */
  setReorderPoint: (productId: string, reorderPoint: number | null) => Promise<SalesResult>
  /** Add or update a shipping spec — how an item pallets and what it weighs. */
  saveItemSpec: (item: string, patch: Partial<ItemSpecRow>) => Promise<SalesResult>
}

export const DataContext = createContext<DataContextValue | null>(null)

export function useData(): DataContextValue {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData must be used within a data provider')
  return ctx
}

// The provider component itself lives in AppData.tsx (picks mock vs supabase).
export { DataProvider } from './AppData'

/**
 * Tasks and checklists (migration 0016).
 *
 * A checklist RUN is a task with `checklistId` set, so there is one list of
 * tasks, not two. Implemented by `useTasksMock` / `useTasksSupabase`.
 */
export interface TasksSlice {
  /** Tasks and checklist runs, newest first. */
  tasks: Task[]
  /** Reusable checklist templates, with their steps. */
  checklists: Checklist[]
  tasksLoading: boolean
  /** NOT loaded on mount — only the Tasks section reads it. Idempotent. */
  loadTasks: () => Promise<void>
  /**
   * How many field actions are queued offline and not yet synced. 0 when
   * everything has landed. Drives the "N not synced" indicator.
   */
  pendingSync: number

  createTask: (input: Partial<Task> & { title: string }) => Promise<{ ok: boolean; id?: string; error?: string }>
  saveTask: (id: string, patch: Partial<Task>) => Promise<SalesResult>
  deleteTask: (id: string) => Promise<SalesResult>
  /**
   * Complete, reopen, or cancel a task.
   *
   * Completing a RECURRING task also creates its next occurrence — that is what
   * makes it recur. Works offline: the change is applied locally and queued.
   */
  setTaskStatus: (id: string, status: TaskStatus) => Promise<SalesResult>

  addStep: (taskId: string, title: string) => Promise<SalesResult>
  saveStep: (stepId: string, patch: Partial<TaskStep>) => Promise<SalesResult>
  /** Tick or un-tick a step. Works offline — the core field action. */
  setStepComplete: (stepId: string, complete: boolean) => Promise<SalesResult>
  deleteStep: (stepId: string) => Promise<SalesResult>

  createChecklist: (
    input: Partial<Checklist> & { name: string },
  ) => Promise<{ ok: boolean; id?: string; error?: string }>
  saveChecklist: (id: string, patch: Partial<Checklist>) => Promise<SalesResult>
  deleteChecklist: (id: string) => Promise<SalesResult>
  /**
   * Put a checklist to work: creates a task from the template, COPYING its
   * steps. Editing the template afterwards must not rewrite a run somebody is
   * partway through.
   */
  assignChecklist: (input: {
    checklistId: string
    assigneeId: string | null
    dueDate?: string | null
    title?: string
  }) => Promise<{ ok: boolean; id?: string; error?: string }>
}
