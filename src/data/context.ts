import { createContext, useContext } from 'react'
import type {
  Block,
  BlockPlacement,
  Field,
  Incubator,
  IncubationBatch,
  IncubatorAlert,
  Inspection,
  Sample,
  SensorReading,
  Tray,
  TrayInspection,
  AppNotification,
  PlacedShelter,
  ShelterTrayLink,
  NestingBlock,
  Grant,
  GrantTask,
  FieldAnalysis,
  FieldWeather,
} from './types'
import type { CostPrefs } from '@/domain/cost'

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
export interface DataContextValue {
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
  latestReading: (incubatorId: string) => SensorReading | undefined
  /**
   * Pull this incubator's readings back to `sinceIso` and merge them in.
   * Hydration only loads a recent window per incubator (~16h of live data), so
   * anything asking for a longer span — the chart's 7D/30D/ALL ranges — must
   * request it. Idempotent: already-loaded windows resolve without refetching.
   */
  loadReadings: (incubatorId: string, sinceIso: string) => Promise<void>
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
  /** Nesting blocks (bees' homes), tied to their shelter. */
  nestingBlocks: NestingBlock[]
  addNestingBlock: (input: Omit<NestingBlock, 'id' | 'createdAt'>) => void

  // ── Nesting blocks (place → retrieve → strip, migration 0012) ────────────
  /** Physical block registry, keyed by the QR label. Loaded via loadBlocks(). */
  blocks: Block[]
  /** Per-season block records. Loaded alongside `blocks`. */
  blockPlacements: BlockPlacement[]
  blocksLoading: boolean
  /** Fetch blocks and placements once. Idempotent — safe to call anywhere. */
  loadBlocks: () => Promise<void>
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
  }) => Promise<{ ok: boolean; created: boolean; error?: string }>
  /**
   * Scans 2 and 3 — weigh a block full (`retrieve`) then empty (`strip`).
   * Bee return is the difference, computed on read.
   *
   * Fails on a block with no placement this season: a weight that can't be
   * attributed to a field says nothing about returns.
   */
  weighBlock: (input: {
    label: string
    stage: 'retrieve' | 'strip'
    weightLbs: number
    season?: number
  }) => Promise<{ ok: boolean; error?: string }>
  /** Edit a placement directly (fix a weight, move it to the right field…). */
  saveBlockPlacement: (id: string, patch: Partial<BlockPlacement>) => Promise<{ ok: boolean; error?: string }>

  // ── Season analysis (0014) ───────────────────────────────────────────────
  /**
   * One row per field per season, for after-harvest analysis. NOT loaded on
   * mount — only the Analysis section reads them. Call `loadFieldAnalysis()`.
   */
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

export const DataContext = createContext<DataContextValue | null>(null)

export function useData(): DataContextValue {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData must be used within a data provider')
  return ctx
}

// The provider component itself lives in AppData.tsx (picks mock vs supabase).
export { DataProvider } from './AppData'
