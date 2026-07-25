import { createContext, useContext } from 'react'
import type { Field, Incubator, Inspection, SensorReading, AppNotification } from './types'

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

  addInspection: (input: Omit<Inspection, 'id'>) => void
  latestReading: (incubatorId: string) => SensorReading | undefined
  /** Persist edits to a field (geometry, shelter count, name…). */
  saveField: (id: string, patch: Partial<Field>) => void

  /** Alert inbox (active = not deleted), newest first. */
  notifications: AppNotification[]
  markNotificationsRead: (ids: string[]) => void
  markAllNotificationsRead: () => void
  deleteNotification: (id: string) => void
}

export const DataContext = createContext<DataContextValue | null>(null)

export function useData(): DataContextValue {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData must be used within a data provider')
  return ctx
}

// The provider component itself lives in AppData.tsx (picks mock vs supabase).
export { DataProvider } from './AppData'
