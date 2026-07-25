import { createContext, useContext } from 'react'
import type {
  Field,
  Incubator,
  IncubationBatch,
  Inspection,
  Sample,
  SensorReading,
  Tray,
  AppNotification,
  PlacedShelter,
  ShelterTrayLink,
  NestingBlock,
} from './types'
import type { CostPrefs } from '@/domain/cost'

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
  /** Incubation trays (largely historical/released in the current data). */
  trays: Tray[]
  /** Incubation batches (runs) with timeline milestones. */
  batches: IncubationBatch[]

  addInspection: (input: Omit<Inspection, 'id'>) => void
  latestReading: (incubatorId: string) => SensorReading | undefined
  /** Persist edits to a field (geometry, shelter count, name…). */
  saveField: (id: string, patch: Partial<Field>) => void

  /** Alert inbox (active = not deleted), newest first. */
  notifications: AppNotification[]
  markNotificationsRead: (ids: string[]) => void
  markAllNotificationsRead: () => void
  deleteNotification: (id: string) => void

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
}

export const DataContext = createContext<DataContextValue | null>(null)

export function useData(): DataContextValue {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData must be used within a data provider')
  return ctx
}

// The provider component itself lives in AppData.tsx (picks mock vs supabase).
export { DataProvider } from './AppData'
