import type { CrewTask } from '@/domain/supplies'
/** Shared domain types for TNT Operations. Backend-agnostic. */
import type { GrantStatus } from '@/domain/grants'

export type { GrantStatus }

export type ShapeType = 'pivot' | 'polygon'

/**
 * Full field-authoring definition (pivot/boundary, bay layout, tracks, shelter
 * mode…) — the raw dict the shelter-grid engine `getTentPositions` consumes.
 * Loosely typed on purpose; it mirrors the old app's field JSON and is stored in
 * the Supabase `fields.data` jsonb column.
 */
export type FieldGeometry = Record<string, unknown>

/** A pollination field with placed bee-shelter positions (Shelter Maps section). */
export interface Field {
  id: string
  name: string
  client: string
  region: string
  shapeType: ShapeType
  shelterCount: number
  /** ISO UTC. */
  updatedAt: string
  /** Full authoring geometry for map rendering; absent until a field is drawn/imported. */
  geometry?: FieldGeometry
}

export type IncubatorStatus = 'active' | 'idle'

/** A leafcutter-bee incubator (Incubation section). */
export interface Incubator {
  id: string
  name: string
  location: string
  status: IncubatorStatus
  /** ISO UTC when the current incubation batch started (null when idle). */
  startedAt: string | null
  tempTargetC: number
  humidityTargetPct: number
  // ── Live-DB fields (present in supabase mode; optional so mock stays simple) ──
  /** Temperature mode: 'off' | 'cool_storage' | 'incubation' | 'holding'. */
  tempMode?: string | null
  humidityMin?: number | null
  humidityMax?: number | null
  /** Date the incubation run started (date-only from the old app). */
  incubationStart?: string | null
  /**
   * Sensibo device id(s) for this incubator's heat pump(s), comma-separated.
   * An incubator can have more than one AC head, controlled together.
   */
  sensiboDeviceId?: string | null
  capacity?: number | null
  /**
   * Sensor link state, written by the Govee poller.
   *
   * The H5100 reports no battery level, so whether it is reachable is the only
   * health signal there is — and since these sensors stop answering rather
   * than fading, it is a decent proxy for one.
   */
  goveeLinked?: boolean
  /** Null means nobody has polled it yet, which is not the same as offline. */
  sensorOnline?: boolean | null
  sensorSeenAt?: string | null
  sensorCheckedAt?: string | null
}

/** Time-of-day slot for a routine inspection (matches the old app's schema). */
export type InspectionPeriod = 'morning' | 'evening' | 'manual'

export interface Inspection {
  id: string
  incubatorId: string
  /** ISO UTC. */
  at: string
  inspector: string
  /** 0–100 subjective health score. Legacy/optional — the real checklist below
   *  is the operational record; imported rows carry 0 here. */
  healthScore: number
  notes: string
  // ── Rich checklist (ported from the original bee-incubation app) ─────────────
  /** morning / evening routine, or an ad-hoc `manual` check. */
  period?: InspectionPeriod
  /** Hand thermometer reading (°C) taken during the inspection. */
  thermometerTempC?: number | null
  /** The Govee sensor's reading (°C) at inspection time, for comparison. */
  goveeTempC?: number | null
  /** thermometer − govee (°C); surfaces sensor drift. */
  tempDiffC?: number | null
  /** Set when the thermometer/Govee gap is large enough to flag. */
  tempAlert?: boolean
  heatPumpsOk?: boolean
  parasitesEmerging?: boolean
  beesEmerging?: boolean
  fansOk?: boolean
  blackLightsOk?: boolean
  /** Optional link to an incubation batch. */
  batchId?: string | null
}

/** A raw bee sample (lot) with x-ray grading and derived tray math. */
export interface Sample {
  id: string
  name: string
  source: string
  lotNumber: string
  xrayLivePct: number | null
  xrayParasitePct: number | null
  xrayDeadPct: number | null
  totalVolumeGal: number | null
  totalWeightLbs: number | null
  totalWeightKg: number | null
  liveBeesPerLb: number | null
  liveBeesPerKg: number | null
  parasites: number | null
  chalkbrood: number | null
  totalTrays: number | null
  incubatorSpace: number | null
  /** Pounds of raw sample per 2-gal tray — the per-tray weight the scan flow
   *  stamps onto a tray. Stored (not derived): no sample carries xrayLivePct. */
  lbsPer2Gal: number | null
  kgPer2Gal: number | null
  notes: string
  importDate: string | null
  /**
   * The field whose block returns produced this lot, and the season they were
   * harvested. Null on bought-in lots and on everything imported from the old
   * app — "not recorded", never "unknown field".
   *
   * A lot harvested in 2026 goes out in 2027; the harvest year is stored
   * because that is what ties it to the returns it can be checked against.
   */
  fieldId: string | null
  harvestSeason: number | null
}

/** A single incubation tray (mostly historical/released in the current data). */
export interface Tray {
  id: string
  trayNumber: string
  sampleId: string | null
  incubationBatchId: string | null
  incubatorId: string | null
  weightLbs: number | null
  liveCount: number | null
  parasiteLevelPct: number | null
  volumeGal: number | null
  inDate: string | null
  outDate: string | null
  coolDate: string | null
  status: string
  notes: string
}

/** An incubation batch (run) with its timeline milestones. */
export interface IncubationBatch {
  id: string
  incubatorId: string | null
  sampleId: string | null
  name: string
  startDate: string | null
  vaponaIn: string | null
  vaponaOut: string | null
  airOut: string | null
  male10pctEmergence: string | null
  earliestCool: string | null
  estimatedRelease: string | null
  latestRelease: string | null
  status: string
  notes: string
}

// ── Bee lineage (spec Part 1.3): blocks → shelters → trays → incubators ──────

/** A physically placed shelter in a field (QR + GPS), as scanned by a crew. */
export interface PlacedShelter {
  /** The crew that placed it. Null on work done before crews existed,
   *  or by anyone not on one — "not recorded", never "no crew". */
  crewId?: string | null
  id: string
  fieldId: string | null
  qrCode: string | null
  /** Computed grid pin this placement corresponds to (null = manual/extra). */
  gridIdx: number | null
  lat: number | null
  lng: number | null
  /** ISO UTC. */
  placedAt: string
  placedBy: string
  status: string
  notes: string
}

/** A tray scanned into a placed shelter (the tray↔shelter lineage link). */
export interface ShelterTrayLink {
  id: string
  shelterId: string
  trayId: string
  /** ISO UTC. */
  scannedAt: string
  scannedBy: string
}

/** A nesting block (where the bees actually live), tied to its shelter. */
export interface NestingBlock {
  id: string
  qrCode: string | null
  shelterId: string | null
  notes: string
  /** ISO UTC. */
  createdAt: string
}

// ── Nesting blocks (place → retrieve → strip; see migration 0012) ────────────

/**
 * A physical nesting block, identified by the QR label printed on it.
 * Permanent and reused every season — the per-season record is BlockPlacement.
 *
 * Distinct from `NestingBlock` above, which is the unused 0008 stub (no
 * location, no weights, hung off a shelter) kept only for LineageHome.
 */
export interface Block {
  id: string
  /** What the QR encodes; the block's permanent identity. */
  label: string
  notes: string
  /** ISO UTC. */
  createdAt: string
}

/** How far through the place → retrieve → strip cycle a placement has got. */
export type BlockStage = 'placed' | 'retrieved' | 'stripped'

/**
 * One season's use of one block, built up by three scans in the field:
 * placed (field + GPS), retrieved (gross weight), stripped (empty weight).
 */
export interface BlockPlacement {
  id: string
  blockId: string
  /** Calendar year — one placement per block per season. */
  season: number
  fieldId: string | null
  /** Reserved for placing blocks into a specific shelter later. */
  shelterId: string | null
  lat: number | null
  lng: number | null
  /** ISO UTC. */
  placedAt: string | null
  placedBy: string
  /** ISO UTC. */
  retrievedAt: string | null
  /** Weighed with the bee material still in it. */
  grossWeightLbs: number | null
  retrievedBy: string
  /** ISO UTC. */
  strippedAt: string | null
  /** Weighed after the bee material was removed. */
  strippedWeightLbs: number | null
  strippedBy: string
  notes: string
}

// ── Season analysis (ported from the Leaf Bee Insights Base44 app) ──────────

/**
 * One field's record for one season, for after-harvest analysis.
 *
 * NOTE the naming. Every other type here is camelCase, mapped from snake_case
 * columns. This one keeps the database's own column names, on purpose:
 *
 * The analysis screens never write `row.livePrepupae`. They iterate the metric
 * registry in `src/domain/analysisMetrics.ts` and read `row[metric.key]`,
 * because "which metric" is a runtime choice made by the person looking at the
 * chart. Renaming the columns would mean carrying a 40-entry translation table
 * between the registry, the SQL and the CSV headers, and every one of those
 * three would be a place for a typo to silently produce an empty chart.
 *
 * So: a wide statistical record addressed by column key, not a domain object.
 * `field_analysis` rows are read-only in the app — they arrive by import.
 */
export interface FieldAnalysis {
  id: string

  // Identity
  field_name: string
  year: string
  company: string
  crop: string
  /** The seed company's own field number, not ours. */
  field_id: string
  variety_code: string
  farmer_name: string
  /** Set where a season row could be matched to an operational field. */
  shelter_field_id: string | null

  // Field & planting layout
  acres: number | null
  lat: number | null
  lng: number | null
  planting_pattern: string
  male_row_spacing: number | null
  female_row_spacing: number | null
  male_rows: number | null
  female_rows: number | null
  shelters_per_acre: number | null
  num_structures: number | null
  blocks_per_shelter: number | null
  sprayer_width: number | null
  seeding_angle: number | null

  // Bee logistics
  gallons_put_out: number | null
  gallons_returned: number | null
  gals_per_acre: number | null
  pounds: number | null
  percent_return: number | null
  live_count: number | null

  // X-ray grading — percent units (0–100). These 11 sum to ~100; see
  // src/domain/analysisRelations.ts for why that matters when correlating.
  live_prepupae: number | null
  immature_larvae: number | null
  dead_prepupae: number | null
  dead_larvae: number | null
  pollen_balls: number | null
  second_generation: number | null
  predators_and_pests: number | null
  parasites: number | null
  chalkbrood_sporulating: number | null
  chalkbrood_non_sporulating: number | null
  machine_damage: number | null
  sex_ratio_test_viability: number | null
  percent_female: number | null
  percent_male: number | null

  // Timeline (ISO dates, no time component)
  seeding_date: string | null
  predicted_flower_date: string | null
  actual_bee_release: string | null
  bees_brought_back_in: string | null

  // Outcome — recorded on only about a fifth of rows.
  clean_weight_yield: number | null
  yield_per_acre: number | null
  avg_for_variety: number | null

  // Excluded from analysis by default via the settings toggles.
  hail_damage: boolean
  bad_recording: boolean
  experimental: boolean

  notes: string
}

/** Season weather for one field, derived from the cached Open-Meteo response. */
export interface FieldWeather {
  /** `${lat_key},${lng_key},${year}` — matches how the cache is keyed. */
  key: string
  year: string
  avgTemp: number | null
  maxTemp: number | null
  minTemp: number | null
  totalPrecip: number | null
  avgWind: number | null
  growingDegreeDays: number | null
  rainDays: number | null
  /** Days warm, dry and calm enough for leafcutters to work. */
  flightHours: number | null
}

// ── Grants (funding pipeline; mirrors the RVR Management App) ────────────────

/** A funding opportunity we're tracking through the application workflow. */
export interface Grant {
  id: string
  title: string
  funder: string | null
  url: string | null
  status: GrantStatus
  amountMin: number | null
  amountMax: number | null
  eligibilitySummary: string | null
  summary: string | null
  /** Our notes (markdown-ish free text). */
  notesMd: string | null
  opensOn: string | null
  closesOn: string | null
  region: string | null
  categories: string[]
  assignedTo: string | null
  /** 'manual' (added by hand) | 'auto' (weekly Claude web-search pull). */
  source: string
  /** ISO UTC. */
  createdAt: string
}

/** An assignable work item / subtask on a grant application. */
export interface GrantTask {
  id: string
  grantId: string
  title: string
  /** 'open' | 'done'. */
  status: string
  assignedTo: string | null
  /** ISO UTC. */
  createdAt: string
}

export type NotificationSeverity = 'info' | 'warning' | 'critical'

/** An alert shown in the notification view (integration health, thresholds, …). */
/**
 * An incubation alert raised by the monitoring rules (temp/humidity out of
 * band, inspection thermometer drift, Vapona sensor offline…).
 *
 * Distinct from `AppNotification`: this is the incubation-domain alert history
 * carried over from the original bee-incubation app (`public.alerts`), whereas
 * AppNotification is the app-wide inbox behind the bell.
 */
export interface IncubatorAlert {
  id: string
  alertType: string
  severity: NotificationSeverity
  incubatorId: string | null
  trayId: string | null
  batchId: string | null
  message: string
  /** ISO UTC. */
  triggeredAt: string
  acknowledged: boolean
  /** ISO UTC when acknowledged, or null. */
  acknowledgedAt: string | null
  notified: boolean
}

export interface AppNotification {
  id: string
  category: string
  type: string
  severity: NotificationSeverity
  title: string
  body: string
  source: string
  /** ISO UTC. */
  createdAt: string
  /** ISO UTC when read, or null if unread. */
  readAt: string | null
}

/**
 * One tray examined during an incubator inspection: where it was pulled from,
 * how many cells were opened, and the developmental stage seen inside.
 * Belongs to a parent `Inspection` via `inspectionId`.
 */
export interface TrayInspection {
  id: string
  inspectionId: string | null
  trayId: string | null
  /** Denormalised on the row, so a reading survives a missing tray link. */
  trayNumber: string | null
  incubatorId: string | null
  /** ISO UTC. */
  at: string | null
  /** Top | Middle | Bottom. */
  stackPosition: string | null
  /** Front | Middle | Back. */
  depthPosition: string | null
  cellsOpened: number | null
  /** One of DEV_STAGES — the label is the stored value. */
  devStage: string | null
  notes: string
}

/**
 * A recorded change of an incubator's temperature setting.
 *
 * Written by a database trigger on `incubators.temp_mode` (migration 0025), so
 * it captures a change made anywhere — the modal, a script, the SQL editor —
 * not only the ones an app code path remembered to log.
 */
export interface IncubatorModeEvent {
  id: string
  incubatorId: string
  /** Null on the first record for an incubator: nothing to have changed from. */
  fromMode: string | null
  toMode: string
  /** ISO UTC. For a backfilled row this is when LOGGING began, not when set. */
  changedAt: string
  changedBy: string | null
  /** True for the seed row written when logging began — its date is unknown. */
  backfilled: boolean
  note: string
}

export type SensorSource = 'govee' | 'esp32'

export interface SensorReading {
  id: string
  incubatorId: string
  /** ISO UTC. */
  at: string
  tempC: number
  humidityPct: number
  source: SensorSource
}

// ═══════════════════════════════════════════════════════════════════════════
// Sales — estimates, invoices, shipping paperwork, finished-goods inventory
// (migration 0015). Math lives in domain/{pricing,packing,salesDocs}.ts.
// ═══════════════════════════════════════════════════════════════════════════

/** A sellable product and how it is costed. */
export interface Product {
  id: string
  sku: string
  name: string
  currency: import('@/domain/pricing').Currency
  /** Unit of sale — 'each', 'ft', 'set'. Prints on the paperwork. */
  unit: string
  labor: number
  /** Fraction, not percent: 0.5 is a 50% markup on cost. */
  markup: number
  /** Round the sale price UP to this increment; null quotes the exact figure. */
  roundTo: number | null
  /** Joins to `ItemSpec.item` for pallet/weight math. Null = never ships alone. */
  shipItem: string | null
  /** Null is honest — salesDocs reports it missing rather than guessing. */
  hsCode: string | null
  countryOfOrigin: string | null
  active: boolean
  notes: string
  /** BOM lines, in display order. */
  parts: ProductPart[]
  /** Volume breaks, for goods sold by the foot. */
  tiers: ProductTier[]
}

/** One BOM line. `unitCost: null` means uncosted — flagged, never treated as free. */
export interface ProductPart {
  id: string
  part: string
  qty: number
  unitCost: number | null
  /** Freight for this part line, per FINISHED unit (the sheet's `=(B*C)+D`). */
  freightPerUnit: number
  note: string
  sort: number
}

export interface ProductTier {
  id: string
  minQty: number
  unitCost: number
}

/** Weight and dimensions for one shippable item — the `Item Specs` sheet. */
export interface ItemSpecRow {
  id: string
  item: string
  weightLbs: number
  lengthIn: number
  widthIn: number
  heightIn: number
  /** Height each NESTED item adds — not the standing height. */
  stackedHeightIn: number
  maxItemsOnPallet: number
  palletSize: string
  stacksPerPallet: number
}

export interface SalesCustomer {
  id: string
  company: string
  contactName: string
  addressLines: string[]
  city: string
  region: string
  postalCode: string
  /** ISO 3166-1 alpha-2. Decides which paperwork a shipment needs. */
  country: string
  /** BN (Canada) or EIN (US). */
  taxId: string
  email: string
  phone: string
  gpsLink: string
  notes: string
}

export interface Supplier {
  id: string
  part: string
  forItem: string
  company: string
  contactName: string
  email: string
  phone: string
  website: string
  notes: string
}

export type OrderKind = 'estimate' | 'invoice'
export type OrderStatus =
  | 'draft'
  | 'sent'
  | 'accepted'
  | 'declined'
  | 'invoiced'
  | 'shipped'
  | 'paid'
  | 'void'

/**
 * An estimate or an invoice. Accepting an estimate spawns a NEW invoice linked
 * by `fromEstimateId` rather than mutating in place — the quote and the bill
 * are separate documents and both need to survive.
 */
export interface SalesOrder {
  id: string
  number: string
  kind: OrderKind
  status: OrderStatus
  fromEstimateId: string | null
  customerId: string | null
  currency: import('@/domain/pricing').Currency
  /** Rate this order was written at, if converted. Kept so it can be re-read. */
  fxRate: number | null
  /** ISO date. */
  issuedDate: string
  dueDate: string | null
  poNumber: string

  // Customs and freight terms. All optional — salesDocs reports what's missing.
  incoterm: import('@/domain/salesDocs').Incoterm | null
  incotermPlace: string
  paymentTerms: string
  transportMode: import('@/domain/salesDocs').TransportMode | null
  placeOfDirectShipment: string
  countryOfTranshipment: string
  reasonForExport: string
  dateOfDirectShipment: string | null

  carrier: string
  freightTerms: 'prepaid' | 'collect' | 'third-party' | null
  declaredValue: number | null
  specialInstructions: string

  /** Set only when claiming CUSMA preference — see salesDocs. */
  certifierRole: 'importer' | 'exporter' | 'producer' | null
  producer: string
  signatoryName: string
  signatoryTitle: string

  notes: string
  createdAt: string
  updatedAt: string

  lines: SalesOrderLine[]
  charges: SalesOrderCharge[]
}

/**
 * A priced line. Pricing is a SNAPSHOT taken when the line was added: re-costing
 * a BOM must not restate an invoice that already went to a customer, and a
 * customs document has to keep saying what it said when it was filed.
 */
export interface SalesOrderLine {
  id: string
  /** Soft reference — the catalogue can change without rewriting history. */
  productId: string | null
  description: string
  qty: number
  unit: string
  unitPrice: number
  unitCost: number
  extended: number
  hsCode: string | null
  countryOfOrigin: string | null
  originCriterion: 'A' | 'B' | 'C' | 'D' | null
  /** Which `ItemSpecRow.item` this packs as, frozen with the price. */
  shipItem: string | null
  sort: number
}

export interface SalesOrderCharge {
  id: string
  label: string
  amount: number
  /** Billed at cost, no margin. */
  passThrough: boolean
  /** Transport from the place of direct shipment — CI1 box 23 breaks this out. */
  isTransportToBorder: boolean
  sort: number
}

/** Marking a shipment is what COMMITS the stock draw-down. */
export interface Shipment {
  id: string
  orderId: string
  /** ISO UTC. */
  shippedAt: string
  carrier: string
  tracking: string
  /** Packing figures frozen at ship time, so paperwork keeps matching the truck. */
  palletCount: number | null
  netWeightLbs: number | null
  grossWeightLbs: number | null
  notes: string
}

/** Finished-goods stock. Raw parts are costed in the BOM but not stocked. */
export interface InventoryLevel {
  id: string
  productId: string
  onHand: number
  /** Spoken for by an invoice that hasn't shipped. */
  reserved: number
  /** onHand − reserved. Generated in the DB so nobody computes it differently. */
  available: number
  /** Below this, raise a low_stock notification. Null disables the alert. */
  reorderPoint: number | null
  location: string
  updatedAt: string
}

export type StockReason = 'receive' | 'ship' | 'adjust' | 'reserve' | 'release' | 'count' | 'build'

/** Why a count is what it is. Inventory is an audit trail with a running total. */
export interface StockMovement {
  id: string
  productId: string
  /** Signed: +50 received, −20 shipped. */
  delta: number
  reason: StockReason
  orderId: string | null
  note: string
  /** ISO UTC. */
  at: string
}

// ═══════════════════════════════════════════════════════════════════════════
// Tasks and checklists (migration 0016).
//
// A checklist RUN is a task: same row, with `checklistId` set. "Subtask" and
// "checklist step" are one mechanism — see the migration header.
// ═══════════════════════════════════════════════════════════════════════════

export type TaskPriority = 'low' | 'normal' | 'high'
export type TaskStatus = 'open' | 'in_progress' | 'done' | 'cancelled'

/** A reusable checklist template. */
export interface Checklist {
  id: string
  name: string
  description: string
  /** Free-text grouping: 'Field', 'Shop', 'Season start'. */
  category: string
  active: boolean
  createdBy: string | null
  steps: ChecklistStep[]
}

/** A template step. Ordered but not gated — see the migration header. */
export interface ChecklistStep {
  id: string
  title: string
  notes: string
  sort: number
  required: boolean
}

/** A task, or — when `checklistId` is set — a run of that checklist. */
export interface Task {
  id: string
  title: string
  notes: string
  /** Set ⇒ this is a checklist run. */
  checklistId: string | null
  assigneeId: string | null
  createdBy: string | null
  /** A CALENDAR DATE (`YYYY-MM-DD`), deliberately not an instant. */
  dueDate: string | null
  priority: TaskPriority
  status: TaskStatus
  /** ISO UTC — completion IS an instant. */
  completedAt: string | null
  completedBy: string | null

  /** Null ⇒ one-off. */
  recurUnit: import('@/domain/tasks').RecurUnit | null
  recurInterval: number
  recurAnchor: import('@/domain/tasks').RecurAnchor
  /** Weekly only, 0 = Sunday. */
  recurWeekdays: number[]
  recurUntil: string | null
  recurParentId: string | null

  /** Lead time for the "due soon" alert. */
  remindDaysBefore: number

  createdAt: string
  updatedAt: string
  steps: TaskStep[]
}

/** A subtask / checklist step on a live task. */
export interface TaskStep {
  id: string
  taskId: string
  title: string
  notes: string
  sort: number
  required: boolean
  /** Optional — a step can belong to someone other than the task's assignee. */
  assigneeId: string | null
  completedAt: string | null
  completedBy: string | null
  sourceStepId: string | null
}

// ═══════════════════════════════════════════════════════════════════════════
// Settings, company and signatures (migrations 0017–0019)
// ═══════════════════════════════════════════════════════════════════════════

/** Company facts that print as the vendor on customs paperwork. */
export interface CompanyDetails {
  legalName: string
  tradeName: string
  addressLines: string[]
  city: string
  region: string
  postalCode: string
  country: string
  /** Business Number. */
  businessNumber: string
  gstNumber: string
  phone: string
  email: string
  website: string
  /** Default CUSMA signatory, used when an order doesn't name its own. */
  signatoryName: string
  signatoryTitle: string
}

/**
 * A user's own signature image. PRIVATE — RLS on `user_signatures` is
 * owner-only, so this is only ever your own, never another user's.
 */
export interface UserSignature {
  userId: string
  /** A data: URL. */
  image: string
  title: string
  updatedAt: string
}

/**
 * The record of a signature having been applied to a document.
 *
 * Append-only and immutable: a signature is voided, never edited or deleted,
 * because destroying the record destroys the evidence it happened.
 */
export interface DocumentSignature {
  id: string
  documentKind: string
  documentId: string
  documentRef: string
  signerId: string | null
  /** Denormalised at signing time — the record must survive a rename. */
  signerName: string
  signerEmail: string
  signerTitle: string
  /** ISO UTC, set by the database clock, never the browser's. */
  signedAt: string
  /** SHA-256 of the canonical form of what was signed. */
  contentHash: string
  attestation: string
  /** A copy of the image as it looked when applied. */
  signatureImage: string
  ipAddress: string | null
  userAgent: string | null
  voidedAt: string | null
  voidReason: string
}

/** QuickBooks connection state, from the `qbo_status` view. Never the tokens. */
export interface QboStatus {
  realmId: string
  companyName: string
  environment: string
  homeCurrency: string
  multicurrencyEnabled: boolean
  defaultTaxCodeId: string | null
  exemptTaxCodeId: string | null
  shippingItemId: string | null
  incomeAccountId: string | null
  connected: boolean
  expiringSoon: boolean
  refreshTokenExpiresAt: string
  lastError: string
}

/** A person hidden from the app but whose history is kept. */
export interface ArchivedUser {
  id: string
  name: string
  email: string
  role: string
  archivedAt: string
}

/** One row per season from the `block_seasons` view (migration 0021). */
export interface BlockSeason {
  season: number
  placed: number
  retrieved: number
  stripped: number
}

/** Google Calendar connection state, from the `gcal_status` view. No tokens. */
export interface GcalStatus {
  googleEmail: string
  calendarId: string | null
  syncEnabled: boolean
  lastSyncedAt: string | null
  lastError: string
  connected: boolean
}

/** The subscribable calendar feed. The token IS the credential — see 0023. */
export interface CalendarFeed {
  token: string
  enabled: boolean
  lastFetchedAt: string | null
  fetchCount: number
}

/**
 * A calendar entry somebody typed, as opposed to an incubation milestone,
 * which is derived from a run's start date and cannot be edited.
 */
export interface CalendarEvent {
  id: string
  title: string
  /** Local calendar date, YYYY-MM-DD. */
  startDate: string
  /** Last day for a multi-day event; null for a single day. */
  endDate: string | null
  /** HH:MM, or null for all day — which is how most farm work is planned. */
  startTime: string | null
  notes: string
  category: string
  fieldId: string | null
  incubatorId: string | null
  /**
   * Scheduling: which crew, doing what. Both null on an ordinary entry — a
   * delivery is not somebody's job for the day.
   */
  crewId: string | null
  task: CrewTask | null
}
