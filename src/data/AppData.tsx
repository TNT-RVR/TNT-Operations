import { useMemo, useState, type ReactNode } from 'react'
import { DataContext, type DataContextValue } from './context'
import type { Inspection, SensorReading } from './types'
import { seedFields, seedIncubators, seedInspections, seedReadings } from './seed'

let idSeq = 1000
const nextId = (prefix: string) => `${prefix}_${++idSeq}`

/** Mock backend: seeded in-memory state, no server required. */
function MockProvider({ children }: { children: ReactNode }) {
  const [inspections, setInspections] = useState<Inspection[]>(seedInspections)
  const [readings] = useState<SensorReading[]>(seedReadings)

  const value = useMemo<DataContextValue>(
    () => ({
      fields: seedFields,
      incubators: seedIncubators,
      inspections,
      readings,
      addInspection: (input) => setInspections((prev) => [{ ...input, id: nextId('in') }, ...prev]),
      latestReading: (incubatorId) =>
        readings
          .filter((r) => r.incubatorId === incubatorId)
          .sort((a, b) => b.at.localeCompare(a.at))[0],
    }),
    [inspections, readings],
  )

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

/**
 * Picks the backend from VITE_DATA_SOURCE. Only `mock` is implemented today;
 * `supabase` is the next phase (add SupabaseProvider and switch here).
 */
export function DataProvider({ children }: { children: ReactNode }) {
  const source = import.meta.env.VITE_DATA_SOURCE ?? 'mock'
  if (source === 'supabase') {
    // TODO(Phase 3): return <SupabaseProvider>{children}</SupabaseProvider>
    console.warn('[data] VITE_DATA_SOURCE=supabase not implemented yet — falling back to mock.')
  }
  return <MockProvider>{children}</MockProvider>
}
